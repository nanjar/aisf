'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, getToken, clearToken, ApiError, type ProjectSummary } from '@/lib/api';

const STATUS_BADGE: Record<string, string> = {
  RUNNING: 'bg-track/15 text-track border-track/30',
  COMPLETED: 'bg-go/15 text-go border-go/30',
  REJECTED: 'bg-stop/15 text-stop border-stop/30',
  FAILED: 'bg-stop/15 text-stop border-stop/30',
};

const STATUS_TEXT: Record<string, string> = {
  RUNNING: 'Berjalan',
  COMPLETED: 'Selesai',
  REJECTED: 'Ditolak',
  FAILED: 'Gagal',
};

export default function DashboardPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.listProjects();
      setProjects(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearToken();
        router.push('/login');
        return;
      }
      setError(err instanceof ApiError ? err.message : 'Gagal memuat daftar project.');
    }
  }, [router]);

  useEffect(() => {
    if (!getToken()) {
      router.push('/login');
      return;
    }
    load();
    const interval = setInterval(load, 8000);
    return () => clearInterval(interval);
  }, [load, router]);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-display text-xs uppercase tracking-widest text-track">AI Software Factory</p>
          <h1 className="mt-1 text-2xl font-semibold text-ink">Ruang Kendali</h1>
        </div>
        <Link
          href="/projects/new"
          className="rounded-md bg-track px-4 py-2 text-sm font-medium text-floor transition hover:opacity-90"
        >
          + Project Baru
        </Link>
      </div>

      {error && <p className="mt-6 text-sm text-stop">{error}</p>}

      <div className="mt-8 space-y-3">
        {projects === null && !error && <p className="text-sm text-inkMuted">Memuat…</p>}

        {projects?.length === 0 && (
          <div className="rounded-lg border border-dashed border-panelBorder p-10 text-center">
            <p className="text-sm text-inkMuted">
              Belum ada project. Mulai satu untuk melihat pipeline-nya berjalan.
            </p>
          </div>
        )}

        {projects?.map((p) => (
          <Link
            key={p.id}
            href={`/projects/${p.id}`}
            className="flex items-center justify-between rounded-lg border border-panelBorder bg-panel px-5 py-4 transition hover:border-track/50"
          >
            <div>
              <p className="font-medium text-ink">{p.name}</p>
              <p className="mt-0.5 font-display text-xs text-inkMuted">
                Tahap saat ini: {p.currentStageLabel}
              </p>
            </div>
            <span className={`rounded-full border px-3 py-1 font-display text-[11px] ${STATUS_BADGE[p.status]}`}>
              {STATUS_TEXT[p.status]}
            </span>
          </Link>
        ))}
      </div>
    </main>
  );
}
