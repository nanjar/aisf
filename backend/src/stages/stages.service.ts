import { BadGatewayException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import axios from 'axios';
import { ProjectStatus, StageKey, StageStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DecideStageDto } from './dto/decide-stage.dto';

@Injectable()
export class StagesService {
  constructor(private readonly prisma: PrismaService) {}

  // V1.1.1: ownerId ditambahkan supaya user tidak bisa approve/reject project orang lain
  // walau tahu UUID-nya secara langsung (sebelumnya endpoint ini TIDAK melakukan pengecekan
  // kepemilikan sama sekali — siapa pun yang login bisa memutuskan tahap project siapa pun).
  async decide(projectId: string, stageKey: StageKey, dto: DecideStageDto, ownerId: string, approverEmail: string) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, ownerId } });
    if (!project) throw new NotFoundException('Project tidak ditemukan');

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

    try {
      await axios.post(stage.resumeUrl, {
        decision: dto.decision,
        comment: dto.comment ?? '',
        approver: approverEmail,
      });
    } catch (err) {
      throw new BadGatewayException(`Gagal mengirim keputusan ke n8n: ${(err as Error).message}`);
    }

    const updated = await this.prisma.artifactStage.update({
      where: { projectId_stageKey: { projectId, stageKey } },
      data: {
        status: dto.decision === 'approved' ? StageStatus.APPROVED : StageStatus.REJECTED,
        comment: dto.comment,
        decidedBy: approverEmail,
        decidedAt: new Date(),
        resumeUrl: null,
      },
    });

    if (dto.decision === 'rejected') {
      await this.prisma.project.update({
        where: { id: projectId },
        data: { status: ProjectStatus.REJECTED },
      });
    }

    return updated;
  }
}
