import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeepSeekProvider } from './providers/deepseek.provider';
import { QwenProvider } from './providers/qwen.provider';
import { GenerationRequest, GenerationResponse, LLMProvider } from './types';

/**
 * §29 PRD V1.3 — LLM-Agnostic Architecture.
 *
 * Generation engine (Fase 3) dan agent-agent lain HANYA boleh depend on
 * LLMService, tidak pernah langsung ke DeepSeekProvider atau axios. Untuk
 * menambah provider baru (mis. OpenAI-compatible generik, Qwen):
 *   1. Buat class baru di providers/ yang implement LLMProvider
 *   2. Daftarkan di constructor providers map di bawah
 *   3. Selesai — tidak ada perubahan lain di luar folder llm/
 */
@Injectable()
export class LLMService {
  private readonly providers: Map<string, LLMProvider>;
  private readonly defaultProviderName: string;

  constructor(
    private readonly config: ConfigService,
    deepseek: DeepSeekProvider,
    qwen: QwenProvider,
  ) {
    this.providers = new Map<string, LLMProvider>([
      [deepseek.name, deepseek],
      [qwen.name, qwen],
    ]);
    this.defaultProviderName = this.config.get<string>('LLM_DEFAULT_PROVIDER', 'deepseek');
  }

  async generate(request: GenerationRequest, providerName?: string): Promise<GenerationResponse> {
    const name = providerName ?? this.defaultProviderName;
    const provider = this.providers.get(name);

    if (!provider) {
      throw new Error(
        `LLM provider '${name}' tidak terdaftar. Provider tersedia: ${[...this.providers.keys()].join(', ')}`,
      );
    }

    return provider.generate(request);
  }

  listProviders(): string[] {
    return [...this.providers.keys()];
  }
}
