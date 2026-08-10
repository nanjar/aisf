import { BadGatewayException, BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as archiver from 'archiver';
import { PassThrough } from 'stream';
import { OrgRole, ProjectStatus, StageKey, StageStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { STAGE_LABELS, STAGE_ORDER } from '../common/stage-order';
import { CreateProjectDto } from './dto/create-project.dto';
import { SetProjectDeadlineDto } from './dto/set-deadline.dto';

const ARTIFACT_FILE_NAMES: Record<string, string> = {
  PRD: 'prd.md',
  ARCHITECTURE: 'architecture.yaml',
  ESTIMATION: 'estimation.yaml',
  DATABASE: 'database.sql',
  BACKEND: 'backend-source-summary.txt',
  FRONTEND: 'frontend-source-summary.txt',
  QA: 'qa-report.md',
  PACKAGE: 'project-manifest.json',
};

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly storage: StorageService,
  ) {}

  async create(dto: CreateProjectDto, createdById: string) {
    const membership = await this.prisma.organizationMember.findFirst({
      where: { userId: createdById, status: 'ACTIVE' },
      orderBy: { invitedAt: 'asc' },
      select: { organizationId: true },
    });

    const project = await this.prisma.project.create({
      data: {
        name: dto.name,
        businessIdea: dto.businessIdea,
        knowledgeBaseId: dto.knowledgeBaseId,
        aiModel: dto.aiModel ?? 'gpt-5-mini',
        organizationId: membership?.organizationId,
        createdById,
        stages: {
          create: STAGE_ORDER.map((stageKey) => ({ stageKey, status: StageStatus.PENDING })),
        },
      },
      include: { stages: true },
    });

    const webhookUrl = this.config.get<string>('N8N_START_WEBHOOK_URL');
    try {
      await axios.post(webhookUrl as string, {
        projectId: project.id,
        businessIdea: project.businessIdea,
        knowledgeBaseId: project.knowledgeBaseId,
        aiModel: project.aiModel,
        userId: createdById,
      });
    } catch (err) {
      throw new BadGatewayException(
        `Project dibuat, tapi gagal memicu workflow n8n: ${(err as Error).message}`,
      );
    }

    return this.withCurrentStage(project);
  }

  setDeadline(id: string, dto: SetProjectDeadlineDto) {
    return this.prisma.project.update({ where: { id }, data: { deadlineAt: new Date(dto.deadlineAt) } });
  }

  async findAll(userId: string) {
    const member = await this.resolvePrimaryMembership(userId);
    if (!member) return [];

    const accessibleIds = await this.getAccessibleProjectIds(member.organizationId, member);

    const projects = await this.prisma.project.findMany({
      where: {
        organizationId: member.organizationId,
        ...(accessibleIds ? { id: { in: accessibleIds } } : {}),
      },
      include: { stages: true },
      orderBy: { createdAt: 'desc' },
    });
    return projects.map((p) => this.withCurrentStage(p));
  }

  async findOne(id: string, userId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: {
        stages: true,
        stageAssignments: {
          include: {
            assignedMember: { include: { user: { select: { id: true, email: true, name: true } } } },
            assignedTeam: true,
          },
        },
      },
    });
    if (!project) throw new NotFoundException('Project tidak ditemukan');

    await this.assertVisibleToMember(project.id, project.organizationId, userId);

    const stages = STAGE_ORDER.map((stageKey) => {
      const stage = project.stages.find((s) => s.stageKey === stageKey);
      const assignment = project.stageAssignments.find((a) => a.stageKey === stageKey);

      let assignedTo: { type: 'member' | 'team'; id: string; label: string } | null = null;
      if (assignment?.assignedMemberId && assignment.assignedMember) {
        assignedTo = {
          type: 'member',
          id: assignment.assignedMemberId,
          label: assignment.assignedMember.user.name ?? assignment.assignedMember.user.email,
        };
      } else if (assignment?.assignedTeamId && assignment.assignedTeam) {
        assignedTo = { type: 'team', id: assignment.assignedTeamId, label: assignment.assignedTeam.name };
      }

      return {
        stageKey,
        label: STAGE_LABELS[stageKey],
        status: stage?.status ?? StageStatus.PENDING,
        artifactName: stage?.artifactName ?? null,
        content: stage?.content ?? null,
        comment: stage?.comment ?? null,
        decidedBy: stage?.decidedBy ?? null,
        generatedAt: stage?.generatedAt ?? null,
        decidedAt: stage?.decidedAt ?? null,
        assignedTo,
        // V1.2: deadline per-stage (FR-803) — backend endpoint sudah ada sejak sebelumnya,
        // ini baru pertama kali diekspos di read model supaya frontend bisa menampilkannya.
        deadlineAt: stage?.deadlineAt?.toISOString() ?? null,
      };
    });

    return {
      id: project.id,
      name: project.name,
      businessIdea: project.businessIdea,
      knowledgeBaseId: project.knowledgeBaseId,
      aiModel: project.aiModel,
      status: project.status,
      organizationId: project.organizationId,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      // V1.2: deadline tingkat project (FR-802)
      deadlineAt: project.deadlineAt?.toISOString() ?? null,
      stages,
    };
  }

  async buildDownloadArchive(id: string, userId: string): Promise<PassThrough> {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: { stages: true },
    });
    if (!project) throw new NotFoundException('Project tidak ditemukan');

    await this.assertVisibleToMember(project.id, project.organizationId, userId);

    if (project.status !== ProjectStatus.COMPLETED) {
      throw new BadRequestException(
        `Project belum selesai (status saat ini: ${project.status}). Download hanya tersedia setelah status COMPLETED.`,
      );
    }

    const archive = archiver('zip', { zlib: { level: 9 } });
    const output = new PassThrough();
    archive.on('error', (err) => output.destroy(err));
    archive.pipe(output);

    for (const stageKey of STAGE_ORDER) {
      // V1.3 — UIUX punya 7 file asli di S3 (lihat blok khusus di bawah), bukan
      // satu blob content seperti stage lain. stage.content di sini cuma ringkasan.
      if (stageKey === StageKey.UIUX) continue;
      const stage = project.stages.find((s) => s.stageKey === stageKey);
      if (!stage?.content) continue;
      const fileName = ARTIFACT_FILE_NAMES[stageKey] ?? `${stageKey.toLowerCase()}.txt`;
      archive.append(stage.content, { name: fileName });
    }

    // V1.3 §11 — sertakan 7 file UI/UX Design Specification asli dari S3, bukan ringkasan.
    const uiuxStage = project.stages.find((s) => s.stageKey === StageKey.UIUX);
    if (uiuxStage) {
      const generationFiles = await this.prisma.generationFile.findMany({
        where: {
          generationJob: { artifactStageId: uiuxStage.id },
          artifactObjectId: { not: null },
        },
        include: { artifactObject: true },
        orderBy: { path: 'asc' },
      });
      for (const gf of generationFiles) {
        if (!gf.artifactObject) continue;
        try {
          const stream = await this.storage.getObjectStream(gf.artifactObject.bucket, gf.artifactObject.objectKey);
          archive.append(stream as any, { name: gf.path }); // path sudah "uiux/xxx.yaml"
        } catch (err) {
          // Best-effort — satu file gagal diunduh dari S3 tidak boleh menggagalkan seluruh zip.
        }
      }
    }

    archive.append(
      [
        `# ${project.name}`,
        '',
        `Generated by AI Software Factory — project ${project.id}`,
        `Status: ${project.status}`,
        `Updated: ${project.updatedAt.toISOString()}`,
      ].join('\n'),
      { name: 'README.md' },
    );

    await archive.finalize();
    return output;
  }

  private async resolvePrimaryMembership(userId: string) {
    return this.prisma.organizationMember.findFirst({
      where: { userId, status: 'ACTIVE' },
      orderBy: { invitedAt: 'asc' },
    });
  }

  private async getAccessibleProjectIds(
    organizationId: string,
    member: { id: string; role: OrgRole },
  ): Promise<string[] | null> {
    if (member.role !== OrgRole.MEMBER) return null;

    const teamMemberships = await this.prisma.teamMember.findMany({
      where: { organizationMemberId: member.id },
      select: { teamId: true },
    });
    const teamIds = teamMemberships.map((t) => t.teamId);

    const assignments = await this.prisma.stageAssignment.findMany({
      where: {
        project: { organizationId },
        OR: [
          { assignedMemberId: member.id },
          ...(teamIds.length ? [{ assignedTeamId: { in: teamIds } }] : []),
        ],
      },
      select: { projectId: true },
      distinct: ['projectId'],
    });

    return assignments.map((a) => a.projectId);
  }

  private async assertVisibleToMember(projectId: string, organizationId: string | null, userId: string) {
    const member = await this.resolvePrimaryMembership(userId);
    if (!member || !organizationId || member.organizationId !== organizationId) return;
    if (member.role !== OrgRole.MEMBER) return;

    const accessibleIds = await this.getAccessibleProjectIds(organizationId, member);
    if (!accessibleIds?.includes(projectId)) {
      throw new NotFoundException('Project tidak ditemukan');
    }
  }

  private withCurrentStage(project: { stages: { stageKey: string; status: StageStatus }[] } & Record<string, any>) {
    const currentStage =
      STAGE_ORDER.find((key) => {
        const stage = project.stages.find((s: any) => s.stageKey === key);
        return !stage || stage.status !== StageStatus.APPROVED;
      }) ?? null;

    return {
      id: project.id,
      name: project.name,
      businessIdea: project.businessIdea,
      status: project.status,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      currentStage,
      currentStageLabel: currentStage ? STAGE_LABELS[currentStage] : null,
      // V1.2: dipakai badge deadline di dashboard
      deadlineAt: project.deadlineAt?.toISOString() ?? null,
    };
  }
}
