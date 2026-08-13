import { Injectable } from '@nestjs/common';
import { dockerRun } from '../docker-exec.util';
import { ValidationResult } from '../types';

/**
 * §11.3 — Frontend (Next.js): npm install -> tsc --noEmit -> npm run build -> PASS/FAIL
 * Lihat komentar di backend-validator.service.ts — alasan yang sama kenapa
 * 3 langkah ini digabung jadi 1 panggilan dockerRun().
 */
@Injectable()
export class FrontendValidatorService {
  async validate(workdir: string): Promise<ValidationResult> {
    const result = await dockerRun({
      image: 'node:20-slim',
      workdir,
      network: 'bridge',
      timeoutMs: 15 * 60_000,
      // Fix diagnostik — sama dengan backend-validator.service.ts.
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
      // Fix sama dengan backend-validator.service.ts — lihat komentar di sana.
      const combined = [result.stdout, result.stderr].filter(Boolean).join('\n\n--- stderr ---\n\n');
      return { passed: false, errorLog: `${combined}\n\n[exitCode: ${result.exitCode}]` };
    }
    return { passed: true };
  }
}
