import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { ValidationResult } from '../types';

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Sama seperti docker-exec.util.ts: WAJIB tangani event 'error' (spawn gagal,
 * mis. binary docker tidak ada) — kalau tidak, itu jadi unhandled 'error'
 * event yang menjatuhkan seluruh proses backend, bukan cuma gagal 1 validasi.
 * File ini sebelumnya punya helper run() sendiri yang TIDAK punya proteksi
 * ini — postmortem V1.3 Fase 3 soal ini ada di docker-exec.util.ts.
 */
function run(cmd: string, args: string[]): Promise<RunResult> {
  return new Promise((resolve) => {
    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn(cmd, args);
    } catch (err) {
      resolve({ code: -1, stdout: '', stderr: `[spawn] ${(err as Error).message}` });
      return;
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    proc.stdout?.on('data', (d) => (stdout += d.toString()));
    proc.stderr?.on('data', (d) => (stderr += d.toString()));
    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      resolve({ code: -1, stdout, stderr: `${stderr}\n[spawn error] ${err.message}` });
    });
    proc.on('close', (code) => {
      if (settled) return;
      settled = true;
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

/**
 * §11.3 — Database: apply migration.sql ke instance PostgreSQL sekali pakai
 * (BUKAN database produksi asli) → PASS/FAIL. Jaringan Docker terpisah per
 * run, container selalu dibersihkan lewat finally meski gagal/timeout.
 *
 * Fix (sama root cause dengan docker-exec.util.ts): bind-mount (-v) tidak
 * bisa dipakai di setup Docker-outside-of-Docker kita — path di-resolve
 * daemon HOST, bukan filesystem container backend. Pakai `docker cp` untuk
 * masukkan migration.sql ke container.
 */
@Injectable()
export class DatabaseValidatorService {
  private readonly logger = new Logger(DatabaseValidatorService.name);

  async validate(migrationSqlPath: string): Promise<ValidationResult> {
    const runId = randomUUID().slice(0, 8);
    const networkName = `asf-validate-net-${runId}`;
    const containerName = `asf-validate-pg-${runId}`;
    const psqlContainerName = `asf-validate-psql-${runId}`;

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

      const create = await run('docker', [
        'create', '--name', psqlContainerName,
        '--network', networkName,
        '-e', 'PGPASSWORD=validate',
        'postgres:16',
        'psql', '-h', containerName, '-U', 'postgres', '-d', 'validate', '-v', 'ON_ERROR_STOP=1',
        '-f', '/migration.sql',
      ]);
      if (create.code !== 0) return { passed: false, errorLog: `[docker create psql]\n${create.stderr || create.stdout}` };

      try {
        const cp = await run('docker', ['cp', migrationSqlPath, `${psqlContainerName}:/migration.sql`]);
        if (cp.code !== 0) return { passed: false, errorLog: `[docker cp migration.sql]\n${cp.stderr || cp.stdout}` };

        const apply = await run('docker', ['start', '-a', psqlContainerName]);
        if (apply.code !== 0) return { passed: false, errorLog: `[psql migration]\n${apply.stderr || apply.stdout}` };
        return { passed: true };
      } finally {
        await run('docker', ['rm', '-f', psqlContainerName]);
      }
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
