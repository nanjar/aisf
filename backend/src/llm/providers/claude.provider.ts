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
 * Marker yang SAMA PERSIS dengan yang dipakai frontend-gen/prompts.ts dan
 * backend-gen/prompts.ts untuk memisahkan bagian STATIS (konteks besar
 * project — PRD/Architecture/UIUX/manifest) dari bagian SPESIFIK-FILE (path,
 * purpose) di user prompt. Kalau marker ini ketemu, kita pecah user prompt
 * jadi 2 content block terpisah supaya prompt caching Anthropic bisa
 * menandai HANYA bagian statis-nya sebagai cache_control — bagian dinamis di
 * bawahnya TETAP dikirim biasa (tidak di-cache, karena memang beda tiap
 * panggilan). Kalau marker tidak ketemu (mis. manifest prompt, repair
 * prompt yang strukturnya beda), kirim user prompt sebagai 1 block biasa
 * tanpa cache — masih tetap berfungsi normal, cuma tidak dapat manfaat
 * caching untuk kasus itu.
 */
const STATIC_DYNAMIC_BOUNDARY_MARKER = '# ===== FILE YANG HARUS DIGENERATE SEKARANG =====';

interface AnthropicContentBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

/**
 * Claude (Anthropic) provider (§29 PRD V1.3) — fallback/alternatif untuk
 * DeepSeek. Dipertimbangkan setelah DeepSeek berulang kali kesulitan pada
 * konsistensi import/export dan kepatuhan instruksi terstruktur (JSON
 * manifest, tagging screenId/componentId) di sesi V1.3 ini — Claude dikenal
 * relatif kuat justru di area-area itu.
 *
 * Prompt caching Anthropic diaktifkan lewat cache_control:{type:'ephemeral'}
 * di content block system prompt (yang sekarang 100% statis per project,
 * lihat frontend-gen/prompts.ts) DAN di bagian statis user prompt kalau
 * marker boundary ketemu — mengikuti pola yang sama dengan fix context
 * caching DeepSeek sebelumnya di sesi ini, cache-hit Anthropic ~90% lebih
 * murah dari harga input normal.
 */
@Injectable()
export class ClaudeProvider implements LLMProvider {
  readonly name = 'claude';

  private readonly logger = new Logger(ClaudeProvider.name);
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly timeoutMs: number;
  private readonly apiVersion = '2023-06-01';

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.getOrThrow<string>('ANTHROPIC_API_KEY');
    this.baseUrl = this.config.get<string>('ANTHROPIC_BASE_URL', 'https://api.anthropic.com');
    this.defaultModel = this.config.get<string>('CLAUDE_DEFAULT_MODEL', 'claude-sonnet-5');
    this.timeoutMs = Number(this.config.get<string>('LLM_TIMEOUT_MS', '120000'));
  }

  private buildUserContentBlocks(userPrompt: string): AnthropicContentBlock[] {
    const markerIndex = userPrompt.indexOf(STATIC_DYNAMIC_BOUNDARY_MARKER);
    if (markerIndex === -1) {
      // Marker tidak ketemu — kirim sebagai 1 block biasa, tanpa cache.
      return [{ type: 'text', text: userPrompt }];
    }
    const staticPart = userPrompt.slice(0, markerIndex);
    const dynamicPart = userPrompt.slice(markerIndex);
    return [
      { type: 'text', text: staticPart, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: dynamicPart },
    ];
  }

  async generate(request: GenerationRequest): Promise<GenerationResponse> {
    const model = request.model ?? this.defaultModel;
    const startedAt = Date.now();

    try {
      const response = await axios.post(
        `${this.baseUrl}/v1/messages`,
        {
          model,
          max_tokens: request.maxTokens ?? 8192,
          system: [
            {
              type: 'text',
              text: request.systemPrompt,
              // System prompt sekarang 100% statis per project (lihat
              // frontend-gen/prompts.ts) — selalu aman di-cache.
              cache_control: { type: 'ephemeral' },
            },
          ],
          messages: [
            {
              role: 'user',
              content: this.buildUserContentBlocks(request.userPrompt),
            },
          ],
        },
        {
          headers: {
            'x-api-key': this.apiKey,
            'anthropic-version': this.apiVersion,
            'Content-Type': 'application/json',
          },
          timeout: this.timeoutMs,
        },
      );

      const durationMs = Date.now() - startedAt;
      const usage = response.data?.usage ?? {};
      const stopReason = response.data?.stop_reason ?? 'unknown';

      const textBlock = (response.data?.content ?? []).find(
        (block: { type: string; text?: string }) => block.type === 'text',
      );

      if (!textBlock?.text) {
        // §75 OUTPUT_INCOMPLETE — respons 200 tapi tidak ada content teks sama sekali
        throw new LLMProviderError(
          'Claude response tidak berisi content teks',
          'OUTPUT_INCOMPLETE',
          this.name,
        );
      }

      if (stopReason === 'max_tokens') {
        // Sama pola dengan DeepSeek provider — terpotong karena maxTokens,
        // caller (generation engine) yang nanti memutuskan retry.
        this.logger.warn(
          `Claude response terpotong (stop_reason=max_tokens) untuk promptVersion=${request.promptVersion}`,
        );
      }

      // cache_read_input_tokens = token yang KENA cache-hit (jauh lebih
      // murah, ~10% harga normal), cache_creation_input_tokens = token yang
      // PERTAMA KALI ditulis ke cache (harga sedikit lebih mahal dari
      // normal). input_tokens sendiri = token BARU yang tidak tersentuh
      // cache sama sekali. Jumlahkan ketiganya untuk total token input yang
      // benar-benar terhitung/diproses request ini (buat visibility, bukan
      // representasi biaya presisi — biaya sesungguhnya tetap dihitung
      // Anthropic sendiri per kategori token dengan tarif berbeda-beda).
      const inputTokens =
        (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
      const outputTokens = usage.output_tokens ?? 0;

      return {
        content: textBlock.text,
        provider: this.name,
        model,
        finishReason: stopReason,
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
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
        `Claude generation gagal setelah ${durationMs}ms (promptVersion=${request.promptVersion}): ${detail}`,
      );

      throw new LLMProviderError(detail, category, this.name);
    }
  }
}
