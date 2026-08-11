import { IsInt, Min } from 'class-validator';

export class RollbackStageDto {
  @IsInt()
  @Min(1)
  version: number;
}
