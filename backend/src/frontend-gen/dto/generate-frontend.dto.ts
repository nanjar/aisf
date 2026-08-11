import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

export class GenerateFrontendDto {
  @IsUUID()
  projectId: string;

  @IsOptional()
  @IsString()
  resumeUrl?: string;

  @IsOptional()
  @IsString()
  n8nExecutionId?: string;

  @IsOptional()
  @IsIn(['revision'])
  decision?: 'revision';

  @IsOptional()
  @IsString()
  note?: string;
}
