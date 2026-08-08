import { IsDateString, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
export class DecideStageDto {
  @IsIn(['approved', 'rejected', 'revision_requested'])
  decision: 'approved' | 'rejected' | 'revision_requested';
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}
export class AssignStageDto {
  // V1.2 (team assignment): isi TEPAT SATU dari dua field ini — divalidasi di StagesService
  // (bukan di sini) karena class-validator tidak punya cara mudah menyatakan "XOR" dua field.
  @IsOptional()
  @IsString()
  assignedMemberId?: string;

  @IsOptional()
  @IsString()
  assignedTeamId?: string;
}
export class SetDeadlineDto {
  @IsDateString()
  deadlineAt: string;
}
