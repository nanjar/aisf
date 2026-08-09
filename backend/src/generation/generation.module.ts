import { Module } from '@nestjs/common';
import { SandboxService } from './sandbox.service';
import { ValidationService } from './validation.service';
import { BackendValidatorService } from './validators/backend-validator.service';
import { FrontendValidatorService } from './validators/frontend-validator.service';
import { DatabaseValidatorService } from './validators/database-validator.service';
import { StorageModule } from '../storage/storage.module';
import { LLMModule } from '../llm/llm.module'; // V1.3 — dipakai generation engine Fase 3

@Module({
  imports: [StorageModule, LLMModule],
  providers: [
    SandboxService,
    ValidationService,
    BackendValidatorService,
    FrontendValidatorService,
    DatabaseValidatorService,
  ],
  exports: [ValidationService],
})
export class GenerationModule {}
