import { Body, Controller, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { StageKey } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DecideStageDto } from './dto/decide-stage.dto';
import { StagesService } from './stages.service';

type AuthedRequest = Request & { user: { userId: string; email: string } };

@Controller('projects/:projectId/stages')
@UseGuards(JwtAuthGuard)
export class StagesController {
  constructor(private readonly stagesService: StagesService) {}

  @Post(':stageKey/decision')
  decide(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('stageKey') stageKey: StageKey,
    @Body() dto: DecideStageDto,
    @Req() req: AuthedRequest,
  ) {
    return this.stagesService.decide(projectId, stageKey, dto, req.user.userId, req.user.email);
  }
}
