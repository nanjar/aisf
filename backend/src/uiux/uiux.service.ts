import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
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

/** Safety net kalau LLM tetap membungkus output dalam code fence walau sudah dilarang di prompt. */
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
const MAX_COMPONENTS = 40; // buffer kecil di atas batas 30 yang diminta di prompt

/**
 * Fix (postmortem: project dengan 160+, lalu 307+ component walau prompt
 * sudah eksplisit larang >30) — instruksi prompt saja TIDAK CUKUP diandalkan,
 * LLM kadang tetap tidak patuh. Ini enforcement PROGRAMATIK yang menjamin
 * batas jumlah component terlepas dari kepatuhan LLM: potong paksa ke
 * MAX_COMPONENTS kalau kelebihan, alih-alih menggagalkan seluruh generation.
 */
function enforceComponentCap(content: string): string {
  try {
    const parsed = yaml.load(content);
    if (!parsed || typeof parsed !== 'object') return content;

    if (Array.isArray(parsed)) {
      if (parsed.length <= MAX_COMPONENTS) return content;
      return yaml.dump(parsed.slice(0, MAX_COMPONENTS));
    }

    const doc = parsed as Record<string, unknown>;
    if (Array.isArray(doc.components) && doc.components.length > MAX_COMPONENTS) {
      doc.components = doc.components.slice(0, MAX_COMPONENTS);
      return yaml.dump(doc);
    }
    return content;
  } catch {
    // Parse gagal di sini -> biarkan validateSingleFile yang nanti kasih pesan error YAML yang jelas.
    return content;
  }
}

@Injectable()
export class UiuxService {
  private readonly logger = new Logger(UiuxService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly llm: LLMService,
  ) {}

  /**
   * §81 n8n flow — dipanggil setelah Architecture APPROVED.
   *
   * Fix arsitektur (postmortem: n8n HTTP node timeout 300s, backend masih
   * proses di background waktu n8n sudah nyerah nunggu) — method ini SEKARANG
   * fire-and-forget, sama seperti BackendGenService/FrontendGenService. Dulu
   * generate 7 file muat di bawah 60 detik jadi aman disinkronkan langsung
   * ke 1 HTTP request; sekarang dengan maxTokens yang jauh lebih besar
   * (project component-heavy) durasi bisa lebih dari 5 menit. TIDAK ADA LAGI
   * exception yang dilempar dari method ini — semua error path cuma log +
   * update database, controller yang memanggil TIDAK await hasil method ini.
   */
  async generate(dto: GenerateUiuxDto): Promise<void> {
    const project = await this.prisma.project.findUnique({
      where: { id: dto.projectId },
      include: { stages: true },
    });
    if (!project) {
      this.logger.error(`[UiuxGen] Project ${dto.projectId} tidak ditemukan`);
      return;
    }
    if (!project.createdById) {
      this.logger.error(`[UiuxGen] ${dto.projectId} belum punya createdById`);
      return;
    }

    const prdStage = project.stages.find((s) => s.stageKey === StageKey.PRD);
    const archStage = project.stages.find((s) => s.stageKey === StageKey.ARCHITECTURE);
    const uiuxStage = project.stages.find((s) => s.stageKey === StageKey.UIUX);

    if (!prdStage || prdStage.status !== StageStatus.APPROVED || !prdStage.content) {
      return this.logger.warn(`[UiuxGen] ${dto.projectId}: PRD belum APPROVED`);
    }
    if (!archStage || archStage.status !== StageStatus.APPROVED || !archStage.content) {
      return this.logger.warn(`[UiuxGen] ${dto.projectId}: Architecture belum APPROVED`);
    }
    if (!uiuxStage) {
      return this.logger.error(`[UiuxGen] ${dto.projectId}: stage UIUX tidak ditemukan`);
    }
    if (uiuxStage.status === StageStatus.GENERATING) {
      return this.logger.warn(`[UiuxGen] ${dto.projectId}: generation sedang berjalan, dilewati`);
    }

    // §36/§75 RETRY_EXHAUSTED — hitung attempt dari histori job yang sudah ada untuk stage ini.
    const previousAttempts = await this.prisma.generationJob.count({
      where: { artifactStageId: uiuxStage.id },
    });
    const attempt = previousAttempts + 1;
    if (attempt > MAX_ATTEMPTS) {
      await this.prisma.artifactStage.update({
        where: { id: uiuxStage.id },
        data: {
          content: `⚠️ RETRY_EXHAUSTED — sudah ${previousAttempts} percobaan generate (maksimal ${MAX_ATTEMPTS}). Hapus GenerationJob lama (status FAILED) untuk stage ini kalau mau retry lagi.`,
        },
      });
      return this.logger.error(`[UiuxGen] ${dto.projectId}: RETRY_EXHAUSTED setelah ${previousAttempts} percobaan`);
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
          maxTokens: 32768,
        });

        totalInputTokens += response.inputTokens;
        totalOutputTokens += response.outputTokens;
        totalTokens += response.totalTokens;
        lastModel = response.model;

        let content = stripCodeFence(response.content);
        if (filePrompt.fileName === 'components.yaml') {
          content = enforceComponentCap(content);
        }
        results.push({ fileName: filePrompt.fileName, content, outcome: validateSingleFile(filePrompt.fileName, content) });

        await this.prisma.generationJob.update({
          where: { id: job.id },
          data: { generatedFiles: results.length },
        });
      }

      await this.prisma.generationJob.update({
        where: { id: job.id },
        data: { model: lastModel, inputTokens: totalInputTokens, outputTokens: totalOutputTokens, totalTokens },
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
        await this.prisma.generationJob.update({ where: { id: job.id }, data: { invalidFiles: invalidCount } });
        return this.failJob(
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

      await this.prisma.artifactStage.update({
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
    } catch (err) {
      const category = err instanceof LLMProviderError ? err.category : 'LLM_ERROR';
      const message = (err as Error).message ?? 'Unknown error';
      this.logger.error(`[UiuxGen] Gagal untuk project ${dto.projectId}: ${message}`, err as Error);
      await this.failJob(uiuxStage.id, job.id, category, message);
    }
  }

  /** Tandai job+stage gagal secara konsisten (§75 failure categories). Tidak melempar exception lagi (§ lihat generate()). */
  private async failJob(
    artifactStageId: string,
    generationJobId: string,
    errorCategory: string,
    errorMessage: string,
  ): Promise<void> {
    await this.prisma.generationJob.update({
      where: { id: generationJobId },
      data: { status: GenerationJobStatus.FAILED, errorCategory, errorMessage, completedAt: new Date() },
    });
    // Reset ke PENDING (bukan dibiarkan GENERATING) supaya endpoint ini bisa dipanggil ulang untuk retry.
    await this.prisma.artifactStage.update({
      where: { id: artifactStageId },
      data: { status: StageStatus.PENDING },
    });
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

  /**
   * §Fix (gap ditemukan setelah Fase 2 live): Frontend Developer Agent di n8n
   * SEBELUMNYA tidak pernah membaca output UI/UX Designer. Method ini
   * menggabungkan 7 file jadi satu teks yang dipanggil n8n TEPAT SEBELUM
   * Frontend Developer Agent — endpoint terpisah ini TETAP synchronous
   * (bukan fire-and-forget) karena murni baca S3, cepat, beda dari generate().
   */
  async getContentForFrontend(projectId: string): Promise<{ combined: string; fileCount: number }> {
    const uiuxStage = await this.prisma.artifactStage.findFirst({
      where: { projectId, stageKey: StageKey.UIUX },
    });
    if (!uiuxStage) {
      throw new NotFoundException('Stage UIUX tidak ditemukan untuk project ini');
    }

    const latestJob = await this.prisma.generationJob.findFirst({
      where: { artifactStageId: uiuxStage.id, status: GenerationJobStatus.COMPLETED },
      orderBy: { completedAt: 'desc' },
    });
    if (!latestJob) {
      throw new ConflictException('Belum ada UI/UX Design Specification yang berhasil di-generate untuk project ini');
    }

    const files = await this.prisma.generationFile.findMany({
      where: { generationJobId: latestJob.id, artifactObjectId: { not: null } },
      include: { artifactObject: true },
      orderBy: { path: 'asc' },
    });

    const sections: string[] = [];
    for (const file of files) {
      if (!file.artifactObject) continue;
      const stream = await this.storage.getObjectStream(file.artifactObject.bucket, file.artifactObject.objectKey);
      const content = await this.streamToString(stream);
      const fileName = file.path.replace(/^uiux\//, '');
      sections.push(`### ${fileName}\n\n${content}`);
    }

    return {
      combined: sections.join('\n\n---\n\n'),
      fileCount: sections.length,
    };
  }

  private streamToString(stream: any): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('error', reject);
      stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    });
  }
}
