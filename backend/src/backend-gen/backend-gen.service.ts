import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { GenerationFileStatus, GenerationJobStatus, StageKey, StageStatus, ValidationLevel } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { LLMService } from '../llm/llm.service';
import { LLMProviderError } from '../llm/types';
import { ValidationService } from '../generation/validation.service';
import { UiuxService } from '../uiux/uiux.service';
import { GenerateBackendDto } from './dto/generate-backend.dto';
import {
  BACKEND_MANIFEST_PROMPT_VERSION,
  BACKEND_FILE_PROMPT_VERSION,
  BACKEND_REPAIR_PROMPT_VERSION,
  BACKEND_MANIFEST_SYSTEM_PROMPT,
  buildManifestUserPrompt,
  buildFileSystemPrompt,
  buildFileUserPrompt,
  buildRepairSystemPrompt,
  buildRepairUserPrompt,
} from './prompts';
import { ManifestFileEntry, parseManifest, reorderByDependencies, validateFileContent } from './validation';

const MAX_ATTEMPTS = 3; // §36 — retry (regenerate dari nol) per stage
const MAX_HEALING_ROUNDS = 3; // selaras dengan MAX_SELF_HEALING_ATTEMPTS di ValidationService

/** Safety net kalau LLM tetap bungkus output pakai code fence — sama seperti uiux.service.ts. */
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
export class BackendGenService {
  private readonly logger = new Logger(BackendGenService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly llm: LLMService,
    private readonly validationService: ValidationService,
    private readonly uiuxService: UiuxService,
  ) {}

  /**
   * Dipanggil controller sebagai fire-and-forget (§ lihat backend-gen.controller.ts
   * untuk alasan async — generate puluhan file bisa makan waktu lama, tidak
   * boleh nge-block HTTP request dari n8n).
   */
  async generate(dto: GenerateBackendDto): Promise<void> {
    const project = await this.prisma.project.findUnique({
      where: { id: dto.projectId },
      include: { stages: true },
    });
    if (!project) {
      this.logger.error(`[BackendGen] Project ${dto.projectId} tidak ditemukan`);
      return;
    }
    if (!project.createdById) {
      this.logger.error(`[BackendGen] Project ${dto.projectId} belum punya createdById`);
      return;
    }

    const prdStage = project.stages.find((s) => s.stageKey === StageKey.PRD);
    const archStage = project.stages.find((s) => s.stageKey === StageKey.ARCHITECTURE);
    const dbStage = project.stages.find((s) => s.stageKey === StageKey.DATABASE);
    const backendStage = project.stages.find((s) => s.stageKey === StageKey.BACKEND);

    if (!prdStage?.content || prdStage.status !== StageStatus.APPROVED) {
      return this.logger.warn(`[BackendGen] ${dto.projectId}: PRD belum APPROVED`);
    }
    if (!archStage?.content || archStage.status !== StageStatus.APPROVED) {
      return this.logger.warn(`[BackendGen] ${dto.projectId}: Architecture belum APPROVED`);
    }
    if (!dbStage?.content || dbStage.status !== StageStatus.APPROVED) {
      return this.logger.warn(`[BackendGen] ${dto.projectId}: Database Design belum APPROVED`);
    }
    if (!backendStage) {
      return this.logger.error(`[BackendGen] ${dto.projectId}: stage BACKEND tidak ditemukan`);
    }
    if (backendStage.status === StageStatus.GENERATING) {
      return this.logger.warn(`[BackendGen] ${dto.projectId}: generation backend sedang berjalan, dilewati`);
    }
    // Fix (postmortem UiuxService — retry n8n redundan setelah job sebelumnya
    // sukses bisa menimpa status GENERATED balik ke PENDING). Sama guard di
    // sini: revision loop selalu lewat REVISION_REQUESTED dulu di decide(),
    // tidak pernah langsung dari GENERATED — jadi ini aman.
    if (backendStage.status === StageStatus.GENERATED) {
      return this.logger.warn(
        `[BackendGen] ${dto.projectId}: stage sudah GENERATED (siap approve), trigger baru diabaikan.`,
      );
    }

    const previousAttempts = await this.prisma.generationJob.count({ where: { artifactStageId: backendStage.id } });
    const attempt = previousAttempts + 1;
    if (attempt > MAX_ATTEMPTS) {
      // Fix (postmortem debugging session): sebelumnya cuma logger.error, tidak
      // terlihat sama sekali dari UI/database kalau trigger ditolak diam-diam
      // di sini — bikin developer salah diagnosis (ngira job baru dibuat &
      // gagal, padahal job BARU tidak pernah tercipta sama sekali). Sekarang
      // ditulis eksplisit ke ArtifactStage.content supaya kelihatan di UI.
      await this.prisma.artifactStage.update({
        where: { id: backendStage.id },
        data: {
          content: `⚠️ RETRY_EXHAUSTED — sudah ${previousAttempts} percobaan generate (maksimal ${MAX_ATTEMPTS}). Hapus GenerationJob lama (status FAILED) untuk stage ini kalau mau retry lagi, atau naikkan MAX_ATTEMPTS kalau memang perlu lebih banyak percobaan.`,
        },
      });
      return this.logger.error(`[BackendGen] ${dto.projectId}: RETRY_EXHAUSTED setelah ${previousAttempts} percobaan`);
    }

    let uiuxCombined: string;
    try {
      uiuxCombined = (await this.uiuxService.getContentForFrontend(dto.projectId)).combined;
    } catch (err) {
      this.logger.error(`[BackendGen] ${dto.projectId}: gagal ambil UI/UX spec: ${(err as Error).message}`);
      return;
    }

    await this.prisma.artifactStage.update({
      where: { id: backendStage.id },
      data: { status: StageStatus.GENERATING },
    });

    const job = await this.prisma.generationJob.create({
      data: {
        artifactStageId: backendStage.id,
        model: 'deepseek-chat',
        promptVersion: BACKEND_MANIFEST_PROMPT_VERSION,
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
        systemPrompt: BACKEND_MANIFEST_SYSTEM_PROMPT,
        userPrompt: buildManifestUserPrompt({
          projectName: project.name,
          prdContent: prdStage.content,
          architectureContent: archStage.content,
          databaseContent: dbStage.content,
          uiuxCombined,
          revisionNote: dto.decision === 'revision' ? dto.note : undefined,
        }),
        promptVersion: BACKEND_MANIFEST_PROMPT_VERSION,
        maxTokens: 16384, // manifest bisa panjang untuk project besar — naikkan dari default 8192 (lihat postmortem v1)
      });
      totalInputTokens += manifestResponse.inputTokens;
      totalOutputTokens += manifestResponse.outputTokens;
      totalTokens += manifestResponse.totalTokens;
      lastModel = manifestResponse.model;

      const cleanManifestContent = stripCodeFence(manifestResponse.content);
      const { entries: manifestEntries, errors: manifestErrors } = parseManifest(cleanManifestContent);
      if (manifestErrors.length > 0) {
        // Fix diagnostik (postmortem: 'Manifest bukan JSON valid dan tidak
        // bisa diperbaiki' - tidak pernah bisa lihat KENAPA karena raw
        // response LLM tidak pernah disimpan di manapun). Sekarang sertakan
        // cuplikan mentahnya di error_message supaya bisa didiagnosis tanpa
        // perlu trigger ulang generation lagi cuma buat lihat isinya.
        return await this.failJob(
          backendStage.id,
          job.id,
          'MANIFEST_INCOMPLETE',
          `${manifestErrors.join('; ')}\n\n--- Cuplikan respons mentah LLM (800 karakter pertama) ---\n${cleanManifestContent.slice(0, 800)}`,
        );
      }
      // Urutan array manifest dari LLM cuma dioptimalkan supaya file wajib
      // aman dari truncation (lihat prompts.ts) — urutan GENERATE yang benar
      // (dependency-safe) dihitung ulang di sini dari "dependsOn".
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
            databaseContent: dbStage.content,
            uiuxCombined,
            manifestOverview,
            dependencyFiles,
          }),
          promptVersion: BACKEND_FILE_PROMPT_VERSION,
          maxTokens: 16384, // dinaikkan dari 8192 - postmortem truncation file 900-1300+ baris (date.util.ts, reports.service.ts, dst)
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
            artifactStageId: backendStage.id,
            createdById: project.createdById,
            projectId: project.id,
            stageKey: 'backend',
            fileName: entry.path,
            content: Buffer.from(content, 'utf-8'),
            mimeType: mimeTypeFor(entry.path),
            version,
          });
          await this.prisma.generationFile.update({
            where: { id: generationFile.id },
            data: { artifactObjectId: artifactObject.id },
          });
          generatedCount++;
        } else {
          invalidCount++;
        }

        // Fix bug (report user): progress bar/estimasi durasi di StageCard poll
        // GenerationJob.generatedFiles tiap 5 detik — sebelumnya field ini cuma
        // di-update SEKALI di akhir loop, jadi UI selalu baca 0 selama proses
        // jalan dan "lompat" ke angka final pas loop selesai. Update di SETIAP
        // iterasi supaya progress bar benar-benar bergerak real-time.
        await this.prisma.generationJob.update({
          where: { id: job.id },
          data: { model: lastModel, generatedFiles: generatedCount, invalidFiles: invalidCount },
        });
      }

      await this.prisma.generationJob.update({
        where: { id: job.id },
        data: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, totalTokens },
      });

      if (invalidCount > 0) {
        return await this.failJob(
          backendStage.id,
          job.id,
          'FILE_VALIDATION_FAILED',
          `${invalidCount}/${entries.length} file gagal validasi structural`,
        );
      }

      // ===== 3. Compile-level validation + self-healing loop =====
      await this.prisma.generationJob.update({ where: { id: job.id }, data: { status: GenerationJobStatus.VALIDATING } });

      let validation = await this.validationService.validateStage({
        projectId: dto.projectId,
        stageKey: 'BACKEND',
        version,
      });
      let healingRounds = 0;

      while (!validation.passed && validation.canSelfHeal && healingRounds < MAX_HEALING_ROUNDS) {
        healingRounds++;
        const brokenPaths = this.extractBrokenPaths(validation.errorLog ?? '', entries.map((e) => e.path));
        if (brokenPaths.length === 0) break; // gak bisa lokalisasi file yang error -> stop, jangan muter tanpa progress

        for (const path of brokenPaths.slice(0, 10)) {
          const original = fileContents.get(path);
          if (!original) continue;
          try {
            const repairResponse = await this.llm.generate({
              systemPrompt: buildRepairSystemPrompt({ path }),
              userPrompt: buildRepairUserPrompt({ originalContent: original, errorLog: validation.errorLog ?? '' }),
              promptVersion: BACKEND_REPAIR_PROMPT_VERSION,
              maxTokens: 16384,
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
                  repairPromptVersion: BACKEND_REPAIR_PROMPT_VERSION,
                  resultStatus: GenerationFileStatus.GENERATED,
                },
              });
            }
          } catch (err) {
            this.logger.warn(`[BackendGen] Repair gagal untuk ${path}: ${(err as Error).message}`);
          }
        }

        // Materialize() SandboxService baca SEMUA ArtifactObject per version — jadi re-upload
        // seluruh set file (bukan cuma yang diperbaiki) ke version yang sama supaya tetap lengkap.
        for (const [path, content] of fileContents) {
          const artifactObject = await this.storage.uploadArtifact({
            artifactStageId: backendStage.id,
            createdById: project.createdById,
            projectId: project.id,
            stageKey: 'backend',
            fileName: path,
            content: Buffer.from(content, 'utf-8'),
            mimeType: mimeTypeFor(path),
            version,
          });
          const gf = await this.prisma.generationFile.findFirst({ where: { generationJobId: job.id, path } });
          if (gf) {
            await this.prisma.generationFile.update({
              where: { id: gf.id },
              data: { artifactObjectId: artifactObject.id },
            });
          }
        }

        validation = await this.validationService.validateStage({
          projectId: dto.projectId,
          stageKey: 'BACKEND',
          version,
        });
      }

      await this.prisma.generationJob.update({
        where: { id: job.id },
        data: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, totalTokens },
      });

      const summary = this.buildSummary(entries, project.name);

      if (validation.passed) {
        await this.prisma.artifactStage.update({
          where: { id: backendStage.id },
          data: {
            artifactName: 'backend/*',
            content: summary,
            resumeUrl: dto.resumeUrl ?? null,
            generatedAt: new Date(),
          },
        });
        await this.prisma.generationJob.update({
          where: { id: job.id },
          data: { status: GenerationJobStatus.COMPLETED, completedAt: new Date() },
        });
      } else {
        // Fix (postmortem: stage macet selamanya di status SELF_HEALING):
        // asumsi lama "ValidationService otomatis set status GENERATED kalau
        // selfHealingAttempts habis" SALAH untuk kasus loop di atas berhenti
        // LEBIH AWAL (extractBrokenPaths tidak nemu file yang cocok, break
        // sebelum ValidationService sempat capai titik exhaustion-nya
        // sendiri) — status ArtifactStage ketinggalan di apapun yang
        // ValidationService set terakhir kali (biasanya SELF_HEALING),
        // TIDAK PERNAH direset. Sekarang eksplisit set PENDING di sini,
        // sama seperti failJob() — supaya UI tidak pernah nunjukin badge
        // 'lagi proses' untuk job yang sebenarnya sudah mati.
        await this.prisma.artifactStage.update({
          where: { id: backendStage.id },
          data: {
            status: StageStatus.PENDING,
            artifactName: 'backend/*',
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
        await this.prisma.project.update({
          where: { id: dto.projectId },
          data: { n8nExecutionId: dto.n8nExecutionId },
        });
      }
    } catch (err) {
      const category = err instanceof LLMProviderError ? err.category : 'LLM_ERROR';
      const message = (err as Error).message ?? 'Unknown error';
      this.logger.error(`[BackendGen] Gagal untuk project ${dto.projectId}: ${message}`, err as Error);
      await this.failJob(backendStage.id, job.id, category, message);
    }
  }

  /** Tandai job+stage gagal, reset ke PENDING supaya trigger bisa dipanggil ulang (retry via attempt counter). */
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
    await this.prisma.artifactStage.update({
      where: { id: artifactStageId },
      data: { status: StageStatus.PENDING },
    });
  }

  /** tsc --noEmit selalu sertakan path file di baris error — cocokkan terhadap manifest. */
  /**
   * tsc/build error selalu sebutkan path file secara literal, tapi npm
   * dependency-resolution error (ETARGET/E404/ERESOLVE — package yang tidak
   * ada/versi tidak cocok, sering LLM hallucinate nama package) TIDAK PERNAH
   * sebut "package.json" secara literal, cuma nama package yang bermasalah.
   * Postmortem: self-healing selalu skip kasus ini (extractBrokenPaths tidak
   * nemu match apapun -> break lebih awal, tidak pernah coba perbaiki).
   * Tambahan heuristik: kalau error log jelas berasal dari `npm install`
   * yang gagal (bukan tsc/build), target langsung package.json untuk
   * diperbaiki — itu satu-satunya file yang masuk akal jadi sumbernya.
   */
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

  private buildSummary(entries: ManifestFileEntry[], projectName: string): string {
    return [
      `# Backend — ${projectName}`,
      ``,
      `${entries.length} file digenerate.`,
      ``,
      `## Struktur`,
      ...entries.map((e) => `- \`${e.path}\` — ${e.purpose}`),
    ].join('\n');
  }

  /** Dipanggil BackendGenController.getSummary() — lihat komentar di sana. */
  async getSummary(projectId: string): Promise<{ summary: string }> {
    const stage = await this.prisma.artifactStage.findFirst({
      where: { projectId, stageKey: StageKey.BACKEND },
    });
    return { summary: stage?.content ?? '(belum ada ringkasan backend)' };
  }
}
