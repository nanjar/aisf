import { spawn } from 'child_process';
import { randomUUID } from 'crypto';

export interface DockerRunOptions {
  image: string;
  workdir: string;
  command: string[];
  timeoutMs?: number;
  network?: 'none' | 'bridge';
}

export interface DockerRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/**
 * PENTING (postmortem produksi, V1.3 Fase 4): fungsi ini SEBELUMNYA pakai
 * bind-mount (`docker run -v <workdir>:/workspace`). Itu SALAH di setup kita
 * — backend AISF ini jalan dengan pola Docker-outside-of-Docker (cuma numpang
 * /var/run/docker.sock dari host, bukan Docker beneran). Path `-v` di-
 * resolve oleh DAEMON DI HOST, bukan filesystem container backend sendiri.
 * `workdir` (hasil SandboxService.materialize(), folder temp DI DALAM
 * container backend) tidak pernah ada secara fisik di host, jadi container
 * validasi selalu dapat folder /workspace KOSONG — persis kenapa
 * "package.json tidak ditemukan" padahal sudah pasti ada isinya.
 *
 * Fix: pakai `docker cp` (jalan lewat Docker API, dibaca oleh proses CLI
 * kita sendiri dari filesystem container backend — BUKAN di-resolve oleh
 * daemon host) alih-alih bind-mount. Pola: create (belum start) -> cp file
 * masuk -> start+attach -> rm. Tiap dockerRun() SATU container baru
 * (tidak persist antar-panggilan) — kalau validator butuh multi-step
 * (install -> typecheck -> build) yang saling bergantung pada hasil step
 * sebelumnya (mis. node_modules), gabungkan jadi SATU command shell dalam
 * SATU panggilan dockerRun(), jangan panggil terpisah.
 */
export async function dockerRun(opts: DockerRunOptions): Promise<DockerRunResult> {
  const timeoutMs = opts.timeoutMs ?? 5 * 60_000;
  const containerName = `asf-validate-${randomUUID()}`;

  const create = await execDocker([
    'create',
    '--name', containerName,
    '--network', opts.network ?? 'none',
    '--memory', '1g',
    '--cpus', '2',
    '--pids-limit', '512',
    '--security-opt', 'no-new-privileges',
    '-w', '/workspace',
    opts.image,
    ...opts.command,
  ]);
  if (create.exitCode !== 0) {
    return { exitCode: -1, stdout: '', stderr: `[docker create]\n${create.stderr || create.stdout}`, timedOut: false };
  }

  try {
    const cp = await execDocker(['cp', `${opts.workdir}/.`, `${containerName}:/workspace`]);
    if (cp.exitCode !== 0) {
      return { exitCode: -1, stdout: '', stderr: `[docker cp]\n${cp.stderr || cp.stdout}`, timedOut: false };
    }

    const start = await execDocker(['start', '-a', containerName], timeoutMs);
    return start;
  } finally {
    // Cleanup selalu dijalankan, terlepas dari hasil di atas — container
    // yang lupa dihapus bisa numpuk dan habiskan disk host lama-lama.
    await execDocker(['rm', '-f', containerName]).catch(() => undefined);
  }
}

function execDocker(args: string[], timeoutMs = 5 * 60_000): Promise<DockerRunResult> {
  return new Promise((resolve) => {
    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn('docker', args);
    } catch (err) {
      resolve({ exitCode: -1, stdout: '', stderr: `[spawn] ${(err as Error).message}`, timedOut: false });
      return;
    }

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGKILL');
    }, timeoutMs);

    proc.stdout?.on('data', (d) => (stdout += d.toString()));
    proc.stderr?.on('data', (d) => (stderr += d.toString()));

    // Kritikal (lihat komentar dockerRun di atas soal insiden crash-loop) —
    // spawn error (docker binary tidak ada, dsb) TIDAK BOLEH jadi unhandled
    // 'error' event, itu menjatuhkan seluruh proses Node, bukan cuma
    // mereject promise ini.
    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: -1, stdout, stderr: `${stderr}\n[spawn error] ${err.message}`, timedOut: false });
    });

    proc.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: code ?? -1, stdout, stderr, timedOut });
    });
  });
}
