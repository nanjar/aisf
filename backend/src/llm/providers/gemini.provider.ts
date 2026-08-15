import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
import { GenerationRequest, GenerationResponse, LLMProvider, LLMProviderError } from '../types';

/**
 * §29 PRD V1.3 — Gemini via endpoint OpenAI-compatible resmi Google
 * (https://generativelanguage.googleapis.com/v1beta/openai/). Struktur
 * request/response nyaris identik DeepSeekProvider — pembuktian lanjutan
 * arsitektur provider-agnostic dari Fase 1.
 *
 * Dipakai sebagai fallback kedua (setelah Qwen self-hosted) saat DeepSeek
 * kehabisan credit. Default model gemini-3.1-flash-lite (murah, ada free
 * tier, cukup mampu untuk tugas terstruktur seperti manifest JSON — beda
 * dari pengalaman Qwen 7B yang kesulitan ikuti instruksi kompleks). Kalau
 * kualitas masih kurang, ganti GEMINI_DEFAULT_MODEL="gemini-3.1-pro" (lebih
 * mahal, jauh lebih mampu) lewat env var, tidak perlu ubah kode.
 */
@Injectable()
export class GeminiProvider implements LLMProvider {
  readonly name = 'gemini';

  private readonly logger = new Logger(GeminiProvider.name);
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly timeoutMs: number;

  constructor(private readonly config: ConfigService) {
    // Sama pola dengan QwenProvider — config.get() bukan getOrThrow() di
    // constructor, supaya backend TETAP BISA start normal kalau
    // GEMINI_API_KEY belum diisi (provider ini opsional, NestJS instantiate
    // semua provider di awal terlepas dari yang mana benar-benar dipakai).
    this.apiKey = this.config.get<string>('GEMINI_API_KEY', '');
    this.baseUrl = this.config.get<string>('GEMINI_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta/openai');
    this.defaultModel = this.config.get<string>('GEMINI_DEFAULT_MODEL', 'gemini-3.1-flash-lite');
    this.timeoutMs = Number(this.config.get<string>('GEMINI_TIMEOUT_MS', '180000'));
  }

  async generate(request: GenerationRequest): Promise<GenerationResponse> {
    if (!this.apiKey) {
      throw new LLMProviderError(
        'GEMINI_API_KEY belum di-set di .env — isi dulu sebelum pakai provider gemini',
        'LLM_ERROR',
        this.name,
      );
    }

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
          },
          timeout: this.timeoutMs,
        },
      );

      const durationMs = Date.now() - startedAt;
      const choice = response.data?.choices?.[0];
      const usage = response.data?.usage ?? {};
      const finishReason = choice?.finish_reason ?? 'unknown';

      if (!choice?.message?.content) {
        throw new LLMProviderError('Gemini response tidak berisi content', 'OUTPUT_INCOMPLETE', this.name);
      }

      if (finishReason === 'length') {
        this.logger.warn(
          `Gemini response terpotong (finish_reason=length) untuk promptVersion=${request.promptVersion}`,
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
      const status = axiosErr.response?.status;
      const category = isTimeout ? 'LLM_TIMEOUT' : status === 402 || status === 429 ? 'LLM_ERROR' : 'LLM_ERROR';
      const detail = axiosErr.response
        ? `HTTP ${axiosErr.response.status}: ${JSON.stringify(axiosErr.response.data)}`
        : axiosErr.message;

      this.logger.error(
        `Gemini generation gagal setelah ${durationMs}ms (promptVersion=${request.promptVersion}): ${detail}`,
      );

      throw new LLMProviderError(detail, category, this.name);
    }
  }
}
