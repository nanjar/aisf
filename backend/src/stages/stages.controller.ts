import { Body, Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Post, Put, Req, UseGuards } from '@nestjs/common';
import { StageKey } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/rbac/roles.guard';
import { Roles } from '../common/rbac/roles.decorator';
import { OrgRole } from '@prisma/client';
import { DecideStageDto, AssignStageDto, SetDeadlineDto } from './dto/decide-stage.dto';
import { RollbackStageDto } from './dto/rollback-stage.dto';
import { StagesService } from './stages.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

@Controller('projects/:projectId/stages')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StagesController {
  constructor(
    private readonly stagesService: StagesService,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  // V1.2 FR-801 — assignment butuh Owner/Admin, resolusi via :projectId (bukan :organizationId)
  @Put(':stageKey/assignment')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  assign(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('stageKey') stageKey: StageKey,
    @Body() dto: AssignStageDto,
    @Req() req: Request & { user: { userId: string } },
  ) {
    return this.stagesService.assign(projectId, stageKey, dto, req.user.userId);
  }

  // V1.2 FR-803
  @Put(':stageKey/deadline')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  setDeadline(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('stageKey') stageKey: StageKey,
    @Body() dto: SetDeadlineDto,
  ) {
    return this.stagesService.setDeadline(projectId, stageKey, dto);
  }

  @Get(':stageKey/revisions')
  revisions(@Param('projectId', ParseUUIDPipe) projectId: string, @Param('stageKey') stageKey: StageKey) {
    return this.stagesService.revisions(projectId, stageKey);
  }

  // V1.2 §10 — daftar file (metadata) hasil generation file-by-file
  @Get(':stageKey/files')
  async files(@Param('projectId', ParseUUIDPipe) projectId: string, @Param('stageKey') stageKey: StageKey) {
    const stage = await this.prisma.artifactStage.findUniqueOrThrow({
      where: { projectId_stageKey: { projectId, stageKey } },
    });
    return this.prisma.artifactObject.findMany({
      where: { artifactStageId: stage.id },
      orderBy: [{ fileName: 'asc' }, { version: 'desc' }],
    });
  }

  @Get(':stageKey/files/:fileId/download-url')
  async downloadUrl(@Param('fileId') fileId: string) {
    const file = await this.prisma.artifactObject.findUniqueOrThrow({ where: { id: fileId } });
    const url = await this.storage.getPresignedDownloadUrl(file.bucket, file.objectKey);
    return { url, expiresInSeconds: 900 };
  }

  // §Version History — daftar semua version yang pernah ter-generate untuk stage ini.
  @Get(':stageKey/versions')
  listVersions(@Param('projectId', ParseUUIDPipe) projectId: string, @Param('stageKey') stageKey: StageKey) {
    return this.stagesService.listVersions(projectId, stageKey);
  }

  // Isi teks satu version tertentu — dipakai UI buat lihat/bandingkan versi lama vs sekarang.
  @Get(':stageKey/versions/:version/content')
  getVersionContent(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('stageKey') stageKey: StageKey,
    @Param('version', ParseIntPipe) version: number,
  ) {
    return this.stagesService.getVersionContent(projectId, stageKey, version);
  }

  // Restore isi version lama sebagai version BARU (history tetap utuh, forward-only).
  @Post(':stageKey/rollback')
  rollback(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('stageKey') stageKey: StageKey,
    @Body() dto: RollbackStageDto,
    @Req() req: Request & { user: { email: string } },
  ) {
    return this.stagesService.rollback(projectId, stageKey, dto.version, req.user.email);
  }

  /**
   * §UX — dashboard butuh info progres+estimasi durasi buat stage yang lagi
   * generate (bisa 10-40+ menit untuk Backend/Frontend dengan puluhan file).
   * Generic untuk stage manapun yang pakai GenerationJob (UIUX, BACKEND, dan
   * FRONTEND/DATABASE nanti begitu dimigrasikan) — tidak spesifik ke 1 stage.
   */
  @Get(':stageKey/progress')
  async progress(@Param('projectId', ParseUUIDPipe) projectId: string, @Param('stageKey') stageKey: StageKey) {
    const stage = await this.prisma.artifactStage.findUnique({
      where: { projectId_stageKey: { projectId, stageKey } },
    });
    if (!stage) return { active: false };

    const job = await this.prisma.generationJob.findFirst({
      where: { artifactStageId: stage.id, status: { in: ['RUNNING', 'VALIDATING'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (!job || !job.startedAt) return { active: false };

    const elapsedSeconds = Math.max(1, Math.round((Date.now() - job.startedAt.getTime()) / 1000));
    const avgSecondsPerFile = job.generatedFiles > 0 ? elapsedSeconds / job.generatedFiles : null;
    const remainingFiles = Math.max(0, job.totalFiles - job.generatedFiles);
    const estimatedRemainingSeconds =
      avgSecondsPerFile !== null && job.totalFiles > 0 ? Math.round(avgSecondsPerFile * remainingFiles) : null;

    return {
      active: true,
      status: job.status,
      totalFiles: job.totalFiles,
      generatedFiles: job.generatedFiles,
      invalidFiles: job.invalidFiles,
      elapsedSeconds,
      estimatedRemainingSeconds, // null = belum ada file selesai sama sekali, belum bisa diestimasi
      attempt: job.attempt,
      maxAttempts: job.maxAttempts,
    };
  }

  // Tidak dibatasi @Roles() di sini — permission per-stage (assignment-based
  // untuk MEMBER) dicek di dalam StagesService.decide() itu sendiri, karena
  // butuh tahu stageKey mana yang di-assign, bukan sekadar role global.
  @Post(':stageKey/decision')
  decide(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('stageKey') stageKey: StageKey,
    @Body() dto: DecideStageDto,
    @Req() req: Request & { user: { userId: string; email: string }; member: { id: string; role: OrgRole } },
  ) {
    return this.stagesService.decide(projectId, stageKey, dto, {
      userId: req.user.userId,
      email: req.user.email,
      memberId: req.member.id,
      role: req.member.role,
    });
  }
}
