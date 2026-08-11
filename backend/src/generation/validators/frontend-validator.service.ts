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
      timeoutMs: 10 * 60_000,
      command: ['sh', '-c', 'npm install --no-audit --no-fund && npx tsc --noEmit && npm run build'],
    });

    if (result.exitCode !== 0 || result.timedOut) {
      return { passed: false, errorLog: result.stderr || result.stdout };
    }
    return { passed: true };
  }
}
