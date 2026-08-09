import { IsString, MaxLength, MinLength } from 'class-validator';

export class TestGenerateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  prompt: string;
}
