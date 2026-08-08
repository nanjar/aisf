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

    const proc = spawn('docker', args);
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGKILL');
    }, timeoutMs);

    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));

    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? -1, stdout, stderr, timedOut });
    });
  });
}
