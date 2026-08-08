import { IsEmail, IsEnum, IsOptional } from 'class-validator';
import { OrgRole, MemberStatus } from '@prisma/client';

export class InviteMemberDto {
  @IsEmail()
  email: string;

  @IsEnum(OrgRole)
  role: OrgRole;
}

export class UpdateMemberDto {
  @IsOptional()
  @IsEnum(OrgRole)
  role?: OrgRole;

  @IsOptional()
  @IsEnum(MemberStatus)
  status?: MemberStatus;
}
