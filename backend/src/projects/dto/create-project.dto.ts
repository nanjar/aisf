import { IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateProjectDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @MinLength(20, { message: 'Business idea harus dijelaskan lebih detail (minimal 20 karakter)' })
  businessIdea: string;

  @IsOptional()
  @IsString()
  knowledgeBaseId?: string;

  @IsOptional()
  @IsString()
  aiModel?: string;
}
