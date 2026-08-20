import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class TestGenerateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  prompt: string;

  /** Opsional — override LLM_DEFAULT_PROVIDER buat testing provider tertentu (mis. "claude") tanpa ubah default. */
  @IsOptional()
  @IsString()
  provider?: string;
}
