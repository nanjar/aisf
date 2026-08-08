import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { N8nWebhookGuard } from './n8n-webhook.guard';
import { StageReadyDto } from './dto/stage-ready.dto';
import { WorkflowEventDto } from './dto/workflow-event.dto';
import { UploadFileDto } from './dto/upload-file.dto';
import { ValidateStageDto } from './dto/validate-stage.dto';
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

  // V1.2 §11.1 — dipanggil sekali per file dalam loop generation file-by-file
  @Post('upload-file')
  @HttpCode(HttpStatus.OK)
  uploadFile(@Body() dto: UploadFileDto) {
    return this.webhooksService.handleUploadFile(dto);
  }

  // V1.2 §11.3 — dipanggil node "Validate <Nama>" setelah generation selesai
  @Post('validate-stage')
  @HttpCode(HttpStatus.OK)
  validateStage(@Body() dto: ValidateStageDto) {
    return this.webhooksService.handleValidateStage(dto);
  }
}
