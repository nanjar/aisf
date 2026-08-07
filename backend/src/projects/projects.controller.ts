import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Body,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateProjectDto } from './dto/create-project.dto';
import { ProjectsService } from './projects.service';

@Controller('projects')
@UseGuards(JwtAuthGuard)
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  create(@Body() dto: CreateProjectDto) {
    return this.projectsService.create(dto);
  }

  @Get()
  findAll() {
    return this.projectsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.projectsService.findOne(id);
  }

  // V1.1
  @Get(':id/download')
  async download(
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const stream = await this.projectsService.buildDownloadArchive(id);
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="project-${id}.zip"`,
    });
    return new StreamableFile(stream);
  }
}
