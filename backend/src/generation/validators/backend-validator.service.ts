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
      // Fix diagnostik (postmortem: gagal tanpa satu baris "npm error" pun,
      // tidak jelas step mana yang gagal — npm install, tsc, atau build).
      // Tambah marker eksplisit SEBELUM tiap step + exit code tiap step,
      // supaya kalau error text-nya sendiri ambigu/kepotong, minimal jelas
      // STEP MANA yang lagi jalan waktu gagal (marker terakhir yang muncul
      // = step yang gagal, karena `set -e` langsung stop begitu 1 command
      // exit non-zero).
      command: [
        'sh', '-c',
        'set -e; ' +
        'echo "=== STEP 1: npm install ==="; npm install --no-audit --no-fund; ' +
        'echo "=== STEP 2: tsc --noEmit ==="; npx tsc --noEmit; ' +
        'echo "=== STEP 3: npm run build ==="; npm run build; ' +
        'echo "=== SEMUA STEP LOLOS ==="',
      ],
    });

    if (result.exitCode !== 0 || result.timedOut) {
      // Fix kritikal (postmortem: berkali-kali debugging cuma lihat warning
      // npm, TIDAK PERNAH lihat error tsc/build sungguhan). stderr || stdout
      // itu SALAH — stderr HAMPIR SELALU non-empty (npm cetak deprecation
      // warning ke stderr), jadi stdout (tempat error tsc/npm run build
      // paling mungkin muncul) SELALU dibuang total, apapun isinya. Gabung
      // keduanya, jangan pilih salah satu.
      const combined = [result.stdout, result.stderr].filter(Boolean).join('\n\n--- stderr ---\n\n');
      // Exit code eksplisit ditaruh PALING AKHIR — selalu selamat dari
      // slice(-N) di layer atasnya (backend-gen.service.ts), berapa pun N-nya.
      return { passed: false, errorLog: `${combined}\n\n[exitCode: ${result.exitCode}]` };
    }
    return { passed: true };
  }
}
