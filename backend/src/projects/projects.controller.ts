import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Body,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/rbac/roles.guard';
import { Roles } from '../common/rbac/roles.decorator';
import { OrgRole } from '@prisma/client';
import { CreateProjectDto } from './dto/create-project.dto';
import { SetProjectDeadlineDto } from './dto/set-deadline.dto';
import { ProjectsService } from './projects.service';

type AuthedRequest = Request & { user: { userId: string } };

@Controller('projects')
@UseGuards(JwtAuthGuard)
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  create(@Body() dto: CreateProjectDto, @Req() req: AuthedRequest) {
    return this.projectsService.create(dto, req.user.userId);
  }

  // V1.2 (visibilitas per-assignment): MEMBER hanya lihat project yang relevan untuknya.
  @Get()
  findAll(@Req() req: AuthedRequest) {
    return this.projectsService.findAll(req.user.userId);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthedRequest) {
    return this.projectsService.findOne(id, req.user.userId);
  }

  @Put(':id/deadline')
  @UseGuards(RolesGuard)
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  setDeadline(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetProjectDeadlineDto) {
    return this.projectsService.setDeadline(id, dto);
  }

  @Get(':id/download')
  async download(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const stream = await this.projectsService.buildDownloadArchive(id, req.user.userId);
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="project-${id}.zip"`,
    });
    return new StreamableFile(stream);
  }
}
