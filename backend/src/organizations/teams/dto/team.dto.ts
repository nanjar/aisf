import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateTeamDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  description?: string;
}

export class AddTeamMemberDto {
  @IsString()
  organizationMemberId: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  jobTitle?: string;
}
