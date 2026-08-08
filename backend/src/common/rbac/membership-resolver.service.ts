import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MemberStatus } from '@prisma/client';

@Injectable()
export class MembershipResolverService {
  constructor(private readonly prisma: PrismaService) {}

  /** 404 (bukan 403) kalau user bukan anggota aktif — supaya tidak bocorkan keberadaan organisasi. */
  async resolveByOrganization(userId: string, organizationId: string) {
    const member = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
    });
    if (!member || member.status !== MemberStatus.ACTIVE) {
      throw new NotFoundException('Organization tidak ditemukan');
    }
    return member;
  }

  async resolveByProject(userId: string, projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { organizationId: true },
    });
    if (!project?.organizationId) {
      throw new NotFoundException('Project tidak ditemukan');
    }
    return this.resolveByOrganization(userId, project.organizationId);
  }
}
