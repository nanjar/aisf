import { Module } from '@nestjs/common';
import { LLMService } from './llm.service';
import { DeepSeekProvider } from './providers/deepseek.provider';
import { QwenProvider } from './providers/qwen.provider';
import { LLMTestController } from './llm-test.controller';

@Module({
  controllers: [LLMTestController],
  providers: [LLMService, DeepSeekProvider, QwenProvider],
  exports: [LLMService],
})
export class LLMModule {}
