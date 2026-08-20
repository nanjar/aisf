import { Module } from '@nestjs/common';
import { LLMService } from './llm.service';
import { DeepSeekProvider } from './providers/deepseek.provider';
import { QwenProvider } from './providers/qwen.provider';
import { GeminiProvider } from './providers/gemini.provider';
import { OpenRouterProvider } from './providers/openrouter.provider';
import { ClaudeProvider } from './providers/claude.provider';
import { LLMTestController } from './llm-test.controller';

@Module({
  controllers: [LLMTestController],
  providers: [LLMService, DeepSeekProvider, QwenProvider, GeminiProvider, OpenRouterProvider, ClaudeProvider],
  exports: [LLMService],
})
export class LLMModule {}
