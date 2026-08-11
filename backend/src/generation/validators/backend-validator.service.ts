import { Injectable } from '@nestjs/common';
import { dockerRun } from '../docker-exec.util';
import { ValidationResult } from '../types';

/**
 * §11.3 — Backend (NestJS): npm install -> tsc --noEmit -> npm run build -> PASS/FAIL
 *
 * Fix (V1.3 Fase 4 postmortem): SEBELUMNYA 3 panggilan dockerRun() terpisah,
 * mengandalkan bind-mount folder yang SAMA supaya node_modules dari npm
 * install ikut kepakai di step berikutnya. Sejak dockerRun() diubah ke pola
 * docker cp (fix bug bind-mount Docker-outside-of-Docker — lihat komentar di
 * docker-exec.util.ts), tiap panggilan dockerRun() = container BARU dan
 * TERPISAH — jadi 3 langkah ini WAJIB digabung jadi 1 command shell dalam
 * 1 panggilan, supaya tetap 1 container yang sama dari install sampai build.
 *
 * Trade-off yang disadari: network jadi 'bridge' untuk SELURUH proses
 * (sebelumnya 'none' khusus buat step tsc/build) karena network container
 * ditentukan sekali di awal (docker create), tidak bisa diubah di tengah.
 * Given npm install sendiri sudah butuh network dan bisa jalankan postinstall
 * script sembarang, proteksi 'none' di step lanjutan cuma proteksi parsial —
 * trade-off ini diterima demi kesederhanaan implementasi.
 */
@Injectable()
export class BackendValidatorService {
  async validate(workdir: string): Promise<ValidationResult> {
    const result = await dockerRun({
      image: 'node:20-slim',
      workdir,
      network: 'bridge',
      timeoutMs: 15 * 60_000,
      command: ['sh', '-c', 'npm install --no-audit --no-fund && npx tsc --noEmit && npm run build'],
    });

    if (result.exitCode !== 0 || result.timedOut) {
      return { passed: false, errorLog: result.stderr || result.stdout };
    }
    return { passed: true };
  }
}
