import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../common/rbac/roles.guard';
import { Roles } from '../../common/rbac/roles.decorator';
import { OrgRole } from '@prisma/client';
import { TeamsService } from './teams.service';
import { CreateTeamDto, AddTeamMemberDto } from './dto/team.dto';

@Controller('organizations/:organizationId/teams')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Post()
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  create(@Param('organizationId') organizationId: string, @Body() dto: CreateTeamDto) {
    return this.teams.create(organizationId, dto);
  }

  @Get()
  list(@Param('organizationId') organizationId: string) {
    return this.teams.list(organizationId);
  }

  @Post(':teamId/members')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  addMember(
    @Param('organizationId') organizationId: string,
    @Param('teamId') teamId: string,
    @Body() dto: AddTeamMemberDto,
  ) {
    return this.teams.addMember(organizationId, teamId, dto);
  }

  @Delete(':teamId/members/:teamMemberId')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  removeMember(
    @Param('organizationId') organizationId: string,
    @Param('teamId') teamId: string,
    @Param('teamMemberId') teamMemberId: string,
  ) {
    return this.teams.removeMember(organizationId, teamId, teamMemberId);
  }
}
