import { Injectable, NotFoundException } from '@nestjs/common';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { SandboxService } from './sandbox.service';
import { BackendValidatorService } from './validators/backend-validator.service';
import { FrontendValidatorService } from './validators/frontend-validator.service';
import { DatabaseValidatorService } from './validators/database-validator.service';
import { StageKey, StageStatus, ValidationStatus } from '@prisma/client';
import { ValidateStagePayload, ValidationResult } from './types';

const MAX_SELF_HEALING_ATTEMPTS = 3;

@Injectable()
export class ValidationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sandbox: SandboxService,
    private readonly backendValidator: BackendValidatorService,
    private readonly frontendValidator: FrontendValidatorService,
    private readonly databaseValidator: DatabaseValidatorService,
  ) {}

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
        data: { status: StageStatus.GENERATED, validationStatus: ValidationStatus.PASSED, failedValidation: false },
      });
      return { passed: true, canSelfHeal: false, attempts: stage.selfHealingAttempts, affectedFiles: [] };
    }

    // Atomic gate: concurrent validation callbacks cannot consume more than the
    // configured number of self-healing slots. The previous read-then-write logic
    // allowed parallel callbacks to race and push the counter beyond the limit.
    const reserved = await this.prisma.artifactStage.updateMany({
      where: {
        id: stage.id,
        selfHealingAttempts: { lt: MAX_SELF_HEALING_ATTEMPTS },
      },
      data: {
        selfHealingAttempts: { increment: 1 },
        status: StageStatus.SELF_HEALING,
        validationStatus: ValidationStatus.FAILED,
        failedValidation: false,
      },
    });

    if (reserved.count === 1) {
      const attempts = stage.selfHealingAttempts + 1;
      return {
        passed: false,
        canSelfHeal: true,
        errorLog: result.errorLog,
        attempts,
        affectedFiles: result.affectedFiles ?? [],
      };
    }

    // No slot remains. Do not enter SELF_HEALING again. This is terminal for
    // automatic repair; n8n must stop its retry loop when canSelfHeal=false.
    const current = await this.prisma.artifactStage.update({
      where: { id: stage.id },
      data: {
        status: StageStatus.GENERATED,
        validationStatus: ValidationStatus.FAILED,
        failedValidation: true,
      },
    });

    return {
      passed: false,
      canSelfHeal: false,
      errorLog: result.errorLog,
      attempts: current.selfHealingAttempts,
      affectedFiles: result.affectedFiles ?? [],
    };
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
      const result = stageKey === 'BACKEND'
        ? await this.backendValidator.validate(dir)
        : await this.frontendValidator.validate(dir);
      return { ...result, affectedFiles: this.extractAffectedFiles(result.errorLog) };
    } finally {
      await this.sandbox.cleanup(dir);
    }
  }

  private extractAffectedFiles(errorLog?: string): string[] {
    if (!errorLog) return [];
    const files = new Set<string>();
    // TypeScript compiler format: src/foo.ts(123,45): error TSxxxx: ...
    const tsPattern = /(?:^|\n)([^\n:(]+\.tsx?|[^\n:(]+\.jsx?)\(\d+,\d+\):\s*(?:error|warning)\s+TS\d+/g;
    for (const match of errorLog.matchAll(tsPattern)) {
      files.add(match[1].trim());
    }
    // Also support common compiler output with a colon before the line number.
    const colonPattern = /(?:^|\n)([^\n:]+\.(?:ts|tsx|js|jsx)):\d+:\d+\s*[-:]?/g;
    for (const match of errorLog.matchAll(colonPattern)) {
      files.add(match[1].trim());
    }
    return [...files];
  }
}
