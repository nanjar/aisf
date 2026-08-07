'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, getToken, clearToken, ApiError, type ProjectDetail, type StageKey } from '@/lib/api';
import { StationRail } from '@/components/StationRail';
import { StageCard } from '@/components/StageCard';

const STATUS_TEXT: Record<string, string> = {
  RUNNING: 'Berjalan',
  COMPLETED: 'Selesai',
  REJECTED: 'Ditolak',
  FAILED: 'Gagal',
};

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [decidingKey, setDecidingKey] = useState<StageKey | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.getProject(params.id);
      setProject(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearToken();
        router.push('/login');
        return;
      }
      setError(err instanceof ApiError ? err.message : 'Gagal memuat project.');
    }
  }, [params.id, router]);

  useEffect(() => {
    if (!getToken()) {
      router.push('/login');
      return;
    }
    load();
    const interval = setInterval(load, 6000);
    return () => clearInterval(interval);
  }, [load, router]);

  async function handleDecide(stageKey: StageKey, decision: 'approved' | 'rejected', comment: string) {
    setDecidingKey(stageKey);
    setError(null);
    try {
      await api.decideStage(params.id, stageKey, decision, comment);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal mengirim keputusan.');
    } finally {
      setDecidingKey(null);
    }
  }

  if (!project) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-10">
        <p className="text-sm text-inkMuted">{error ?? 'Memuat…'}</p>
      </main>
    );
  }

  const activeKey = project.stages.find((s) => s.status === 'GENERATED')?.stageKey ?? null;

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Link href="/" className="font-display text-xs text-inkMuted hover:text-ink">
        ← Semua project
      </Link>

      <div className="mt-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink">{project.name}</h1>
          <p className="mt-1 max-w-2xl text-sm text-inkMuted">{project.businessIdea}</p>
        </div>
        <span className="whitespace-nowrap rounded-full border border-panelBorder px-3 py-1 font-display text-[11px] text-inkMuted">
          {STATUS_TEXT[project.status]}
        </span>
      </div>

      <div className="mt-8 rounded-lg border border-panelBorder bg-panel p-6">
        <StationRail stages={project.stages} activeKey={activeKey} />
      </div>

      {error && <p className="mt-4 text-sm text-stop">{error}</p>}

      <div className="mt-8 space-y-3">
        {project.stages.map((stage) => (
          <StageCard
            key={stage.stageKey}
            stage={stage}
            deciding={decidingKey === stage.stageKey}
            onDecide={(decision, comment) => handleDecide(stage.stageKey, decision, comment)}
          />
        ))}
      </div>
    </main>
  );
}
