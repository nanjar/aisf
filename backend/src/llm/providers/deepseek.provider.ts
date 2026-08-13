import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
import {
  GenerationRequest,
  GenerationResponse,
  LLMProvider,
  LLMProviderError,
} from '../types';

/**
 * DeepSeek provider (§29 PRD V1.3). Endpoint DeepSeek OpenAI-compatible
 * ("/chat/completions"), jadi provider OpenAI-compatible generik lain nanti
 * bisa banyak reuse struktur request/response ini.
 *
 * PENTING (Agustus 2026): nama model legacy "deepseek-chat"/"deepseek-reasoner"
 * resmi di-retire 24 Juli 2026 — selama masa transisi otomatis diarahkan ke
 * "deepseek-v4-flash" (non-thinking/thinking), tapi status alias ini makin
 * tidak konsisten. Default sekarang eksplisit "deepseek-v4-flash" — SAMA
 * PERSIS model yang sudah kita pakai selama ini lewat alias lama, BUKAN
 * downgrade. Satu beda penting: V4 defaultnya THINKING MODE AKTIF (beda dari
 * alias lama yang selalu non-thinking) — kalau dibiarkan default, respons
 * jadi lebih lambat/mahal DAN parameter `temperature` diam-diam tidak
 * berpengaruh sama sekali (§thinking_mode docs: thinking mode tidak dukung
 * temperature/top_p/dst). thinking:{type:'disabled'} WAJIB dikirim eksplisit
 * supaya perilakunya identik dengan yang sudah dites sepanjang sesi ini.
 */
@Injectable()
export class DeepSeekProvider implements LLMProvider {
  readonly name = 'deepseek';

  private readonly logger = new Logger(DeepSeekProvider.name);
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly timeoutMs: number;

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.getOrThrow<string>('DEEPSEEK_API_KEY');
    this.baseUrl = this.config.get<string>('DEEPSEEK_BASE_URL', 'https://api.deepseek.com');
    this.defaultModel = this.config.get<string>('DEEPSEEK_DEFAULT_MODEL', 'deepseek-v4-flash');
    this.timeoutMs = Number(this.config.get<string>('LLM_TIMEOUT_MS', '120000'));
  }

  async generate(request: GenerationRequest): Promise<GenerationResponse> {
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
          // Wajib eksplisit — lihat komentar kelas di atas. Tanpa ini, model
          // V4 (bukan alias legacy) default-nya thinking mode AKTIF.
          thinking: { type: 'disabled' },
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: this.timeoutMs,
        },
      );

      const durationMs = Date.now() - startedAt;
      const choice = response.data?.choices?.[0];
      const usage = response.data?.usage ?? {};
      const finishReason = choice?.finish_reason ?? 'unknown';

      if (!choice?.message?.content) {
        // §75 OUTPUT_INCOMPLETE — respons 200 tapi tidak ada content sama sekali
        throw new LLMProviderError(
          'DeepSeek response tidak berisi content',
          'OUTPUT_INCOMPLETE',
          this.name,
        );
      }

      if (finishReason === 'length') {
        // Terpotong karena maxTokens — ini persis kelas masalah yang mau
        // dihindari §3 PRD V1.3 lewat chunked generation di Fase 3. Fase 1
        // hanya menandainya di finishReason, caller (generation engine) yang
        // nanti memutuskan retry dengan chunking.
        this.logger.warn(
          `DeepSeek response terpotong (finish_reason=length) untuk promptVersion=${request.promptVersion}`,
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

      if (err instanceof LLMProviderError) {
        throw err;
      }

      const axiosErr = err as AxiosError;
      const isTimeout = axiosErr.code === 'ECONNABORTED';
      const category = isTimeout ? 'LLM_TIMEOUT' : 'LLM_ERROR';
      const detail = axiosErr.response
        ? `HTTP ${axiosErr.response.status}: ${JSON.stringify(axiosErr.response.data)}`
        : axiosErr.message;

      this.logger.error(
        `DeepSeek generation gagal setelah ${durationMs}ms (promptVersion=${request.promptVersion}): ${detail}`,
      );

      throw new LLMProviderError(detail, category, this.name);
    }
  }
}
