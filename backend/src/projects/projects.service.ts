import { BadGatewayException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { StageStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { STAGE_LABELS, STAGE_ORDER } from '../common/stage-order';
import { CreateProjectDto } from './dto/create-project.dto';

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async create(dto: CreateProjectDto) {
    const project = await this.prisma.project.create({
      data: {
        name: dto.name,
        businessIdea: dto.businessIdea,
        knowledgeBaseId: dto.knowledgeBaseId,
        aiModel: dto.aiModel ?? 'gpt-5-mini',
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
        userId: 'app',
      });
    } catch (err) {
      // Project row stays as a record even if n8n couldn't be reached —
      // surface the failure clearly instead of silently leaving it stuck.
      throw new BadGatewayException(
        `Project dibuat, tapi gagal memicu workflow n8n: ${(err as Error).message}`,
      );
    }

    return this.withCurrentStage(project);
  }

  async findAll() {
    const projects = await this.prisma.project.findMany({
      include: { stages: true },
      orderBy: { createdAt: 'desc' },
    });
    return projects.map((p) => this.withCurrentStage(p));
  }

  async findOne(id: string) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: { stages: true },
    });
    if (!project) throw new NotFoundException('Project tidak ditemukan');

    const stages = STAGE_ORDER.map((stageKey) => {
      const stage = project.stages.find((s) => s.stageKey === stageKey);
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
        // resumeUrl intentionally omitted from the read model — decisions
        // go through this backend's own /decision endpoint, never exposed
        // directly to the browser.
      };
    });

    return {
      id: project.id,
      name: project.name,
      businessIdea: project.businessIdea,
      knowledgeBaseId: project.knowledgeBaseId,
      aiModel: project.aiModel,
      status: project.status,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      stages,
    };
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
      currentStageLabel: currentStage ? STAGE_LABELS[currentStage] : 'Selesai',
    };
  }
}
