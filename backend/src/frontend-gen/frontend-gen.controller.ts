import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { N8nWebhookGuard } from '../webhooks/n8n-webhook.guard';
import { FrontendGenService } from './frontend-gen.service';
import { GenerateFrontendDto } from './dto/generate-frontend.dto';

/** Pola identik backend-gen.controller.ts — lihat komentar di sana untuk alasan async. */
@Controller('webhooks/n8n')
@UseGuards(N8nWebhookGuard)
export class FrontendGenController {
  constructor(private readonly frontendGenService: FrontendGenService) {}

  @Post('frontend/generate')
  @HttpCode(HttpStatus.ACCEPTED)
  generate(@Body() dto: GenerateFrontendDto) {
    this.frontendGenService.generate(dto).catch((err) => {
      console.error('[FrontendGenController] Unhandled error dari generate():', err);
    });
    return { accepted: true };
  }

  @Post('frontend/summary')
  @HttpCode(HttpStatus.OK)
  getSummary(@Body() dto: GenerateFrontendDto) {
    return this.frontendGenService.getSummary(dto.projectId);
  }
}
