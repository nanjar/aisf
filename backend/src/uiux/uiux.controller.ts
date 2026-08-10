import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { N8nWebhookGuard } from '../webhooks/n8n-webhook.guard';
import { UiuxService } from './uiux.service';
import { GenerateUiuxDto } from './dto/generate-uiux.dto';

/**
 * §81 n8n flow — UI/UX Designer node di workflow n8n memanggil endpoint ini
 * (bukan lagi n8n yang panggil DeepSeek langsung, sesuai keputusan LLM
 * ownership Fase 1). Sengaja di bawah /webhooks/n8n/ dan pakai guard yang
 * sama dengan webhook n8n lain — bukan endpoint publik/JWT.
 */
@Controller('webhooks/n8n')
@UseGuards(N8nWebhookGuard)
export class UiuxController {
  constructor(private readonly uiuxService: UiuxService) {}

  @Post('uiux/generate')
  @HttpCode(HttpStatus.OK)
  generate(@Body() dto: GenerateUiuxDto) {
    return this.uiuxService.generate(dto);
  }
}
