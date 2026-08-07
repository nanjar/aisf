import { Injectable, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export type SupportedLang = 'id' | 'en';

const SUPPORTED_LANGS: SupportedLang[] = ['id', 'en'];

@Injectable()
export class I18nService {
  private readonly cache = new Map<SupportedLang, Record<string, unknown>>();

  private loadFromDisk(lang: SupportedLang): Record<string, unknown> {
    const filePath = path.join(__dirname, 'locales', `${lang}.json`);
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as Record<string, unknown>;
  }

  /** Ambil seluruh kamus terjemahan untuk satu bahasa. Hasil di-cache in-memory. */
  getDictionary(lang: string): Record<string, unknown> {
    const normalized = lang.toLowerCase() as SupportedLang;
    if (!SUPPORTED_LANGS.includes(normalized)) {
      throw new NotFoundException(
        `Bahasa "${lang}" tidak didukung. Bahasa yang tersedia: ${SUPPORTED_LANGS.join(', ')}`,
      );
    }

    if (!this.cache.has(normalized)) {
      this.cache.set(normalized, this.loadFromDisk(normalized));
    }
    return this.cache.get(normalized)!;
  }

  getSupportedLanguages(): SupportedLang[] {
    return SUPPORTED_LANGS;
  }
}
