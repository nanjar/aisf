import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { N8nWebhookGuard } from '../webhooks/n8n-webhook.guard';
import { BackendGenService } from './backend-gen.service';
import { GenerateBackendDto } from './dto/generate-backend.dto';

/**
 * §81-style n8n flow, versi async — beda dari /webhooks/n8n/uiux/generate.
 * UI/UX cuma 7 file dengan 7 panggilan LLM (selesai puluhan detik), aman
 * disinkronkan dengan 1 HTTP request. Backend bisa puluhan file (manifest
 * dinamis) — generate bisa makan waktu MENIT, jadi endpoint ini SENGAJA
 * fire-and-forget: balas 202 langsung, generation jalan di background.
 * n8n cuma perlu tahu request-nya diterima, lalu diam di Wait node sampai
 * ArtifactStage di-update lewat resumeUrl yang sama seperti stage lain
 * (lihat BackendGenService.generate()).
 */
@Controller('webhooks/n8n')
@UseGuards(N8nWebhookGuard)
export class BackendGenController {
  constructor(private readonly backendGenService: BackendGenService) {}

  @Post('backend/generate')
  @HttpCode(HttpStatus.ACCEPTED)
  generate(@Body() dto: GenerateBackendDto) {
    this.backendGenService.generate(dto).catch((err) => {
      // Safety net kalau ada error yang lolos dari try/catch internal generate() —
      // seharusnya tidak pernah kejadian karena generate() sudah handle semua
      // error path sendiri, ini cuma jaga-jaga supaya tidak jadi unhandled
      // promise rejection yang bisa crash proses Node.
      console.error('[BackendGenController] Unhandled error dari generate():', err);
    });
    return { accepted: true };
  }

  /**
   * Dipanggil node "Fetch Backend Summary" di n8n sebelum QA Engineer Agent —
   * "Save Backend Artifact" (yang dulu nyimpan $json.output ke execution)
   * sudah dihapus karena backend sekarang generate file-by-file, bukan 1 blob
   * di n8n. QA butuh ringkasannya buat konteks review.
   */
  @Post('backend/summary')
  @HttpCode(HttpStatus.OK)
  getSummary(@Body() dto: GenerateBackendDto) {
    return this.backendGenService.getSummary(dto.projectId);
  }
}
