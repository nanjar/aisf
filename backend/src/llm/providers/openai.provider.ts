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
 * OpenAI provider (§29 PRD V1.3) — alternatif lain di luar DeepSeek/Claude.
 * Dipertimbangkan setelah biaya Claude Sonnet 5 terbukti terlalu tinggi
 * untuk 1x percobaan generate penuh ($5 kredit habis sebelum selesai).
 * Default model GPT-4.1 dipilih dibanding GPT-4o (legacy per Jan 2026) —
 * lebih murah ($2/$8 per 1M token vs $2.50/$10) DAN skor coding
 * (SWE-bench) lebih tinggi menurut OpenAI.
 *
 * OpenAI TIDAK butuh cache_control manual seperti Anthropic — prompt
 * caching otomatis diterapkan OpenAI sendiri untuk prompt >1024 token
 * (longest matching prefix), jadi system prompt statis kita (lihat
 * frontend-gen/prompts.ts) otomatis dapat manfaat cache-hit tanpa
 * perubahan apapun di sisi request.
 */
@Injectable()
export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai';

  private readonly logger = new Logger(OpenAIProvider.name);
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly timeoutMs: number;

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.getOrThrow<string>('OPENAI_API_KEY');
    this.baseUrl = this.config.get<string>('OPENAI_BASE_URL', 'https://api.openai.com');
    this.defaultModel = this.config.get<string>('OPENAI_DEFAULT_MODEL', 'gpt-4.1');
    this.timeoutMs = Number(this.config.get<string>('LLM_TIMEOUT_MS', '120000'));
  }

  async generate(request: GenerationRequest): Promise<GenerationResponse> {
    const model = request.model ?? this.defaultModel;
    const startedAt = Date.now();

    try {
      const response = await axios.post(
        `${this.baseUrl}/v1/chat/completions`,
        {
          model,
          max_tokens: request.maxTokens ?? 8192,
          temperature: request.temperature,
          messages: [
            { role: 'system', content: request.systemPrompt },
            { role: 'user', content: request.userPrompt },
          ],
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
      const content = choice?.message?.content;

      if (!content) {
        // §75 OUTPUT_INCOMPLETE — respons 200 tapi tidak ada content teks sama sekali
        throw new LLMProviderError(
          'OpenAI response tidak berisi content teks',
          'OUTPUT_INCOMPLETE',
          this.name,
        );
      }

      if (finishReason === 'length') {
        // Sama pola dengan DeepSeek/Claude provider — terpotong karena
        // maxTokens, caller (generation engine) yang nanti memutuskan retry.
        this.logger.warn(
          `OpenAI response terpotong (finish_reason=length) untuk promptVersion=${request.promptVersion}`,
        );
      }

      // prompt_tokens_details.cached_tokens = bagian dari prompt_tokens yang
      // KENA cache-hit otomatis OpenAI (lebih murah) — sudah TERMASUK di
      // dalam prompt_tokens, BUKAN tambahan terpisah (beda dari pola
      // Anthropic yang pisah input/cache_creation/cache_read). Jadi cukup
      // pakai prompt_tokens apa adanya untuk totalTokens, cachedTokens cuma
      // dicatat di log untuk visibility biaya.
      const inputTokens = usage.prompt_tokens ?? 0;
      const outputTokens = usage.completion_tokens ?? 0;
      const cachedTokens = usage.prompt_tokens_details?.cached_tokens ?? 0;
      if (cachedTokens > 0) {
        this.logger.debug(`OpenAI cache-hit ${cachedTokens}/${inputTokens} token input (promptVersion=${request.promptVersion})`);
      }

      return {
        content,
        provider: this.name,
        model,
        finishReason,
        inputTokens,
        outputTokens,
        totalTokens: usage.total_tokens ?? inputTokens + outputTokens,
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
        `OpenAI generation gagal setelah ${durationMs}ms (promptVersion=${request.promptVersion}): ${detail}`,
      );

      throw new LLMProviderError(detail, category, this.name);
    }
  }
}
