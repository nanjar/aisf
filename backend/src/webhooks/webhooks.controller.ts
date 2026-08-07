import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { N8nWebhookGuard } from './n8n-webhook.guard';
import { StageReadyDto } from './dto/stage-ready.dto';
import { WorkflowEventDto } from './dto/workflow-event.dto';
import { WebhooksService } from './webhooks.service';

@Controller('webhooks/n8n')
@UseGuards(N8nWebhookGuard)
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post('stage-ready')
  @HttpCode(HttpStatus.OK)
  stageReady(@Body() dto: StageReadyDto) {
    return this.webhooksService.handleStageReady(dto);
  }

  @Post('workflow-completed')
  @HttpCode(HttpStatus.OK)
  workflowCompleted(@Body() dto: WorkflowEventDto) {
    return this.webhooksService.handleWorkflowEvent(dto);
  }
}
