import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import axios from 'axios';
import { OrgRole, ProjectStatus, StageKey, StageStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DecideStageDto, AssignStageDto, SetDeadlineDto } from './dto/decide-stage.dto';

interface CallerContext {
  userId: string;
  email: string;
  memberId: string;
  role: OrgRole;
}

@Injectable()
export class StagesService {
  constructor(private readonly prisma: PrismaService) {}

  /** V1.2 FR-801 — Assign Approver per Stage, sekarang ke member ATAU ke team. */
  async assign(projectId: string, stageKey: StageKey, dto: AssignStageDto, assignedBy: string) {
    const hasMember = Boolean(dto.assignedMemberId);
    const hasTeam = Boolean(dto.assignedTeamId);

    if (hasMember === hasTeam) {
      throw new BadRequestException(
        'Isi tepat satu: assignedMemberId ATAU assignedTeamId (tidak boleh dua-duanya atau kosong).',
      );
    }

    if (hasMember) {
      await this.assertMemberBelongsToProjectOrg(projectId, dto.assignedMemberId!);
    } else {
      await this.assertTeamBelongsToProjectOrg(projectId, dto.assignedTeamId!);
    }

    return this.prisma.stageAssignment.upsert({
      where: { projectId_stageKey: { projectId, stageKey } },
      update: {
        assignedMemberId: dto.assignedMemberId ?? null,
        assignedTeamId: dto.assignedTeamId ?? null,
        assignedBy,
        assignedAt: new Date(),
      },
      create: {
        projectId,
        stageKey,
        assignedMemberId: dto.assignedMemberId,
        assignedTeamId: dto.assignedTeamId,
        assignedBy,
      },
    });
  }

  /** V1.2 FR-803 — Set Stage Deadline */
  setDeadline(projectId: string, stageKey: StageKey, dto: SetDeadlineDto) {
    return this.prisma.artifactStage.update({
      where: { projectId_stageKey: { projectId, stageKey } },
      data: { deadlineAt: new Date(dto.deadlineAt) },
    });
  }

  /** V1.2 FR-1203 — revision history untuk satu stage */
  async revisions(projectId: string, stageKey: StageKey) {
    const stage = await this.prisma.artifactStage.findUniqueOrThrow({
      where: { projectId_stageKey: { projectId, stageKey } },
    });
    return this.prisma.revisionRequest.findMany({
      where: { artifactStageId: stage.id },
      orderBy: { requestedAt: 'desc' },
    });
  }

  /**
   * §9 PRD V1.2 — Approve / Reject / Request Revision. Satu-satunya tempat
   * yang boleh memanggil resumeUrl n8n, sekarang juga satu-satunya tempat
   * yang menegakkan permission per-stage (§7.1), termasuk assignment ke team.
   */
  async decide(projectId: string, stageKey: StageKey, dto: DecideStageDto, caller: CallerContext) {
    const stage = await this.prisma.artifactStage.findUnique({
      where: { projectId_stageKey: { projectId, stageKey } },
    });
    if (!stage) throw new NotFoundException('Stage tidak ditemukan');

    if (stage.status !== StageStatus.GENERATED) {
      throw new ConflictException(
        `Stage ini berstatus "${stage.status}" — tidak bisa diputuskan lagi.`,
      );
    }
    if (!stage.resumeUrl) {
      throw new ConflictException('Stage ini belum punya resume URL dari n8n. Coba lagi sebentar.');
    }

    await this.assertCanDecide(projectId, stageKey, caller);

    if (dto.decision === 'revision_requested') {
      if (!dto.comment) throw new BadRequestException('comment wajib diisi untuk request revision');

      try {
        await axios.post(stage.resumeUrl, { decision: 'revision', note: dto.comment, approver: caller.email });
      } catch (err) {
        throw new BadGatewayException(`Gagal mengirim keputusan ke n8n: ${(err as Error).message}`);
      }

      const nextRevisionNumber = stage.revisionCount + 1;
      return this.prisma.$transaction(async (tx) => {
        await tx.revisionRequest.create({
          data: {
            artifactStageId: stage.id,
            comment: dto.comment!,
            requestedBy: caller.email,
            revisionNumber: nextRevisionNumber,
          },
        });
        return tx.artifactStage.update({
          where: { id: stage.id },
          data: { status: StageStatus.REVISION_REQUESTED, revisionCount: nextRevisionNumber, resumeUrl: null },
        });
      });
    }

    try {
      await axios.post(stage.resumeUrl, {
        decision: dto.decision,
        comment: dto.comment ?? '',
        approver: caller.email,
      });
    } catch (err) {
      throw new BadGatewayException(`Gagal mengirim keputusan ke n8n: ${(err as Error).message}`);
    }

    const updated = await this.prisma.artifactStage.update({
      where: { projectId_stageKey: { projectId, stageKey } },
      data: {
        status: dto.decision === 'approved' ? StageStatus.APPROVED : StageStatus.REJECTED,
        comment: dto.comment,
        decidedBy: caller.email,
        decidedById: caller.userId,
        decidedAt: new Date(),
        resumeUrl: null,
      },
    });

    if (dto.decision === 'rejected') {
      await this.prisma.project.update({ where: { id: projectId }, data: { status: ProjectStatus.REJECTED } });
    }

    return updated;
  }

  /**
   * §7.1 permission check:
   *  - OWNER/ADMIN: selalu boleh (fallback approver).
   *  - MEMBER: boleh kalau (a) di-assign langsung sebagai member, ATAU
   *            (b) dia anggota dari TEAM yang di-assign ke stage ini.
   *  - VIEWER: tidak pernah boleh.
   */
  private async assertCanDecide(projectId: string, stageKey: StageKey, caller: CallerContext) {
    if (caller.role === OrgRole.OWNER || caller.role === OrgRole.ADMIN) return;
    if (caller.role === OrgRole.VIEWER) {
      throw new ForbiddenException('Viewer tidak bisa approve/reject/request revision');
    }

    const assignment = await this.prisma.stageAssignment.findUnique({
      where: { projectId_stageKey: { projectId, stageKey } },
    });
    if (!assignment) {
      throw new ForbiddenException('Belum ada yang di-assign untuk memutuskan stage ini');
    }

    if (assignment.assignedMemberId && assignment.assignedMemberId === caller.memberId) {
      return;
    }

    if (assignment.assignedTeamId) {
      const isInTeam = await this.prisma.teamMember.findFirst({
        where: { teamId: assignment.assignedTeamId, organizationMemberId: caller.memberId },
      });
      if (isInTeam) return;
    }

    throw new ForbiddenException('Anda tidak di-assign (langsung atau lewat team) sebagai approver untuk stage ini');
  }

  private async assertMemberBelongsToProjectOrg(projectId: string, memberId: string) {
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { organizationId: true },
    });
    const member = await this.prisma.organizationMember.findFirst({
      where: { id: memberId, organizationId: project.organizationId ?? undefined },
    });
    if (!member) throw new BadRequestException('Member ini bukan bagian dari organisasi project ini');
  }

  private async assertTeamBelongsToProjectOrg(projectId: string, teamId: string) {
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { organizationId: true },
    });
    const team = await this.prisma.team.findFirst({
      where: { id: teamId, organizationId: project.organizationId ?? undefined },
    });
    if (!team) throw new BadRequestException('Team ini bukan bagian dari organisasi project ini');
  }
}
