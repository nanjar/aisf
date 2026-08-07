import { Injectable, NotFoundException } from '@nestjs/common';
import { ProjectStatus, StageStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StageReadyDto } from './dto/stage-ready.dto';
import { WorkflowEventDto } from './dto/workflow-event.dto';

@Injectable()
export class WebhooksService {
  constructor(private readonly prisma: PrismaService) {}

  async handleStageReady(dto: StageReadyDto) {
    const project = await this.prisma.project.findUnique({ where: { id: dto.projectId } });
    if (!project) throw new NotFoundException('Project tidak ditemukan');

    await this.prisma.artifactStage.update({
      where: { projectId_stageKey: { projectId: dto.projectId, stageKey: dto.stageKey } },
      data: {
        artifactName: dto.artifactName,
        content: dto.content,
        status: StageStatus.GENERATED,
        resumeUrl: dto.resumeUrl,
        generatedAt: new Date(),
      },
    });

    if (dto.n8nExecutionId && dto.n8nExecutionId !== project.n8nExecutionId) {
      await this.prisma.project.update({
        where: { id: dto.projectId },
        data: { n8nExecutionId: dto.n8nExecutionId },
      });
    }

    return { ok: true };
  }

  async handleWorkflowEvent(dto: WorkflowEventDto) {
    const project = await this.prisma.project.findUnique({ where: { id: dto.projectId } });
    if (!project) throw new NotFoundException('Project tidak ditemukan');

    await this.prisma.project.update({
      where: { id: dto.projectId },
      data: { status: dto.status === 'FAILED' ? ProjectStatus.FAILED : ProjectStatus.COMPLETED },
    });

    return { ok: true };
  }
}
