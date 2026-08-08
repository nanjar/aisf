import { Module } from '@nestjs/common';
import { SandboxService } from './sandbox.service';
import { ValidationService } from './validation.service';
import { BackendValidatorService } from './validators/backend-validator.service';
import { FrontendValidatorService } from './validators/frontend-validator.service';
import { DatabaseValidatorService } from './validators/database-validator.service';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [StorageModule],
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
