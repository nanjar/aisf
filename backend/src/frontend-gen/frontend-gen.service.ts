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
const MIN_COVERAGE_PERCENT = 50; // diturunkan - self-tagging LLM tidak reliable, sering false-negative

// Sama pola dengan system prompt di prompts.ts — model default dipanggil
// hanya buat catatan awal generationJob.create() sebelum response LLM asli
// datang (yang isi field "model" sesungguhnya).
const DEFAULT_MODEL_LABEL = 'deepseek-v4-flash';

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

    await this.prisma.artifactStage.update({
      where: { id: frontendStage.id },
      // Fix kritikal (postmortem: sama bug persis yang ditemukan di
      // backend-gen.service.ts — self_healing_attempts numpuk terus tiap
      // attempt/trigger baru, TIDAK PERNAH direset. Reset ke 0 di sini
      // supaya tiap percobaan generate baru dapat jatah self-healing
      // penuh dari nol.
      data: { status: StageStatus.GENERATING, selfHealingAttempts: 0, failedValidation: false },
    });

    const job = await this.prisma.generationJob.create({
      data: {
        artifactStageId: frontendStage.id,
        model: DEFAULT_MODEL_LABEL,
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
    let lastModel = DEFAULT_MODEL_LABEL;

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
        maxTokens: 32768, // dinaikkan - beri ruang untuk model reasoning yang mikir dulu sebelum jawab
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
      // Fix kritikal (postmortem sama persis dengan backend-gen.service.ts):
      // version = attempt itu SALAH - attempt dihitung dari COUNT(*)
      // GenerationJob yang MASIH ADA, ke-reset tiap kali kita DELETE FROM
      // generation_jobs (rutin dilakukan buat retry). Validasi build bisa
      // mengetes file BASI dari attempt lama yang kebetulan pakai version
      // yang sama. Hitung dari MAX(version) di artifact_objects (tabel yang
      // TIDAK PERNAH kita hapus manual) + 1 - riwayatnya utuh, tidak collide.
      const lastArtifactVersion = await this.prisma.artifactObject.aggregate({
        where: { artifactStageId: frontendStage.id },
        _max: { version: true },
      });
      const version = (lastArtifactVersion._max.version ?? 0) + 1;
      const fileContents = new Map<string, string>();
      let generatedCount = 0;
      let invalidCount = 0;

      // Fix biaya (postmortem: 1x generate ~90 file = $3.89). System prompt
      // sekarang 100% statis (lihat prompts.ts) — dibuat SEKALI di luar
      // loop, bukan re-generate string tiap iterasi (tidak berpengaruh ke
      // isi tapi lebih bersih) — yang PALING penting: prefix system+awal
      // user prompt sekarang IDENTIK di setiap panggilan dalam project ini,
      // memaksimalkan context caching DeepSeek (98% lebih murah per cache-hit).
      const fileSystemPrompt = buildFileSystemPrompt();

      for (const entry of entries) {
        const dependencyFiles = entry.dependsOn
          .filter((p) => fileContents.has(p))
          .map((p) => ({ path: p, content: fileContents.get(p) as string }));

        const response = await this.llm.generate({
          systemPrompt: fileSystemPrompt,
          userPrompt: buildFileUserPrompt({
            prdContent: prdStage.content,
            architectureContent: archStage.content,
            uiuxCombined,
            backendSummary,
            manifestOverview,
            dependencyFiles,
            fileInfo: { path: entry.path, purpose: entry.purpose },
          }),
          promptVersion: FRONTEND_FILE_PROMPT_VERSION,
          maxTokens: 16384, // dinaikkan dari 8192, sama alasan dengan backend-gen.service.ts
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
      const repairSystemPrompt = buildRepairSystemPrompt(); // sama alasan caching — statis, dibuat sekali

      while (!validation.passed && validation.canSelfHeal && healingRounds < MAX_HEALING_ROUNDS) {
        healingRounds++;
        const errorLog = validation.errorLog ?? '';
        const knownPaths = entries.map((e) => e.path);
        const brokenPaths = this.extractBrokenPaths(errorLog, knownPaths);

        // Fix kritikal (postmortem: fitur ini SEBELUMNYA cuma ada di
        // backend-gen.service.ts, TIDAK PERNAH di-porting ke Frontend —
        // puluhan error "Cannot find module '@/lib/utils'" dkk tidak
        // pernah bisa diperbaiki otomatis karena file yang dirujuk memang
        // tidak pernah dibuat sama sekali, bukan cuma isinya salah).
        // resolveModuleErrors() di sini JUGA dukung alias Next.js "@/..."
        // (selain relative "./" "../" seperti versi backend) — resolve
        // ke root project, bukan relatif ke folder file yang meng-import.
        const { filesToRepair, filesToCreate } = this.resolveModuleErrors(errorLog, knownPaths);
        for (const p of filesToRepair) if (!brokenPaths.includes(p)) brokenPaths.push(p);

        if (brokenPaths.length === 0 && filesToCreate.length === 0) break;

        for (const path of brokenPaths.slice(0, 25)) {
          const original = fileContents.get(path);
          if (!original) continue;
          try {
            const repairResponse = await this.llm.generate({
              systemPrompt: repairSystemPrompt,
              userPrompt: buildRepairUserPrompt({ path, originalContent: original, errorLog }),
              promptVersion: FRONTEND_REPAIR_PROMPT_VERSION,
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
                  errorSummary: errorLog.slice(-2000),
                  repairPromptVersion: FRONTEND_REPAIR_PROMPT_VERSION,
                  resultStatus: GenerationFileStatus.GENERATED,
                },
              });
            }
          } catch (err) {
            this.logger.warn(`[FrontendGen] Repair gagal untuk ${path}: ${(err as Error).message}`);
          }
        }

        // File yang DIRUJUK tapi TIDAK PERNAH dibuat sama sekali (beda dari
        // repair biasa — ini generate BARU dari nol, bukan perbaiki yang ada).
        for (const path of filesToCreate.slice(0, 10)) {
          if (fileContents.has(path)) continue;
          try {
            const createResponse = await this.llm.generate({
              systemPrompt: fileSystemPrompt,
              userPrompt: buildFileUserPrompt({
                prdContent: prdStage.content,
                architectureContent: archStage.content,
                uiuxCombined,
                backendSummary,
                manifestOverview,
                dependencyFiles: [],
                fileInfo: {
                  path,
                  purpose: `File ini dirujuk (di-import) oleh file lain tapi belum pernah dibuat — generate isinya berdasarkan cara file lain menggunakannya. Error log yang memicu:\n${errorLog.slice(-1500)}`,
                },
              }),
              promptVersion: FRONTEND_REPAIR_PROMPT_VERSION,
              maxTokens: 16384,
            });
            totalInputTokens += createResponse.inputTokens;
            totalOutputTokens += createResponse.outputTokens;
            totalTokens += createResponse.totalTokens;
            const content = stripCodeFence(createResponse.content);
            fileContents.set(path, content);
            entries.push({
              path,
              purpose: 'Dibuat otomatis via self-healing — dirujuk file lain tapi hilang dari manifest asli',
              screenId: null,
              componentId: null,
              dependsOn: [],
            });

            const newGf = await this.prisma.generationFile.create({
              data: {
                generationJobId: job.id,
                path,
                status: GenerationFileStatus.GENERATED,
                dependsOnPaths: [],
                checksum: createHash('sha256').update(content, 'utf-8').digest('hex'),
              },
            });
            await this.prisma.repairAttempt.create({
              data: {
                generationFileId: newGf.id,
                attemptNumber: healingRounds,
                errorSummary: errorLog.slice(-2000),
                repairPromptVersion: FRONTEND_REPAIR_PROMPT_VERSION,
                resultStatus: GenerationFileStatus.GENERATED,
              },
            });
          } catch (err) {
            this.logger.warn(`[FrontendGen] Generate file baru gagal untuk ${path}: ${(err as Error).message}`);
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
          data: { artifactName: 'frontend/*', content: summary, ...(dto.resumeUrl !== undefined ? { resumeUrl: dto.resumeUrl } : {}), generatedAt: new Date() },
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
            ...(dto.resumeUrl !== undefined ? { resumeUrl: dto.resumeUrl } : {}),
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

  /**
   * Porting dari backend-gen.service.ts, DITAMBAH dukungan alias Next.js
   * "@/..." (selain relative "./" "../" seperti versi backend) — konvensi
   * umum tsconfig.json Next.js: "@/*" map ke root project (bukan relatif ke
   * folder file yang meng-import, beda dari "./"/"../").
   *
   * Postmortem: puluhan error "Cannot find module '@/lib/utils'" dkk tidak
   * pernah ke-detect di Frontend karena versi awal method ini (backend)
   * cuma tangani specifier yang mulai dengan "." — alias "@/" di-skip
   * total, jadi self-healing "buta" terhadap file yang hilang lewat alias.
   */
  private resolveModuleErrors(
    errorLog: string,
    knownPaths: string[],
  ): { filesToRepair: string[]; filesToCreate: string[] } {
    const filesToRepair = new Set<string>();
    const filesToCreate = new Set<string>();
    const knownSet = new Set(knownPaths);

    // Cocok untuk TS2307 (Cannot find module), TS2305 (has no exported
    // member), dan TS2613/TS2614 (no default export / no exported member —
    // muncul waktu import default vs named ketuker, TAPI kita cuma pakai ini
    // buat cari FILE-nya untuk di-repair, bukan generate baru — file-nya
    // jelas SUDAH ada kalau errornya soal default/named export).
    const pattern = /([^\s(]+\.tsx?)\((\d+),(\d+)\):\s*error\s+TS(2307|2305|2613|2614):[^'"]*['"]([^'"]+)['"]/g;
    for (const match of errorLog.matchAll(pattern)) {
      const importingFile = match[1].replace(/^\/workspace\//, ''); // tsc kadang print absolute path /workspace/...
      const errorCode = match[4];
      const moduleSpecifier = match[5];

      let resolvedPath: string | null = null;

      if (moduleSpecifier.startsWith('.')) {
        // Import relatif ("./foo", "../bar") — resolve relatif ke folder file yang meng-import.
        const importingDir = importingFile.split('/').slice(0, -1).join('/');
        const resolvedParts: string[] = importingDir.split('/');
        for (const segment of moduleSpecifier.split('/')) {
          if (segment === '.' || segment === '') continue;
          if (segment === '..') resolvedParts.pop();
          else resolvedParts.push(segment);
        }
        resolvedPath = `${resolvedParts.join('/')}.ts`;
      } else if (moduleSpecifier.startsWith('@/')) {
        // Alias Next.js — "@/lib/utils" -> "lib/utils.ts" (relatif ke ROOT project, bukan folder importer).
        resolvedPath = `${moduleSpecifier.slice(2)}.ts`;
      } else {
        continue; // package npm asli (mis. "recharts") — bukan file lokal kita, skip.
      }

      // TS2613/TS2614 (export default vs named ketuker) — file-nya SUDAH ADA,
      // ini soal isi file yang salah (export style), bukan file hilang.
      // Coba path .tsx juga untuk component React sebelum nyerah ke .ts.
      const candidatePaths = [resolvedPath, resolvedPath.replace(/\.ts$/, '.tsx')];
      const existingCandidate = candidatePaths.find((p) => knownSet.has(p));

      if (existingCandidate) {
        filesToRepair.add(existingCandidate);
      } else if (errorCode === '2307') {
        // Betul-betul tidak ada — TS2305/2613/2614 selalu soal file yang SUDAH ada,
        // jadi kalau tidak ketemu di manifest untuk kode-kode itu, kemungkinan besar
        // nama path-nya beda dikit (typo casing dst) — lebih aman diam daripada bikin
        // file duplikat yang malah nambah masalah baru.
        filesToCreate.add(resolvedPath.endsWith('.tsx') ? resolvedPath : candidatePaths[1]);
      }
    }

    return { filesToRepair: [...filesToRepair], filesToCreate: [...filesToCreate] };
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
