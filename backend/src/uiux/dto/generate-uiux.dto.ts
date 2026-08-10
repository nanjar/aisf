import { IsOptional, IsString, IsUUID } from 'class-validator';

export class GenerateUiuxDto {
  @IsUUID()
  projectId: string;

  // §54 — dipakai sama seperti stage lain: n8n "Wait for Webhook" node yang
  // di-resume ketika manusia approve/reject/request-revision.
  @IsOptional()
  @IsString()
  resumeUrl?: string;

  @IsOptional()
  @IsString()
  n8nExecutionId?: string;
}
