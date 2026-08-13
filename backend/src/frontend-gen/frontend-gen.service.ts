import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { GenerationFileStatus, GenerationJobStatus, StageKey, StageStatus, ValidationLevel } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { LLMService } from '../llm/llm.service';
import { LLMProviderError } from '../llm/types';
import { ValidationService } from '../generation/validation.service';
import { UiuxService } from '../uiux/uiux.service';
import { BackendGenService } from '../backend-gen/backend-gen.service';
import { GenerateFrontendDto } from './dto/generate-frontend.dto';
import {
  FRONTEND_MANIFEST_PROMPT_VERSION,
  FRONTEND_FILE_PROMPT_VERSION,
  FRONTEND_REPAIR_PROMPT_VERSION,
  FRONTEND_MANIFEST_SYSTEM_PROMPT,
  buildManifestUserPrompt,
  buildFileSystemPrompt,
  buildFileUserPrompt,
  buildRepairSystemPrompt,
  buildRepairUserPrompt,
} from './prompts';
import { ManifestFileEntry, checkUiuxCoverage, parseManifest, reorderByDependencies, validateFileContent } from './validation';

const MAX_ATTEMPTS = 3;
const MAX_HEALING_ROUNDS = 3;
// §48/Success Metrics minta 100% coverage sebagai TARGET, tapi coverage di
// sini dihitung dari self-tagging LLM (screenId/componentId di manifest) —
// rawan false-negative kalau LLM lupa tag walau filenya sebenarnya benar.
// Threshold 70% dipilih sebagai jaring pengaman praktis: di bawah itu hampir
// pasti ada screen/component yang BENERAN tidak digenerate, bukan cuma lupa
// tag. Coverage penuh tetap direkam di ValidationResult buat visibility
// manusia terlepas dari lolos/tidaknya threshold ini.
const MIN_COVERAGE_PERCENT = 70;

function stripCodeFence(content: string): string {
  let text = content.trim();
  text = text.replace(/^```[a-zA-Z0-9_-]*\r?\n/, '');
  text = text.replace(/\r?\n?```\s*$/, '');
  return text.trim();
}

function mimeTypeFor(path: string): string {
  if (path.endsWith('.json')) return 'application/json; charset=utf-8';
  if (path.endsWith('.ts') || path.endsWith('.tsx')) return 'text/typescript; charset=utf-8';
  if (path.endsWith('.md')) return 'text/markdown; charset=utf-8';
  return 'text/plain; charset=utf-8';
}

@Injectable()
export class FrontendGenService {
  private readonly logger = new Logger(FrontendGenService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly llm: LLMService,
    private readonly validationService: ValidationService,
    private readonly uiuxService: UiuxService,
    private readonly backendGenService: BackendGenService,
  ) {}

  async generate(dto: GenerateFrontendDto): Promise<void> {
    const project = await this.prisma.project.findUnique({
      where: { id: dto.projectId },
      include: { stages: true },
    });
    if (!project) return this.logger.error(`[FrontendGen] Project ${dto.projectId} tidak ditemukan`);
    if (!project.createdById) return this.logger.error(`[FrontendGen] ${dto.projectId} belum punya createdById`);

    const prdStage = project.stages.find((s) => s.stageKey === StageKey.PRD);
    const archStage = project.stages.find((s) => s.stageKey === StageKey.ARCHITECTURE);
    const frontendStage = project.stages.find((s) => s.stageKey === StageKey.FRONTEND);

    if (!prdStage?.content || prdStage.status !== StageStatus.APPROVED) {
      return this.logger.warn(`[FrontendGen] ${dto.projectId}: PRD belum APPROVED`);
    }
    if (!archStage?.content || archStage.status !== StageStatus.APPROVED) {
      return this.logger.warn(`[FrontendGen] ${dto.projectId}: Architecture belum APPROVED`);
    }
    if (!frontendStage) return this.logger.error(`[FrontendGen] ${dto.projectId}: stage FRONTEND tidak ditemukan`);
    if (frontendStage.status === StageStatus.GENERATING) {
      return this.logger.warn(`[FrontendGen] ${dto.projectId}: generation sedang berjalan, dilewati`);
    }
    if (frontendStage.status === StageStatus.GENERATED) {
      return this.logger.warn(
        `[FrontendGen] ${dto.projectId}: stage sudah GENERATED (siap approve), trigger baru diabaikan.`,
      );
    }

    const previousAttempts = await this.prisma.generationJob.count({ where: { artifactStageId: frontendStage.id } });
    const attempt = previousAttempts + 1;
    if (attempt > MAX_ATTEMPTS) {
      await this.prisma.artifactStage.update({
        where: { id: frontendStage.id },
        data: {
          content: `⚠️ RETRY_EXHAUSTED — sudah ${previousAttempts} percobaan generate (maksimal ${MAX_ATTEMPTS}). Hapus GenerationJob lama (status FAILED) untuk stage ini kalau mau retry lagi.`,
        },
      });
      return this.logger.error(`[FrontendGen] ${dto.projectId}: RETRY_EXHAUSTED setelah ${previousAttempts} percobaan`);
    }

    let uiuxCombined: string;
    let backendSummary: string;
    try {
      uiuxCombined = (await this.uiuxService.getContentForFrontend(dto.projectId)).combined;
      backendSummary = (await this.backendGenService.getSummary(dto.projectId)).summary;
    } catch (err) {
      this.logger.error(`[FrontendGen] ${dto.projectId}: gagal ambil konteks: ${(err as Error).message}`);
      return;
    }

    await this.prisma.artifactStage.update({ where: { id: frontendStage.id }, data: { status: StageStatus.GENERATING } });

    const job = await this.prisma.generationJob.create({
      data: {
        artifactStageId: frontendStage.id,
        model: 'deepseek-chat',
        promptVersion: FRONTEND_MANIFEST_PROMPT_VERSION,
        status: GenerationJobStatus.RUNNING,
        attempt,
        maxAttempts: MAX_ATTEMPTS,
        startedAt: new Date(),
      },
    });

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalTokens = 0;
    let lastModel = 'deepseek-chat';

    try {
      // ===== 1. Manifest =====
      const manifestResponse = await this.llm.generate({
        systemPrompt: FRONTEND_MANIFEST_SYSTEM_PROMPT,
        userPrompt: buildManifestUserPrompt({
          projectName: project.name,
          prdContent: prdStage.content,
          architectureContent: archStage.content,
          uiuxCombined,
          backendSummary,
          revisionNote: dto.decision === 'revision' ? dto.note : undefined,
        }),
        promptVersion: FRONTEND_MANIFEST_PROMPT_VERSION,
        maxTokens: 16384,
      });
      totalInputTokens += manifestResponse.inputTokens;
      totalOutputTokens += manifestResponse.outputTokens;
      totalTokens += manifestResponse.totalTokens;
      lastModel = manifestResponse.model;

      const cleanManifestContent = stripCodeFence(manifestResponse.content);
      const { entries: manifestEntries, errors: manifestErrors } = parseManifest(cleanManifestContent);
      if (manifestErrors.length > 0) {
        return await this.failJob(
          frontendStage.id,
          job.id,
          'MANIFEST_INCOMPLETE',
          `${manifestErrors.join('; ')}\n\n--- Cuplikan respons mentah LLM (800 karakter pertama) ---\n${cleanManifestContent.slice(0, 800)}`,
        );
      }
      const entries = reorderByDependencies(manifestEntries);

      await this.prisma.generationJob.update({ where: { id: job.id }, data: { totalFiles: entries.length } });
      const manifestOverview = entries.map((e) => `- ${e.path}: ${e.purpose}`).join('\n');

      // ===== 2. File-by-file generation =====
      const version = attempt;
      const fileContents = new Map<string, string>();
      let generatedCount = 0;
      let invalidCount = 0;

      for (const entry of entries) {
        const dependencyFiles = entry.dependsOn
          .filter((p) => fileContents.has(p))
          .map((p) => ({ path: p, content: fileContents.get(p) as string }));

        const response = await this.llm.generate({
          systemPrompt: buildFileSystemPrompt(entry),
          userPrompt: buildFileUserPrompt({
            prdContent: prdStage.content,
            architectureContent: archStage.content,
            uiuxCombined,
            backendSummary,
            manifestOverview,
            dependencyFiles,
          }),
          promptVersion: FRONTEND_FILE_PROMPT_VERSION,
          maxTokens: 8192,
        });
        totalInputTokens += response.inputTokens;
        totalOutputTokens += response.outputTokens;
        totalTokens += response.totalTokens;
        lastModel = response.model;

        const content = stripCodeFence(response.content);
        const outcome = validateFileContent(entry.path, content);
        fileContents.set(entry.path, content);

        const generationFile = await this.prisma.generationFile.create({
          data: {
            generationJobId: job.id,
            path: entry.path,
            status: outcome.passed ? GenerationFileStatus.GENERATED : GenerationFileStatus.INVALID,
            dependsOnPaths: entry.dependsOn,
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

        if (outcome.passed) {
          const artifactObject = await this.storage.uploadArtifact({
            artifactStageId: frontendStage.id,
            createdById: project.createdById,
            projectId: project.id,
            stageKey: 'frontend',
            fileName: entry.path,
            content: Buffer.from(content, 'utf-8'),
            mimeType: mimeTypeFor(entry.path),
            version,
          });
          await this.prisma.generationFile.update({ where: { id: generationFile.id }, data: { artifactObjectId: artifactObject.id } });
          generatedCount++;
        } else {
          invalidCount++;
        }

        await this.prisma.generationJob.update({
          where: { id: job.id },
          data: { model: lastModel, generatedFiles: generatedCount, invalidFiles: invalidCount },
        });
      }

      if (invalidCount > 0) {
        return await this.failJob(frontendStage.id, job.id, 'FILE_VALIDATION_FAILED', `${invalidCount}/${entries.length} file gagal validasi structural`);
      }

      // ===== 3. UI/UX Coverage Validation (§48) =====
      const coverage = checkUiuxCoverage(entries, uiuxCombined);
      await this.prisma.validationResult.create({
        data: {
          generationJobId: job.id,
          level: ValidationLevel.PROJECT,
          passed: coverage.coveragePercent >= MIN_COVERAGE_PERCENT,
          errors:
            coverage.missingScreens.length || coverage.missingComponents.length
              ? { missingScreens: coverage.missingScreens, missingComponents: coverage.missingComponents, coveragePercent: coverage.coveragePercent }
              : undefined,
        },
      });
      if (coverage.coveragePercent < MIN_COVERAGE_PERCENT) {
        return await this.failJob(
          frontendStage.id,
          job.id,
          'PROJECT_VALIDATION_FAILED',
          `UI/UX coverage cuma ${coverage.coveragePercent}% (screen hilang: ${coverage.missingScreens.join(', ') || '-'}; component hilang: ${coverage.missingComponents.join(', ') || '-'})`,
        );
      }

      // ===== 4. Compile+Build validation + self-healing loop =====
      await this.prisma.generationJob.update({ where: { id: job.id }, data: { status: GenerationJobStatus.VALIDATING } });

      let validation = await this.validationService.validateStage({ projectId: dto.projectId, stageKey: 'FRONTEND', version });
      let healingRounds = 0;

      while (!validation.passed && validation.canSelfHeal && healingRounds < MAX_HEALING_ROUNDS) {
        healingRounds++;
        const brokenPaths = this.extractBrokenPaths(validation.errorLog ?? '', entries.map((e) => e.path));
        if (brokenPaths.length === 0) break;

        for (const path of brokenPaths.slice(0, 10)) {
          const original = fileContents.get(path);
          if (!original) continue;
          try {
            const repairResponse = await this.llm.generate({
              systemPrompt: buildRepairSystemPrompt({ path }),
              userPrompt: buildRepairUserPrompt({ originalContent: original, errorLog: validation.errorLog ?? '' }),
              promptVersion: FRONTEND_REPAIR_PROMPT_VERSION,
              maxTokens: 8192,
            });
            totalInputTokens += repairResponse.inputTokens;
            totalOutputTokens += repairResponse.outputTokens;
            totalTokens += repairResponse.totalTokens;
            fileContents.set(path, stripCodeFence(repairResponse.content));

            const gf = await this.prisma.generationFile.findFirst({ where: { generationJobId: job.id, path } });
            if (gf) {
              await this.prisma.repairAttempt.create({
                data: {
                  generationFileId: gf.id,
                  attemptNumber: healingRounds,
                  errorSummary: (validation.errorLog ?? '').slice(-2000),
                  repairPromptVersion: FRONTEND_REPAIR_PROMPT_VERSION,
                  resultStatus: GenerationFileStatus.GENERATED,
                },
              });
            }
          } catch (err) {
            this.logger.warn(`[FrontendGen] Repair gagal untuk ${path}: ${(err as Error).message}`);
          }
        }

        for (const [path, content] of fileContents) {
          const artifactObject = await this.storage.uploadArtifact({
            artifactStageId: frontendStage.id,
            createdById: project.createdById,
            projectId: project.id,
            stageKey: 'frontend',
            fileName: path,
            content: Buffer.from(content, 'utf-8'),
            mimeType: mimeTypeFor(path),
            version,
          });
          const gf = await this.prisma.generationFile.findFirst({ where: { generationJobId: job.id, path } });
          if (gf) await this.prisma.generationFile.update({ where: { id: gf.id }, data: { artifactObjectId: artifactObject.id } });
        }

        validation = await this.validationService.validateStage({ projectId: dto.projectId, stageKey: 'FRONTEND', version });
      }

      await this.prisma.generationJob.update({
        where: { id: job.id },
        data: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, totalTokens },
      });

      const summary = this.buildSummary(entries, project.name, coverage);

      if (validation.passed) {
        await this.prisma.artifactStage.update({
          where: { id: frontendStage.id },
          data: { artifactName: 'frontend/*', content: summary, resumeUrl: dto.resumeUrl ?? null, generatedAt: new Date() },
        });
        await this.prisma.generationJob.update({
          where: { id: job.id },
          data: { status: GenerationJobStatus.COMPLETED, completedAt: new Date() },
        });
      } else {
        // Fix (sama root cause dengan backend-gen.service.ts — lihat komentar
        // di sana): status ArtifactStage bisa ketinggalan macet kalau loop
        // self-healing berhenti lebih awal, bukan karena ValidationService
        // sendiri mencapai exhaustion. Eksplisit set PENDING di sini.
        await this.prisma.artifactStage.update({
          where: { id: frontendStage.id },
          data: {
            status: StageStatus.PENDING,
            artifactName: 'frontend/*',
            content: `${summary}\n\n⚠️ VALIDASI BUILD GAGAL setelah ${healingRounds}x self-healing.\n\n${(validation.errorLog ?? '').slice(-8000)}`,
            resumeUrl: dto.resumeUrl ?? null,
            generatedAt: new Date(),
          },
        });
        await this.prisma.generationJob.update({
          where: { id: job.id },
          data: {
            status: GenerationJobStatus.FAILED,
            errorCategory: 'BUILD_FAILED',
            errorMessage: (validation.errorLog ?? '').slice(-8000),
            completedAt: new Date(),
          },
        });
      }

      if (dto.n8nExecutionId && dto.n8nExecutionId !== project.n8nExecutionId) {
        await this.prisma.project.update({ where: { id: dto.projectId }, data: { n8nExecutionId: dto.n8nExecutionId } });
      }
    } catch (err) {
      const category = err instanceof LLMProviderError ? err.category : 'LLM_ERROR';
      const message = (err as Error).message ?? 'Unknown error';
      this.logger.error(`[FrontendGen] Gagal untuk project ${dto.projectId}: ${message}`, err as Error);
      await this.failJob(frontendStage.id, job.id, category, message);
    }
  }

  private async failJob(artifactStageId: string, generationJobId: string, errorCategory: string, errorMessage: string): Promise<void> {
    await this.prisma.generationJob.update({
      where: { id: generationJobId },
      data: { status: GenerationJobStatus.FAILED, errorCategory, errorMessage, completedAt: new Date() },
    });
    await this.prisma.artifactStage.update({ where: { id: artifactStageId }, data: { status: StageStatus.PENDING } });
  }

  /** Sama fix dengan backend-gen.service.ts — lihat komentar di sana. */
  private extractBrokenPaths(errorLog: string, knownPaths: string[]): string[] {
    const found = new Set<string>();
    for (const path of knownPaths) {
      if (errorLog.includes(path)) found.add(path);
    }
    const isNpmInstallFailure = /npm error (notarget|code E(TARGET|404|RESOLVE)|enoent)/i.test(errorLog);
    if (found.size === 0 && isNpmInstallFailure && knownPaths.includes('package.json')) {
      found.add('package.json');
    }
    return [...found];
  }

  private buildSummary(entries: ManifestFileEntry[], projectName: string, coverage: ReturnType<typeof checkUiuxCoverage>): string {
    return [
      `# Frontend — ${projectName}`,
      ``,
      `${entries.length} file digenerate.`,
      `UI/UX coverage: ${coverage.coveragePercent}% (${coverage.coveredScreens}/${coverage.totalScreens} screen, ${coverage.coveredComponents}/${coverage.totalComponents} component).`,
      coverage.missingScreens.length ? `Screen belum ter-cover: ${coverage.missingScreens.join(', ')}` : '',
      coverage.missingComponents.length ? `Component belum ter-cover: ${coverage.missingComponents.join(', ')}` : '',
      ``,
      `## Struktur`,
      ...entries.map((e) => `- \`${e.path}\` — ${e.purpose}`),
    ]
      .filter(Boolean)
      .join('\n');
  }

  /** Dipanggil node "Fetch Frontend Summary" di n8n sebelum QA Engineer Agent. */
  async getSummary(projectId: string): Promise<{ summary: string }> {
    const stage = await this.prisma.artifactStage.findFirst({ where: { projectId, stageKey: StageKey.FRONTEND } });
    return { summary: stage?.content ?? '(belum ada ringkasan frontend)' };
  }
}
