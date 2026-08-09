import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { LLMService } from './llm.service';
import { TestGenerateDto } from './dto/test-generate.dto';

/**
 * Endpoint diagnostik Fase 1 V1.3 — verifikasi LLMModule benar-benar bisa
 * connect ke provider yang dikonfigurasi SEBELUM dipakai generation engine
 * (Fase 3). Sengaja HANYA JwtAuthGuard (siapapun yang login boleh pakai),
 * bukan bagian dari public API contract §62 — murni buat sanity-check
 * manual saat rollout & nanti bisa dipakai lagi sebagai smoke test.
 */
@Controller('llm')
@UseGuards(JwtAuthGuard)
export class LLMTestController {
  constructor(private readonly llm: LLMService) {}

  @Post('test')
  async test(@Body() dto: TestGenerateDto) {
    const result = await this.llm.generate({
      systemPrompt: 'You are a helpful assistant. Reply in one short sentence.',
      userPrompt: dto.prompt,
      promptVersion: 'llm-connectivity-test-v1',
    });

    return {
      provider: result.provider,
      model: result.model,
      content: result.content,
      totalTokens: result.totalTokens,
      durationMs: result.durationMs,
    };
  }

  @Get('providers')
  listProviders() {
    return { providers: this.llm.listProviders() };
  }
}
