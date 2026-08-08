import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTeamDto, AddTeamMemberDto } from './dto/team.dto';

@Injectable()
export class TeamsService {
  constructor(private readonly prisma: PrismaService) {}

  create(organizationId: string, dto: CreateTeamDto) {
    return this.prisma.team.create({
      data: { organizationId, name: dto.name, description: dto.description },
    });
  }

  list(organizationId: string) {
    return this.prisma.team.findMany({
      where: { organizationId },
      include: { members: { include: { member: { include: { user: true } } } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async findOrThrow(organizationId: string, teamId: string) {
    const team = await this.prisma.team.findFirst({ where: { id: teamId, organizationId } });
    if (!team) throw new NotFoundException('Team tidak ditemukan');
    return team;
  }

  async addMember(organizationId: string, teamId: string, dto: AddTeamMemberDto) {
    await this.findOrThrow(organizationId, teamId);

    const orgMember = await this.prisma.organizationMember.findFirst({
      where: { id: dto.organizationMemberId, organizationId },
    });
    if (!orgMember) throw new NotFoundException('Member organisasi tidak ditemukan');

    return this.prisma.teamMember.upsert({
      where: { teamId_organizationMemberId: { teamId, organizationMemberId: dto.organizationMemberId } },
      update: { jobTitle: dto.jobTitle },
      create: { teamId, organizationMemberId: dto.organizationMemberId, jobTitle: dto.jobTitle },
    });
  }

  async removeMember(organizationId: string, teamId: string, teamMemberId: string) {
    await this.findOrThrow(organizationId, teamId);
    return this.prisma.teamMember.delete({ where: { id: teamMemberId } });
  }
}
