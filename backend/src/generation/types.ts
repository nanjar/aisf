export interface ValidationResult {
  passed: boolean;
  /** Raw compiler/build/migration output — dikirim balik ke n8n untuk LLM Fix Agent. */
  errorLog?: string;
}

export interface ValidateStagePayload {
  projectId: string;
  stageKey: 'DATABASE' | 'BACKEND' | 'FRONTEND';
  version: number;
}
