import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

export class WorkflowEventDto {
  @IsUUID()
  projectId: string;

  @IsOptional()
  @IsIn(['COMPLETED', 'FAILED'])
  status?: 'COMPLETED' | 'FAILED';

  @IsOptional()
  @IsString()
  message?: string;
}
