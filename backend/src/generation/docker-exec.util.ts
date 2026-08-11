import { spawn } from 'child_process';

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
 * Jalankan satu command validasi di container Docker sekali pakai, mount
 * read-write ke direktori hasil SandboxService.materialize(). Default
 * `--network none` supaya file hasil generate tidak bisa exfiltrate apapun
 * lewat postinstall script — `bridge` cuma dipakai untuk step yang benar-
 * benar butuh akses registry (npm install).
 *
 * PENTING (postmortem produksi, V1.3 Fase 3): kalau binary `docker` tidak
 * ketemu (ENOENT) atau spawn gagal karena alasan lain, Node.js child_process
 * melempar event 'error' yang ASYNC — kalau tidak ditangani, event itu jadi
 * unhandled dan MENJATUHKAN SELURUH PROSES backend (bukan cuma promise ini
 * reject). Ini benar-benar kejadian di production: docker.sock ter-mount
 * tapi CLI docker belum terinstall di image, dan itu bikin backend crash-loop
 * setiap kali ada job yang sampai ke tahap validasi. Listener 'error' di
 * bawah WAJIB ada, jangan dihapus.
 */
export function dockerRun(opts: DockerRunOptions): Promise<DockerRunResult> {
  const timeoutMs = opts.timeoutMs ?? 5 * 60_000;

  return new Promise((resolve) => {
    const args = [
      'run', '--rm',
      '--network', opts.network ?? 'none',
      '-v', `${opts.workdir}:/workspace`,
      '-w', '/workspace',
      opts.image,
      ...opts.command,
    ];

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

    // Kritikal — lihat komentar fungsi. Tanpa handler ini, spawn error
    // (docker binary tidak ada, dsb) crash seluruh proses Node, bukan cuma
    // reject promise ini.
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
