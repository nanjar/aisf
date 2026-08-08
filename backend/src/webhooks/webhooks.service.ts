import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ProjectStatus, StageKey, StageStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { ValidationService } from '../generation/validation.service';
import { StageReadyDto } from './dto/stage-ready.dto';
import { WorkflowEventDto } from './dto/workflow-event.dto';
import { UploadFileDto } from './dto/upload-file.dto';
import { ValidateStageDto } from './dto/validate-stage.dto';

// V1.2: nama file + tipe konten untuk artifact "satu file utuh per stage" — dipakai saat
// handleStageReady() menyalin isi teks stage ke S3, terpisah dari mekanisme file-by-file
// (handleUploadFile) yang didesain untuk generation loop yang lebih granular.
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

const ARTIFACT_CONTENT_TYPES: Record<string, string> = {
  PRD: 'text/markdown; charset=utf-8',
  ARCHITECTURE: 'text/yaml; charset=utf-8',
  ESTIMATION: 'text/yaml; charset=utf-8',
  DATABASE: 'application/sql; charset=utf-8',
  BACKEND: 'text/plain; charset=utf-8',
  FRONTEND: 'text/plain; charset=utf-8',
  QA: 'text/markdown; charset=utf-8',
  PACKAGE: 'application/json; charset=utf-8',
};

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly validation: ValidationService,
  ) {}

  async handleStageReady(dto: StageReadyDto) {
    const project = await this.prisma.project.findUnique({ where: { id: dto.projectId } });
    if (!project) throw new NotFoundException('Project tidak ditemukan');

    const stage = await this.prisma.artifactStage.update({
      where: { projectId_stageKey: { projectId: dto.projectId, stageKey: dto.stageKey } },
      data: {
        artifactName: dto.artifactName,
        content: dto.content,
        status: StageStatus.GENERATED,
        resumeUrl: dto.resumeUrl,
        generatedAt: new Date(),
      },
    });

    // V1.2: simpan salinan permanen ke S3 setiap kali satu stage selesai — SEBELUMNYA
    // storage.uploadArtifact() cuma terpanggil dari handleUploadFile() (endpoint terpisah
    // untuk mekanisme file-by-file generation yang TIDAK dipakai workflow n8n produksi saat
    // ini). Tanpa ini, S3 selalu kosong walau infrastrukturnya sudah siap. Best-effort —
    // kegagalan S3 TIDAK menggagalkan webhook ini, Postgres tetap sumber utama.
    if (dto.content && project.createdById) {
      try {
        const fileName = ARTIFACT_FILE_NAMES[dto.stageKey] ?? `${dto.stageKey.toLowerCase()}.txt`;
        const mimeType = ARTIFACT_CONTENT_TYPES[dto.stageKey] ?? 'text/plain; charset=utf-8';
        await this.storage.uploadArtifact({
          artifactStageId: stage.id,
          createdById: project.createdById,
          projectId: project.id,
          stageKey: dto.stageKey.toLowerCase(),
          fileName,
          content: Buffer.from(dto.content, 'utf-8'),
          mimeType,
          version: stage.revisionCount + 1,
        });
      } catch (err) {
        this.logger.error(
          `Gagal upload artifact ${dto.stageKey} (project ${project.id}) ke S3`,
          err as Error,
        );
      }
    }

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

  /**
   * V1.2 §11.1 — satu file dari loop file-by-file generation. Menulis ke S3
   * (struktur users/{userId}/projects/{id}/artifacts/..., lihat StorageService)
   * dan mencatat metadata-nya sebagai ArtifactObject.
   */
  async handleUploadFile(dto: UploadFileDto) {
    const project = await this.prisma.project.findUnique({ where: { id: dto.projectId } });
    if (!project) throw new NotFoundException('Project tidak ditemukan');
    if (!project.createdById) {
      throw new BadRequestException(
        'Project ini belum punya createdById (dibuat sebelum V1.2) — tidak bisa tentukan folder S3.',
      );
    }

    const stage = await this.prisma.artifactStage.findUnique({
      where: { projectId_stageKey: { projectId: dto.projectId, stageKey: dto.stageKey } },
    });
    if (!stage) throw new NotFoundException('Stage tidak ditemukan');

    const content = Buffer.from(dto.contentBase64, 'base64');

    return this.storage.uploadArtifact({
      artifactStageId: stage.id,
      createdById: project.createdById,
      projectId: project.id,
      stageKey: dto.stageKey.toLowerCase(),
      fileName: dto.fileName,
      content,
      mimeType: dto.mimeType || 'application/octet-stream',
      version: dto.version ?? 1,
    });
  }

  /** V1.2 §11.3 — dipanggil node "Validate <Nama>" setelah generation file-by-file selesai. */
  handleValidateStage(dto: ValidateStageDto) {
    return this.validation.validateStage(dto);
  }
}
