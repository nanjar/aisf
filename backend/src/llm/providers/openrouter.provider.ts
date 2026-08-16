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

    // Retry-with-backoff untuk 429 — pola sama dengan GeminiProvider
    // (lihat postmortem di sana), minimum delay dipaksa 20s per attempt
    // terlepas dari header/body yang dibalikin OpenRouter, karena window
    // rate-limit per-menit butuh waktu ASLI buat reset.
    const MAX_RATE_LIMIT_RETRIES = 10;
    for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt++) {
      try {
        return await this.doGenerate(request);
      } catch (err) {
        const isRateLimited = err instanceof LLMProviderError && err.message.includes('HTTP 429');
        if (!isRateLimited || attempt === MAX_RATE_LIMIT_RETRIES) throw err;

        const retryDelaySeconds = 20 * (attempt + 1);
        this.logger.warn(
          `OpenRouter rate limited (429), retry ${attempt + 1}/${MAX_RATE_LIMIT_RETRIES} setelah ${retryDelaySeconds}s...`,
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
      const detail = axiosErr.response
        ? `HTTP ${axiosErr.response.status}: ${JSON.stringify(axiosErr.response.data)}`
        : axiosErr.message;

      this.logger.error(
        `OpenRouter generation gagal setelah ${durationMs}ms (promptVersion=${request.promptVersion}): ${detail}`,
      );

      throw new LLMProviderError(detail, category, this.name);
    }
  }
}
