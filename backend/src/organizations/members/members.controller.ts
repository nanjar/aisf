import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../common/rbac/roles.guard';
import { Roles } from '../../common/rbac/roles.decorator';
import { OrgRole } from '@prisma/client';
import { MembersService } from './members.service';
import { InviteMemberDto, UpdateMemberDto } from './dto/member.dto';

@Controller('organizations/:organizationId/members')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  list(@Param('organizationId') organizationId: string) {
    return this.members.list(organizationId);
  }

  @Post('invite')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  invite(
    @Param('organizationId') organizationId: string,
    @Req() req: Request & { user: { userId: string } },
    @Body() dto: InviteMemberDto,
  ) {
    return this.members.invite(organizationId, req.user.userId, dto);
  }

  @Post(':memberId/resend-invite')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  resend(@Param('organizationId') organizationId: string, @Param('memberId') memberId: string) {
    return this.members.resendInvite(organizationId, memberId);
  }

  @Patch(':memberId')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  update(
    @Param('organizationId') organizationId: string,
    @Param('memberId') memberId: string,
    @Body() dto: UpdateMemberDto,
  ) {
    return this.members.update(organizationId, memberId, dto);
  }

  @Delete(':memberId')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  remove(@Param('organizationId') organizationId: string, @Param('memberId') memberId: string) {
    return this.members.remove(organizationId, memberId);
  }
}
