import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import * as yaml from 'js-yaml';
import { GenerationJobStatus, GenerationFileStatus, StageKey, StageStatus, ValidationLevel } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { LLMService } from '../llm/llm.service';
import { LLMProviderError } from '../llm/types';
import { GenerateUiuxDto } from './dto/generate-uiux.dto';
import { UIUX_PROMPT_VERSION, UIUX_FILE_PROMPTS, buildUiuxUserPrompt } from './prompts';
import { validateSingleFile } from './validation';

/** Safety net kalau LLM tetap membungkus output dalam code fence walau sudah dilarang di prompt.
 * Dipecah jadi 2 replace independen (bukan 1 regex end-to-end) supaya tetap robust walau closing
 * fence tidak persis di akhir string (trailing whitespace/newline ekstra, dsb — kasus nyata yang
 * bikin regex versi awal gagal match dan fence ```yaml lolos mentah-mentah ke parser YAML). */
function stripCodeFence(content: string): string {
  let text = content.trim();
  text = text.replace(/^```[a-zA-Z0-9_-]*\r?\n/, '');
  text = text.replace(/\r?\n?```\s*$/, '');
  return text.trim();
}

const REQUIRED_FILES = [
  'design-spec.yaml',
  'screens.yaml',
  'user-flows.yaml',
  'components.yaml',
  'design-system.yaml',
  'navigation.yaml',
  'accessibility.md',
] as const;

const MAX_ATTEMPTS = 3; // §36 — retry tidak boleh infinite

@Injectable()
export class UiuxService {
  private readonly logger = new Logger(UiuxService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly llm: LLMService,
  ) {}

  /** §81 n8n flow — dipanggil setelah Architecture APPROVED. */
  async generate(dto: GenerateUiuxDto) {
    const project = await this.prisma.project.findUnique({
      where: { id: dto.projectId },
      include: { stages: true },
    });
    if (!project) throw new NotFoundException('Project tidak ditemukan');
    if (!project.createdById) {
      throw new BadRequestException(
        'Project ini belum punya createdById (dibuat sebelum V1.2) — tidak bisa tentukan folder S3.',
      );
    }

    const prdStage = project.stages.find((s) => s.stageKey === StageKey.PRD);
    const archStage = project.stages.find((s) => s.stageKey === StageKey.ARCHITECTURE);
    const uiuxStage = project.stages.find((s) => s.stageKey === StageKey.UIUX);

    if (!prdStage || prdStage.status !== StageStatus.APPROVED || !prdStage.content) {
      throw new ConflictException('PRD belum APPROVED — UI/UX Designer butuh PRD sebagai input.');
    }
    if (!archStage || archStage.status !== StageStatus.APPROVED || !archStage.content) {
      throw new ConflictException('Architecture belum APPROVED — UI/UX Designer butuh Architecture sebagai input.');
    }
    if (!uiuxStage) {
      throw new NotFoundException(
        'Stage UIUX tidak ditemukan untuk project ini (project dibuat sebelum V1.3 Fase 2?)',
      );
    }
    if (uiuxStage.status === StageStatus.GENERATING) {
      throw new ConflictException('Generation UI/UX untuk project ini sedang berjalan.');
    }

    // §36/§75 RETRY_EXHAUSTED — hitung attempt dari histori job yang sudah ada untuk stage ini.
    const previousAttempts = await this.prisma.generationJob.count({
      where: { artifactStageId: uiuxStage.id },
    });
    const attempt = previousAttempts + 1;
    if (attempt > MAX_ATTEMPTS) {
      throw new ConflictException(
        `RETRY_EXHAUSTED — sudah ${previousAttempts} kali percobaan (maksimal ${MAX_ATTEMPTS}). Perlu intervensi manual.`,
      );
    }

    await this.prisma.artifactStage.update({
      where: { id: uiuxStage.id },
      data: { status: StageStatus.GENERATING },
    });

    const job = await this.prisma.generationJob.create({
      data: {
        artifactStageId: uiuxStage.id,
        model: 'deepseek-chat',
        promptVersion: UIUX_PROMPT_VERSION,
        status: GenerationJobStatus.RUNNING,
        attempt,
        maxAttempts: MAX_ATTEMPTS,
        totalFiles: REQUIRED_FILES.length,
        startedAt: new Date(),
      },
    });

    try {
      const userPrompt = buildUiuxUserPrompt({
        projectName: project.name,
        businessIdea: project.businessIdea,
        prdContent: prdStage.content,
        architectureContent: archStage.content,
      });

      // v2 — 1 panggilan LLM per file (bukan 1 JSON gabungan raksasa, lihat
      // uiux-designer-v1 postmortem: DeepSeek sering memotong output di
      // tengah JSON besar). Sequential, bukan paralel — lebih gampang
      // didiagnosis kalau ada yang gagal, dan menghindari rate limit burst.
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let totalTokens = 0;
      let lastModel = 'deepseek-chat';
      const results: { fileName: string; content: string; outcome: ReturnType<typeof validateSingleFile> }[] = [];

      for (const filePrompt of UIUX_FILE_PROMPTS) {
        const response = await this.llm.generate({
          systemPrompt: filePrompt.systemPrompt,
          userPrompt,
          promptVersion: UIUX_PROMPT_VERSION,
          maxTokens: 8192,
        });

        totalInputTokens += response.inputTokens;
        totalOutputTokens += response.outputTokens;
        totalTokens += response.totalTokens;
        lastModel = response.model;

        const content = stripCodeFence(response.content);
        results.push({ fileName: filePrompt.fileName, content, outcome: validateSingleFile(filePrompt.fileName, content) });
      }

      await this.prisma.generationJob.update({
        where: { id: job.id },
        data: {
          model: lastModel,
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          totalTokens,
        },
      });

      // Catat semua file + hasil validasi dulu untuk audit, terlepas dari lolos/tidak (§18 audit).
      for (const { fileName, content, outcome } of results) {
        const generationFile = await this.prisma.generationFile.create({
          data: {
            generationJobId: job.id,
            path: `uiux/${fileName}`,
            status: outcome.passed ? GenerationFileStatus.GENERATED : GenerationFileStatus.INVALID,
            checksum: createHash('sha256').update(content, 'utf-8').digest('hex'),
            errorMessage: outcome.passed ? null : outcome.errors.join('; '),
          },
        });
        await this.prisma.validationResult.create({
          data: {
            generationJobId: job.id,
            generationFileId: generationFile.id,
            level: ValidationLevel.FILE,
            passed: outcome.passed,
            errors: outcome.passed ? undefined : { messages: outcome.errors },
          },
        });
      }

      const invalidCount = results.filter((r) => !r.outcome.passed).length;
      if (invalidCount > 0) {
        await this.prisma.generationJob.update({
          where: { id: job.id },
          data: { invalidFiles: invalidCount },
        });
        return await this.failJob(
          uiuxStage.id,
          job.id,
          'FILE_VALIDATION_FAILED',
          `${invalidCount}/${REQUIRED_FILES.length} file gagal validasi structural (§19). Lihat ValidationResult untuk detail.`,
        );
      }

      // Semua valid — persist ke S3 dan link ArtifactObject <-> GenerationFile.
      for (const { fileName, content } of results) {
        const artifactObject = await this.storage.uploadArtifact({
          artifactStageId: uiuxStage.id,
          createdById: project.createdById,
          projectId: project.id,
          stageKey: 'uiux',
          fileName,
          content: Buffer.from(content, 'utf-8'),
          mimeType: fileName.endsWith('.md') ? 'text/markdown; charset=utf-8' : 'text/yaml; charset=utf-8',
          version: uiuxStage.revisionCount + 1,
        });

        await this.prisma.generationFile.updateMany({
          where: { generationJobId: job.id, path: `uiux/${fileName}` },
          data: { artifactObjectId: artifactObject.id },
        });
      }

      const summary = this.buildSummary(results);

      const updatedStage = await this.prisma.artifactStage.update({
        where: { id: uiuxStage.id },
        data: {
          status: StageStatus.GENERATED,
          artifactName: 'uiux/*',
          content: summary,
          resumeUrl: dto.resumeUrl ?? null,
          generatedAt: new Date(),
        },
      });

      await this.prisma.generationJob.update({
        where: { id: job.id },
        data: { status: GenerationJobStatus.COMPLETED, generatedFiles: REQUIRED_FILES.length, completedAt: new Date() },
      });

      if (dto.n8nExecutionId && dto.n8nExecutionId !== project.n8nExecutionId) {
        await this.prisma.project.update({
          where: { id: dto.projectId },
          data: { n8nExecutionId: dto.n8nExecutionId },
        });
      }

      return { ok: true, stage: updatedStage, generationJobId: job.id };
    } catch (err) {
      if (err instanceof UnprocessableEntityException || err instanceof ConflictException) {
        throw err; // sudah ditangani failJob di atas
      }
      const category = err instanceof LLMProviderError ? err.category : 'LLM_ERROR';
      const message = (err as Error).message ?? 'Unknown error';
      this.logger.error(`UI/UX generation gagal untuk project ${dto.projectId}: ${message}`, err as Error);
      return this.failJob(uiuxStage.id, job.id, category, message);
    }
  }

  /** Tandai job+stage gagal secara konsisten (§75 failure categories), lalu lempar 422 ke caller. */
  private async failJob(
    artifactStageId: string,
    generationJobId: string,
    errorCategory: string,
    errorMessage: string,
  ): Promise<never> {
    await this.prisma.generationJob.update({
      where: { id: generationJobId },
      data: { status: GenerationJobStatus.FAILED, errorCategory, errorMessage, completedAt: new Date() },
    });
    // Reset ke PENDING (bukan dibiarkan GENERATING) supaya endpoint ini bisa dipanggil ulang untuk retry.
    await this.prisma.artifactStage.update({
      where: { id: artifactStageId },
      data: { status: StageStatus.PENDING },
    });
    throw new UnprocessableEntityException({ errorCategory, errorMessage, generationJobId });
  }

  /** Ringkasan singkat buat ArtifactStage.content — detail lengkap ada di 7 file S3 + GenerationFile. */
  private buildSummary(results: { fileName: string; content: string }[]): string {
    let screenCount = 0;
    let componentCount = 0;
    try {
      const designSpec = results.find((r) => r.fileName === 'design-spec.yaml');
      const parsed = yaml.load(designSpec?.content ?? '') as Record<string, unknown>;
      screenCount = Array.isArray(parsed?.screens) ? parsed.screens.length : 0;
      componentCount = Array.isArray(parsed?.components) ? parsed.components.length : 0;
    } catch {
      // Ringkasan best-effort — kegagalan parse di sini tidak menggagalkan generation
      // (file sudah lolos validateSingleFile sebelumnya).
    }
    return [
      '# UI/UX Design Specification',
      '',
      `${screenCount} screen(s), ${componentCount} component(s) didefinisikan.`,
      '',
      'File lengkap: uiux/design-spec.yaml, uiux/screens.yaml, uiux/user-flows.yaml,',
      'uiux/components.yaml, uiux/design-system.yaml, uiux/navigation.yaml, uiux/accessibility.md',
    ].join('\n');
  }
}
