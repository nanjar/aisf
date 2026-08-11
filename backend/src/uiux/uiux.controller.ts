import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { N8nWebhookGuard } from '../webhooks/n8n-webhook.guard';
import { UiuxService } from './uiux.service';
import { GenerateUiuxDto } from './dto/generate-uiux.dto';
import { UiuxContentDto } from './dto/uiux-content.dto';

/**
 * §81 n8n flow — UI/UX Designer node di workflow n8n memanggil endpoint ini
 * (bukan lagi n8n yang panggil DeepSeek langsung, sesuai keputusan LLM
 * ownership Fase 1). Sengaja di bawah /webhooks/n8n/ dan pakai guard yang
 * sama dengan webhook n8n lain — bukan endpoint publik/JWT.
 *
 * Fix arsitektur (postmortem: n8n HTTP node timeout 300s sementara backend
 * masih proses di background) — /uiux/generate SEKARANG fire-and-forget,
 * pola sama seperti BackendGenController/FrontendGenController. Balas 202
 * langsung, generation jalan di background.
 */
@Controller('webhooks/n8n')
@UseGuards(N8nWebhookGuard)
export class UiuxController {
  constructor(private readonly uiuxService: UiuxService) {}

  @Post('uiux/generate')
  @HttpCode(HttpStatus.ACCEPTED)
  generate(@Body() dto: GenerateUiuxDto) {
    this.uiuxService.generate(dto).catch((err) => {
      console.error('[UiuxController] Unhandled error dari generate():', err);
    });
    return { accepted: true };
  }

  /**
   * Dipanggil node "Fetch UIUX Design Spec" TEPAT SEBELUM Frontend Developer
   * Agent di n8n — lihat komentar di UiuxService.getContentForFrontend().
   * TETAP synchronous (bukan fire-and-forget) — murni baca S3, cepat.
   */
  @Post('uiux/content')
  @HttpCode(HttpStatus.OK)
  getContent(@Body() dto: UiuxContentDto) {
    return this.uiuxService.getContentForFrontend(dto.projectId);
  }
}
