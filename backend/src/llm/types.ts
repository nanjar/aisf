// V1.3 §30 PRD: LLM Provider Contract. Setiap provider (DeepSeek, OpenAI-compatible,
// Qwen, ...) mengimplementasikan LLMProvider dan menerima GenerationRequest yang
// SAMA, mengembalikan GenerationResponse yang SAMA. Kode di luar folder ini
// (generation engine, agent-agent lain) TIDAK BOLEH pernah tahu provider apa
// yang sedang dipakai — itulah §29 LLM-Agnostic Architecture.

export interface GenerationRequest {
  systemPrompt: string;
  userPrompt: string;
  /** §79 — mis. "backend-file-generator-v1", "uiux-designer-v1", "backend-repair-v1" */
  promptVersion: string;
  maxTokens?: number;
  temperature?: number;
  /** Override model default provider, mis. kalau satu project pin ke model tertentu (§31) */
  model?: string;
}

export interface GenerationResponse {
  content: string;
  provider: string;
  model: string;
  finishReason: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  durationMs: number;
}

export interface LLMProvider {
  readonly name: string;
  generate(request: GenerationRequest): Promise<GenerationResponse>;
}

/** §75 — kategori kegagalan yang relevan di layer LLM (subset dari daftar penuh PRD). */
export type LLMFailureCategory = 'LLM_ERROR' | 'LLM_TIMEOUT' | 'OUTPUT_INCOMPLETE';

export class LLMProviderError extends Error {
  constructor(
    message: string,
    public readonly category: LLMFailureCategory,
    public readonly provider: string,
  ) {
    super(message);
    this.name = 'LLMProviderError';
  }
}
