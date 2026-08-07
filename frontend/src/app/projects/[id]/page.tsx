'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  api,
  getToken,
  clearToken,
  ApiError,
  triggerBlobDownload,
  type ProjectDetail,
  type StageKey,
} from '@/lib/api';
import { useI18n } from '@/lib/i18n';
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
  const { t } = useI18n();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [decidingKey, setDecidingKey] = useState<StageKey | null>(null);
  const [downloading, setDownloading] = useState(false);

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

  async function handleDownload() {
    setDownloading(true);
    setError(null);
    try {
      const blob = await api.downloadProject(params.id);
      triggerBlobDownload(blob, `project-${params.id}.zip`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal mengunduh project.');
    } finally {
      setDownloading(false);
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

  // V1.1: progress = proporsi tahap yang sudah APPROVED dari total tahap (PRD V1.1 4.4).
  const approvedCount = project.stages.filter((s) => s.status === 'APPROVED').length;
  const progressPct = project.stages.length
    ? Math.round((approvedCount / project.stages.length) * 100)
    : 0;

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
        <div className="flex items-center gap-3">
          <span className="whitespace-nowrap rounded-full border border-panelBorder px-3 py-1 font-display text-[11px] text-inkMuted">
            {STATUS_TEXT[project.status]}
          </span>
          {project.status === 'COMPLETED' && (
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="whitespace-nowrap rounded-md bg-go px-4 py-2 text-sm font-medium text-floor transition hover:opacity-90 disabled:opacity-50"
            >
              {downloading ? 'Menyiapkan…' : t('button.download')}
            </button>
          )}
        </div>
      </div>

      {/* V1.1: Better Workflow Visualization — bar persentase progres keseluruhan */}
      <div className="mt-6">
        <div className="flex items-center justify-between font-display text-[11px] text-inkMuted">
          <span>Progress</span>
          <span>{progressPct}%</span>
        </div>
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-panelBorder">
          <div
            className="h-full bg-track transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      <div className="mt-6 rounded-lg border border-panelBorder bg-panel p-6">
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
