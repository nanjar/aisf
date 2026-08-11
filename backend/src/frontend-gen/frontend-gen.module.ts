import { Module } from '@nestjs/common';
import { FrontendGenService } from './frontend-gen.service';
import { FrontendGenController } from './frontend-gen.controller';
import { StorageModule } from '../storage/storage.module';
import { LLMModule } from '../llm/llm.module';
import { GenerationModule } from '../generation/generation.module';
import { UiuxModule } from '../uiux/uiux.module';
import { BackendGenModule } from '../backend-gen/backend-gen.module';

@Module({
  imports: [StorageModule, LLMModule, GenerationModule, UiuxModule, BackendGenModule],
  controllers: [FrontendGenController],
  providers: [FrontendGenService],
})
export class FrontendGenModule {}
