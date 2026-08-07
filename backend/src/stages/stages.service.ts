import { BadGatewayException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import axios from 'axios';
import { ProjectStatus, StageKey, StageStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DecideStageDto } from './dto/decide-stage.dto';

@Injectable()
export class StagesService {
  constructor(private readonly prisma: PrismaService) {}

  async decide(projectId: string, stageKey: StageKey, dto: DecideStageDto, approverEmail: string) {
    const stage = await this.prisma.artifactStage.findUnique({
      where: { projectId_stageKey: { projectId, stageKey } },
    });
    if (!stage) throw new NotFoundException('Stage tidak ditemukan');

    if (stage.status !== StageStatus.GENERATED) {
      // Covers: not generated yet, or already decided. This is what stops
      // the "clicked resume twice" problem from before — once a decision
      // is recorded here, the resumeUrl is cleared and this guard blocks
      // any further attempt to reuse it.
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
