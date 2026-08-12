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
 * §29 PRD V1.3 — Qwen self-hosted via Ollama (VLAN sama dengan undangin,
 * dijangkau dari backend/kuring lewat Tailscale — bukan lewat VLAN
 * internal langsung). Ollama expose endpoint OpenAI-compatible di
 * "/v1/chat/completions" sejak versi 0.1.x+, jadi bentuk request/response-nya
 * nyaris identik dengan DeepSeekProvider — TIDAK butuh API key (model jalan
 * lokal, tidak ada billing/auth).
 *
 * Dipakai sebagai fallback hemat-credit sementara DeepSeek API kehabisan
 * saldo — kualitas/kecepatan model lokal 8B jauh di bawah DeepSeek, wajar
 * kalau lebih sering butuh self-healing/retry dibanding provider utama.
 */
@Injectable()
export class QwenProvider implements LLMProvider {
  readonly name = 'qwen';

  private readonly logger = new Logger(QwenProvider.name);
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly timeoutMs: number;

  constructor(private readonly config: ConfigService) {
    // getOrThrow SENGAJA tidak dipakai di sini — provider ini opsional
    // (cuma dipakai kalau LLM_DEFAULT_PROVIDER=qwen atau di-override manual).
    // Kalau QWEN_BASE_URL belum diisi, backend TETAP HARUS bisa start normal
    // (NestJS instantiate semua provider di awal, bukan pas dipakai) — baru
    // error jelas muncul kalau provider ini BENERAN dipanggil tanpa config.
    this.baseUrl = this.config.get<string>('QWEN_BASE_URL', '');
    this.defaultModel = this.config.get<string>('QWEN_DEFAULT_MODEL', 'qwen2.5-coder:7b'); // model code-specialized, sebagian besar generation kita itu kode
    this.timeoutMs = Number(this.config.get<string>('QWEN_TIMEOUT_MS', '300000'));
  }

  async generate(request: GenerationRequest): Promise<GenerationResponse> {
    if (!this.baseUrl) {
      throw new LLMProviderError(
        'QWEN_BASE_URL belum di-set di .env — isi dulu sebelum pakai provider qwen',
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
          // Fix proaktif (risiko yang sudah teridentifikasi belum sempat
          // kejadian): qwen2.5-coder:7b context window TOTAL cuma 32768
          // token (input+output DIGABUNG) — beda dari DeepSeek yang jauh
          // lebih besar. Kalau caller minta max_tokens output sampai 32768
          // (nilai yang aman buat DeepSeek), itu bisa melebihi SISA context
          // yang ada setelah prompt (PRD+Architecture+dst) ikut dihitung.
          // Cap output ke nilai aman, sisakan ruang besar buat prompt.
          max_tokens: Math.min(request.maxTokens ?? 8192, 6000),
          temperature: request.temperature ?? 0.2,
        },
        {
          headers: { 'Content-Type': 'application/json' }, // Ollama tidak butuh Authorization
          timeout: this.timeoutMs,
        },
      );

      const durationMs = Date.now() - startedAt;
      const choice = response.data?.choices?.[0];
      const usage = response.data?.usage ?? {};
      const finishReason = choice?.finish_reason ?? 'unknown';

      if (!choice?.message?.content) {
        throw new LLMProviderError('Qwen/Ollama response tidak berisi content', 'OUTPUT_INCOMPLETE', this.name);
      }

      if (finishReason === 'length') {
        this.logger.warn(
          `Qwen/Ollama response terpotong (finish_reason=length) untuk promptVersion=${request.promptVersion}`,
        );
      }

      return {
        content: choice.message.content,
        provider: this.name,
        model,
        finishReason,
        // Ollama's usage stats kadang tidak selengkap OpenAI/DeepSeek — fallback 0 kalau tidak ada.
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
        `Qwen/Ollama generation gagal setelah ${durationMs}ms (promptVersion=${request.promptVersion}): ${detail}`,
      );

      throw new LLMProviderError(detail, category, this.name);
    }
  }
}
