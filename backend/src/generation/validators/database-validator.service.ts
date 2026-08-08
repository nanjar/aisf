import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { ValidationResult } from '../types';

function run(cmd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args);
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

/**
 * §11.3 — Database: apply migration.sql ke instance PostgreSQL sekali pakai
 * (BUKAN database produksi asli) → PASS/FAIL. Jaringan Docker terpisah per
 * run, container selalu dibersihkan lewat finally meski gagal/timeout.
 */
@Injectable()
export class DatabaseValidatorService {
  private readonly logger = new Logger(DatabaseValidatorService.name);

  async validate(migrationSqlPath: string): Promise<ValidationResult> {
    const runId = randomUUID().slice(0, 8);
    const networkName = `asf-validate-net-${runId}`;
    const containerName = `asf-validate-pg-${runId}`;

    await run('docker', ['network', 'create', networkName]);

    try {
      const start = await run('docker', [
        'run', '-d', '--rm',
        '--network', networkName,
        '--name', containerName,
        '-e', 'POSTGRES_PASSWORD=validate',
        '-e', 'POSTGRES_DB=validate',
        'postgres:16',
      ]);
      if (start.code !== 0) return { passed: false, errorLog: `[docker run postgres]\n${start.stderr}` };

      await this.waitForReady(containerName, networkName);

      const apply = await run('docker', [
        'run', '--rm',
        '--network', networkName,
        '-v', `${migrationSqlPath}:/migration.sql:ro`,
        '-e', 'PGPASSWORD=validate',
        'postgres:16',
        'psql', '-h', containerName, '-U', 'postgres', '-d', 'validate', '-v', 'ON_ERROR_STOP=1',
        '-f', '/migration.sql',
      ]);

      if (apply.code !== 0) return { passed: false, errorLog: `[psql migration]\n${apply.stderr || apply.stdout}` };
      return { passed: true };
    } finally {
      await run('docker', ['rm', '-f', containerName]);
      await run('docker', ['network', 'rm', networkName]);
    }
  }

  private async waitForReady(containerName: string, networkName: string, attempts = 20) {
    for (let i = 0; i < attempts; i++) {
      const check = await run('docker', [
        'run', '--rm', '--network', networkName, 'postgres:16',
        'pg_isready', '-h', containerName, '-U', 'postgres',
      ]);
      if (check.code === 0) return;
      await new Promise((r) => setTimeout(r, 500));
    }
    this.logger.warn(`Sandbox Postgres ${containerName} tidak siap tepat waktu`);
  }
}
