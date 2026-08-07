import { Controller, Get, Param } from '@nestjs/common';
import { I18nService } from './i18n.service';

// Publik (tanpa JWT) — dipanggil oleh frontend saat load awal & setiap kali user ganti bahasa,
// sebelum user tentu sudah login. Lihat PRD V1.1 Section 4.2 (Bilingual).
@Controller('i18n')
export class I18nController {
  constructor(private readonly i18nService: I18nService) {}

  @Get(':lang')
  getDictionary(@Param('lang') lang: string) {
    return this.i18nService.getDictionary(lang);
  }
}
