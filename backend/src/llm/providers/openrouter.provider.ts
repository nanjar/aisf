import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
import { GenerationRequest, GenerationResponse, LLMProvider, LLMProviderError } from '../types';

/**
 * §29 PRD V1.3 — OpenRouter, agregator banyak provider lewat 1 API OpenAI-
 * compatible (https://openrouter.ai/api/v1). Punya banyak model ":free"
 * genuinely gratis, termasuk "deepseek/deepseek-v4-flash:free" — MODEL YANG
 * SAMA PERSIS dengan yang sudah kita pakai berbayar via DeepSeekProvider,
 * cuma gratis lewat OpenRouter. Limit berbasis JUMLAH REQUEST (20/menit,
 * 200/hari per riset Agustus 2026), bukan jumlah token per menit seperti
 * Gemini free tier — jauh lebih cocok buat prompt besar kita (PRD+
 * Architecture+UIUX+Backend digabung tiap panggilan).
 *
 * Rate limit request-based tetap bisa kena kalau generate banyak file
 * beruntun (>20/menit) — retry-with-backoff yang sama polanya dengan
 * GeminiProvider tetap disertakan untuk jaga-jaga.
 *
 * Pakai "openrouter/free" (router otomatis OpenRouter) sebagai default —
 * artinya MODEL SEBENARNYA YANG DIPAKAI BISA BEDA-BEDA TIAP PANGGILAN
 * (tergantung mana yang lagi tersedia). Konsekuensinya: reliabilitas per-
 * panggilan bisa lebih bervariasi dibanding provider tunggal seperti
 * DeepSeek langsung — postmortem: 1 panggilan balik response KOSONG
 * (OUTPUT_INCOMPLETE), kemungkinan besar model yang ke-assign saat itu lagi
 * bermasalah sesaat. Retry sekarang juga mencakup kasus ini, bukan cuma 429.
 *
 * Postmortem lanjutan: "read ECONNRESET" (koneksi TCP terputus tiba-tiba di
 * tengah request, error jaringan level OS, bukan dari OpenRouter/model)
 * juga pernah bikin generation gagal total tanpa retry — sekarang JUGA
 * di-retry, karena ini nyaris selalu transient (network blip sesaat).
 */
@Injectable()
export class OpenRouterProvider implements LLMProvider {
  readonly name = 'openrouter';

  private readonly logger = new Logger(OpenRouterProvider.name);
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly timeoutMs: number;

  constructor(private readonly config: ConfigService) {
    // Sama pola dengan QwenProvider/GeminiProvider — config.get() bukan
    // getOrThrow() di constructor, supaya backend TETAP BISA start normal
    // kalau OPENROUTER_API_KEY belum diisi.
    this.apiKey = this.config.get<string>('OPENROUTER_API_KEY', '');
    this.baseUrl = this.config.get<string>('OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1');
    // Fix (postmortem: hardcode model ID ":free" spesifik - qwen3-coder:free,
    // deepseek-v4-flash:free - dua-duanya sudah tidak tersedia lagi cuma
    // dalam hitungan hari/minggu dari saat direkomendasikan. Daftar model
    // gratis OpenRouter ROTASI TERUS tanpa pemberitahuan. "openrouter/free"
    // itu ROUTER RESMI dari OpenRouter sendiri yang otomatis pilih model
    // gratis mana pun yang SEDANG benar-benar tersedia saat itu — jauh lebih
    // tahan lama daripada hardcode 1 model spesifik.
    this.defaultModel = this.config.get<string>('OPENROUTER_DEFAULT_MODEL', 'openrouter/free');
    this.timeoutMs = Number(this.config.get<string>('OPENROUTER_TIMEOUT_MS', '180000'));
  }

  async generate(request: GenerationRequest): Promise<GenerationResponse> {
    if (!this.apiKey) {
      throw new LLMProviderError(
        'OPENROUTER_API_KEY belum di-set di .env — isi dulu sebelum pakai provider openrouter',
        'LLM_ERROR',
        this.name,
      );
    }

    // Retry-with-backoff — pola sama dengan GeminiProvider (lihat postmortem
    // di sana), minimum delay dipaksa 20s untuk 429. Fix lanjutan: retry
    // sekarang JUGA mencakup OUTPUT_INCOMPLETE (response kosong) DAN error
    // jaringan transient (ECONNRESET/ECONNREFUSED/ETIMEDOUT/socket hang up)
    // — sebelumnya kategori ini jatuh ke 'LLM_ERROR' generik yang TIDAK
    // di-retry sama sekali, langsung gagal total walau cuma network blip
    // sesaat yang biasanya pulih sendiri kalau dicoba lagi.
    const MAX_RETRIES = 10;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await this.doGenerate(request);
      } catch (err) {
        const isRateLimited = err instanceof LLMProviderError && err.message.includes('HTTP 429');
        const isEmptyOutput = err instanceof LLMProviderError && err.category === 'OUTPUT_INCOMPLETE';
        const isNetworkGlitch =
          err instanceof LLMProviderError &&
          /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|socket hang up|ENOTFOUND/i.test(err.message);
        const isRetryable = isRateLimited || isEmptyOutput || isNetworkGlitch;
        if (!isRetryable || attempt === MAX_RETRIES) throw err;

        // Network glitch/response kosong biasanya transient/cepat pulih —
        // delay lebih pendek dari rate limit (yang butuh window per-menit
        // beneran reset).
        const retryDelaySeconds = isRateLimited ? 20 * (attempt + 1) : 5 * (attempt + 1);
        const reason = isRateLimited ? 'rate limited (429)' : isEmptyOutput ? 'response kosong' : 'network glitch';
        this.logger.warn(
          `OpenRouter ${reason}, retry ${attempt + 1}/${MAX_RETRIES} setelah ${retryDelaySeconds}s...`,
        );
        await new Promise((resolve) => setTimeout(resolve, retryDelaySeconds * 1000));
      }
    }
    throw new LLMProviderError('OpenRouter generate() gagal tanpa alasan jelas', 'LLM_ERROR', this.name);
  }

  private async doGenerate(request: GenerationRequest): Promise<GenerationResponse> {
    const model = request.model ?? this.defaultModel;
    const startedAt = Date.now();

    try {
      const response = await axios.post(
        `${this.baseUrl}/chat/completions`,
        {
          model,
          messages: [
            { role: 'system', content: request.systemPrompt },
            { role: 'user', content: request.userPrompt },
          ],
          max_tokens: request.maxTokens ?? 8192,
          temperature: request.temperature ?? 0.2,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
            // OpenRouter minta header ini buat identifikasi aplikasi (opsional
            // tapi disarankan di dokumentasi mereka, bantu prioritas rate-limit).
            'HTTP-Referer': 'https://aisf.nanjarbudiman.com',
            'X-Title': 'AI Software Factory',
          },
          timeout: this.timeoutMs,
        },
      );

      const durationMs = Date.now() - startedAt;
      const choice = response.data?.choices?.[0];
      const usage = response.data?.usage ?? {};
      const finishReason = choice?.finish_reason ?? 'unknown';

      if (!choice?.message?.content) {
        throw new LLMProviderError('OpenRouter response tidak berisi content', 'OUTPUT_INCOMPLETE', this.name);
      }

      if (finishReason === 'length') {
        this.logger.warn(
          `OpenRouter response terpotong (finish_reason=length) untuk promptVersion=${request.promptVersion}, model=${model}`,
        );
      }

      return {
        content: choice.message.content,
        provider: this.name,
        model,
        finishReason,
        inputTokens: usage.prompt_tokens ?? 0,
        outputTokens: usage.completion_tokens ?? 0,
        totalTokens: usage.total_tokens ?? 0,
        durationMs,
      };
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      if (err instanceof LLMProviderError) throw err;

      const axiosErr = err as AxiosError;
      const isTimeout = axiosErr.code === 'ECONNABORTED';
      const category = isTimeout ? 'LLM_TIMEOUT' : 'LLM_ERROR';
      // Fix: sertakan axiosErr.code (mis. "ECONNRESET") di detail — sebelumnya
      // kalau tidak ada axiosErr.response (network error, bukan HTTP error),
      // cuma pakai axiosErr.message ("read ECONNRESET" saja) — cukup buat
      // regex retry di atas kok, tapi lebih eksplisit begini.
      const detail = axiosErr.response
        ? `HTTP ${axiosErr.response.status}: ${JSON.stringify(axiosErr.response.data)}`
        : `${axiosErr.code ?? ''} ${axiosErr.message}`.trim();

      this.logger.error(
        `OpenRouter generation gagal setelah ${durationMs}ms (promptVersion=${request.promptVersion}): ${detail}`,
      );

      throw new LLMProviderError(detail, category, this.name);
    }
  }
}
