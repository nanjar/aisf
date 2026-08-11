import { Module } from '@nestjs/common';
import { BackendGenService } from './backend-gen.service';
import { BackendGenController } from './backend-gen.controller';
import { StorageModule } from '../storage/storage.module';
import { LLMModule } from '../llm/llm.module';
import { GenerationModule } from '../generation/generation.module';
import { UiuxModule } from '../uiux/uiux.module';

@Module({
  imports: [StorageModule, LLMModule, GenerationModule, UiuxModule],
  controllers: [BackendGenController],
  providers: [BackendGenService],
  exports: [BackendGenService], // V1.3 — dipakai frontend-gen buat ambil Backend API Contract summary
})
export class BackendGenModule {}
