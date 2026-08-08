import { Injectable, NotFoundException } from '@nestjs/common';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { SandboxService } from './sandbox.service';
import { BackendValidatorService } from './validators/backend-validator.service';
import { FrontendValidatorService } from './validators/frontend-validator.service';
import { DatabaseValidatorService } from './validators/database-validator.service';
import { StageKey, StageStatus, ValidationStatus } from '@prisma/client';
import { ValidateStagePayload, ValidationResult } from './types';

const MAX_SELF_HEALING_ATTEMPTS = 3; // §11.4 PRD V1.2

@Injectable()
export class ValidationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sandbox: SandboxService,
    private readonly backendValidator: BackendValidatorService,
    private readonly frontendValidator: FrontendValidatorService,
    private readonly databaseValidator: DatabaseValidatorService,
  ) {}

  /**
   * Dipanggil node "Validate <Nama>" di n8n setelah generation file-by-file
   * selesai. Balikan ini yang menentukan n8n lanjut (passed), masuk loop
   * Self-Heal (canSelfHeal), atau menyerah dan lanjut dengan flag peringatan
   * (attempts habis).
   */
  async validateStage(payload: ValidateStagePayload) {
    const stage = await this.prisma.artifactStage.findUnique({
      where: { projectId_stageKey: { projectId: payload.projectId, stageKey: payload.stageKey as StageKey } },
    });
    if (!stage) throw new NotFoundException('Stage tidak ditemukan');

    await this.prisma.artifactStage.update({
      where: { id: stage.id },
      data: { status: StageStatus.VALIDATING },
    });

    const result = await this.runValidator(stage.id, payload.stageKey, payload.version);

    if (result.passed) {
      await this.prisma.artifactStage.update({
        where: { id: stage.id },
        data: { status: StageStatus.GENERATED, validationStatus: ValidationStatus.PASSED },
      });
      return { passed: true, canSelfHeal: false };
    }

    const attempts = stage.selfHealingAttempts + 1;
    const canSelfHeal = attempts <= MAX_SELF_HEALING_ATTEMPTS;

    await this.prisma.artifactStage.update({
      where: { id: stage.id },
      data: {
        status: canSelfHeal ? StageStatus.SELF_HEALING : StageStatus.GENERATED,
        validationStatus: ValidationStatus.FAILED,
        selfHealingAttempts: attempts,
        failedValidation: !canSelfHeal,
      },
    });

    return { passed: false, canSelfHeal, errorLog: result.errorLog, attempts };
  }

  private async runValidator(
    artifactStageId: string,
    stageKey: ValidateStagePayload['stageKey'],
    version: number,
  ): Promise<ValidationResult> {
    if (stageKey === 'DATABASE') {
      const dir = await this.sandbox.materialize(artifactStageId, version);
      try {
        return await this.databaseValidator.validate(join(dir, 'migration.sql'));
      } finally {
        await this.sandbox.cleanup(dir);
      }
    }

    const dir = await this.sandbox.materialize(artifactStageId, version);
    try {
      return stageKey === 'BACKEND'
        ? await this.backendValidator.validate(dir)
        : await this.frontendValidator.validate(dir);
    } finally {
      await this.sandbox.cleanup(dir);
    }
  }
}
