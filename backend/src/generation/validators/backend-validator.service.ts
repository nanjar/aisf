import { Injectable } from '@nestjs/common';
import { dockerRun } from '../docker-exec.util';
import { ValidationResult } from '../types';

/** §11.3 — Backend (NestJS): npm install → tsc --noEmit → PASS/FAIL */
@Injectable()
export class BackendValidatorService {
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

    return { passed: true };
  }
}
