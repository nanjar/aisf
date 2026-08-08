import { IsIn, IsInt, IsUUID } from 'class-validator';

export class ValidateStageDto {
  @IsUUID()
  projectId: string;

  @IsIn(['DATABASE', 'BACKEND', 'FRONTEND'])
  stageKey: 'DATABASE' | 'BACKEND' | 'FRONTEND';

  @IsInt()
  version: number;
}
