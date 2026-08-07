import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { StageKey } from '@prisma/client';

export class StageReadyDto {
  @IsUUID()
  projectId: string;

  @IsEnum(StageKey)
  stageKey: StageKey;

  @IsOptional()
  @IsString()
  artifactName?: string;

  @IsOptional()
  @IsString()
  content?: string;

  // Present for every stage except QA, which has no approval gate.
  @IsOptional()
  @IsString()
  resumeUrl?: string;

  @IsOptional()
  @IsString()
  n8nExecutionId?: string;
}
