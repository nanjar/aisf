'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, getToken, clearToken, ApiError, type ProjectDetail, type StageKey } from '@/lib/api';
import { StationRail } from '@/components/StationRail';
import { StageCard } from '@/components/StageCard';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * §UX — sepanjang sesi debugging, project ID selalu perlu dicari manual dari
 * URL browser buat dipakai di query SQL/curl. Tampilkan langsung + klik buat
 * copy, biar troubleshooting lebih cepat.
 */
function ProjectIdBadge({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API bisa gagal (mis. context bukan HTTPS/localhost) — diamkan, tombolnya tetap tidak error ke user.
    }
  }

  return (
    <button
      onClick={handleCopy}
      title="Klik untuk copy Project ID"
      className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-panelBorder px-2 py-0.5 font-display text-[10px] text-inkMuted transition hover:border-track/50 hover:text-ink"
    >
      <span className="opacity-60">ID:</span>
      <span className="font-mono">{id}</span>
      {copied && <span className="text-go">✓ tersalin</span>}
    </button>
  );
}

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { t } = useI18n();
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
      setError(err instanceof ApiError ? err.message : t('error.loadProjectFailed'));
    }
  }, [params.id, router, t]);

  useEffect(() => {
    if (!getToken()) {
      router.push('/login');
      return;
    }
    load();
    const interval = setInterval(load, 6000);
    return () => clearInterval(interval);
  }, [load, router]);

  async function handleDecide(
    stageKey: StageKey,
    decision: 'approved' | 'rejected' | 'revision_requested',
    comment: string,
  ) {
    setDecidingKey(stageKey);
    setError(null);
    try {
      await api.decideStage(params.id, stageKey, decision, comment);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('error.decisionFailed'));
    } finally {
      setDecidingKey(null);
    }
  }

  if (!project) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-10">
        <p className="text-sm text-inkMuted">{error ?? t('projectDetail.loading')}</p>
      </main>
    );
  }

  const activeKey = project.stages.find((s) => s.status === 'GENERATED')?.stageKey ?? null;
  const projectDeadline = formatDate(project.deadlineAt);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Link href="/" className="font-display text-xs text-inkMuted hover:text-ink">
        {t('projectDetail.back')}
      </Link>

      <div className="mt-2 flex justify-end">
        <LanguageSwitcher />
      </div>

      <div className="mt-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink">{project.name}</h1>
          <p className="mt-1 max-w-2xl text-sm text-inkMuted">{project.businessIdea}</p>
          <ProjectIdBadge id={project.id} />
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="whitespace-nowrap rounded-full border border-panelBorder px-3 py-1 font-display text-[11px] text-inkMuted">
            {t(`projectStatus.${project.status}`)}
          </span>
          {projectDeadline && (
            <span className="font-display text-[11px] text-inkMuted">
              {t('team.projectDeadlineLabel')} {projectDeadline}
            </span>
          )}
        </div>
      </div>

      <div className="mt-8 rounded-lg border border-panelBorder bg-panel p-6">
        <StationRail stages={project.stages} activeKey={activeKey} />
      </div>

      {error && <p className="mt-4 text-sm text-stop">{error}</p>}

      <div className="mt-8 space-y-3">
        {project.stages.map((stage) => (
          <StageCard
            projectId={params.id}
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
