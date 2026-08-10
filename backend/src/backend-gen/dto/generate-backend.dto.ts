import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

export class GenerateBackendDto {
  @IsUUID()
  projectId: string;

  @IsOptional()
  @IsString()
  resumeUrl?: string;

  @IsOptional()
  @IsString()
  n8nExecutionId?: string;

  /** Diisi n8n dari $json.body?.decision saat ini loop revision, kosong saat generation pertama. */
  @IsOptional()
  @IsIn(['revision'])
  decision?: 'revision';

  /** Feedback reviewer, wajib ada kalau decision === 'revision'. */
  @IsOptional()
  @IsString()
  note?: string;
}
