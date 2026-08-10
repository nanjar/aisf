import { Module } from '@nestjs/common';
import { UiuxService } from './uiux.service';
import { UiuxController } from './uiux.controller';
import { StorageModule } from '../storage/storage.module';
import { LLMModule } from '../llm/llm.module';

@Module({
  imports: [StorageModule, LLMModule],
  controllers: [UiuxController],
  providers: [UiuxService],
})
export class UiuxModule {}
