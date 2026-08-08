import { IsEnum, IsInt, IsOptional, IsString, IsUUID } from 'class-validator';
import { StageKey } from '@prisma/client';

export class UploadFileDto {
  @IsUUID()
  projectId: string;

  @IsEnum(StageKey)
  stageKey: StageKey;

  @IsString()
  fileName: string;

  @IsString()
  contentBase64: string;

  @IsString()
  mimeType: string;

  @IsOptional()
  @IsInt()
  version?: number;
}
