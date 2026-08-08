import { Injectable } from '@nestjs/common';
import { dockerRun } from '../docker-exec.util';
import { ValidationResult } from '../types';

/** §11.3 — Frontend (Next.js): npm install → tsc --noEmit → npm run build → PASS/FAIL */
@Injectable()
export class FrontendValidatorService {
  async validate(workdir: string): Promise<ValidationResult> {
    const install = await dockerRun({
      image: 'node:20-slim',
      workdir,
      network: 'bridge',
      command: ['sh', '-c', 'npm install --no-audit --no-fund'],
    });
    if (install.exitCode !== 0 || install.timedOut) {
      return { passed: false, errorLog: `[npm install]\n${install.stderr || install.stdout}` };
    }

    const typecheck = await dockerRun({
      image: 'node:20-slim',
      workdir,
      network: 'none',
      command: ['sh', '-c', 'npx tsc --noEmit'],
    });
    if (typecheck.exitCode !== 0 || typecheck.timedOut) {
      return { passed: false, errorLog: `[tsc --noEmit]\n${typecheck.stderr || typecheck.stdout}` };
    }

    const build = await dockerRun({
      image: 'node:20-slim',
      workdir,
      network: 'none',
      timeoutMs: 8 * 60_000,
      command: ['sh', '-c', 'npm run build'],
    });
    if (build.exitCode !== 0 || build.timedOut) {
      return { passed: false, errorLog: `[npm run build]\n${build.stderr || build.stdout}` };
    }

    return { passed: true };
  }
}
