import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Body,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateProjectDto } from './dto/create-project.dto';
import { ProjectsService } from './projects.service';

type AuthedRequest = Request & { user: { userId: string; email: string } };

@Controller('projects')
@UseGuards(JwtAuthGuard)
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  create(@Body() dto: CreateProjectDto, @Req() req: AuthedRequest) {
    return this.projectsService.create(dto, req.user.userId);
  }

  @Get()
  findAll(@Req() req: AuthedRequest) {
    return this.projectsService.findAll(req.user.userId);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthedRequest) {
    return this.projectsService.findOne(id, req.user.userId);
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
