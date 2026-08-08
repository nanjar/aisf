import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Req, UseGuards } from '@nestjs/common';
import { StageKey } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/rbac/roles.guard';
import { Roles } from '../common/rbac/roles.decorator';
import { OrgRole } from '@prisma/client';
import { DecideStageDto, AssignStageDto, SetDeadlineDto } from './dto/decide-stage.dto';
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
