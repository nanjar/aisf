'use client';

import { useState } from 'react';
import { api, ApiError, type ProjectStage } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';

const STATUS_BADGE: Record<string, string> = {
  APPROVED: 'bg-go/15 text-go border-go/30',
  GENERATED: 'bg-signal/15 text-signal border-signal/30',
  REJECTED: 'bg-stop/15 text-stop border-stop/30',
  REVISION_REQUESTED: 'bg-signal/15 text-signal border-signal/30',
  PENDING: 'bg-panel text-inkMuted border-panelBorder',
};

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function StageCard({
  projectId,
  stage,
  onDecide,
  deciding,
}: {
  projectId: string;
  stage: ProjectStage;
  onDecide: (decision: 'approved' | 'rejected' | 'revision_requested', comment: string) => void;
  deciding: boolean;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(stage.status === 'GENERATED');
  const [comment, setComment] = useState('');
  const [loadingS3, setLoadingS3] = useState(false);
  const [s3Error, setS3Error] = useState<string | null>(null);

  // Fix: QA sekarang punya approval gate juga, tidak lagi dikecualikan.
  const badgeText = t(`stageStatus.${stage.status}`);

  const canRequestRevision = comment.trim().length > 0;
  const stageDeadline = formatDate(stage.deadlineAt);

  async function handleViewFromS3() {
    setLoadingS3(true);
    setS3Error(null);
    try {
      const files = await api.listStageFiles(projectId, stage.stageKey);
      if (files.length === 0) {
        setS3Error(t('projectDetail.noS3File'));
        return;
      }
      const latest = files[0];
      const { url } = await api.getStageFileDownloadUrl(projectId, stage.stageKey, latest.id);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setS3Error(err instanceof ApiError ? err.message : t('error.serverError'));
    } finally {
      setLoadingS3(false);
    }
  }

  return (
    <div className="rounded-lg border border-panelBorder bg-panel">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
      >
        <div>
          <p className="font-display text-sm text-ink">{stage.label}</p>
          {stage.artifactName && (
            <p className="mt-0.5 font-display text-xs text-inkMuted">{stage.artifactName}</p>
          )}
        </div>
        <span className={`rounded-full border px-3 py-1 font-display text-[11px] ${STATUS_BADGE[stage.status]}`}>
          {badgeText}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-panelBorder px-5 py-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md bg-floor px-3 py-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="flex items-center gap-2">
                <span className="font-display text-[11px] uppercase tracking-widest text-inkMuted">
                  {t('projectDetail.approverLabel')}
                </span>
                <span className="text-sm text-ink">
                  {stage.assignedTo
                    ? `${stage.assignedTo.label}${stage.assignedTo.type === 'team' ? ` (${t('projectDetail.assignTeamGroup')})` : ''}`
                    : t('projectDetail.unassigned')}
                </span>
              </span>
              {stageDeadline && (
                <span className="flex items-center gap-2">
                  <span className="font-display text-[11px] uppercase tracking-widest text-inkMuted">
                    {t('team.stageDeadlineLabel')}
                  </span>
                  <span className="text-sm text-ink">{stageDeadline}</span>
                </span>
              )}
            </div>

            <button
              onClick={handleViewFromS3}
              disabled={loadingS3}
              className="rounded-md border border-panelBorder px-3 py-1.5 font-display text-[11px] text-inkMuted transition hover:border-track/50 hover:text-ink disabled:opacity-50"
            >
              {loadingS3 ? '…' : t('projectDetail.viewFromS3')}
            </button>
          </div>

          {s3Error && <p className="mb-3 text-xs text-stop">{s3Error}</p>}

          {stage.content ? (
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-floor p-4 font-display text-xs leading-relaxed text-inkMuted">
              {stage.content}
            </pre>
          ) : (
            <p className="font-display text-xs text-inkMuted">{t('projectDetail.noArtifact')}</p>
          )}

          {stage.comment && (
            <p className="mt-3 text-sm text-inkMuted">
              <span className="text-ink">{t('projectDetail.noteLabel')}</span> {stage.comment}
              {stage.decidedBy && <span className="text-inkMuted"> — {stage.decidedBy}</span>}
            </p>
          )}

          {stage.status === 'GENERATED' && (
            <div className="mt-4 space-y-3">
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={t('projectDetail.commentPlaceholder')}
                rows={2}
                className="w-full rounded-md border border-panelBorder bg-floor p-3 text-sm text-ink placeholder:text-inkMuted focus:border-track focus:outline-none"
              />
              <p className="font-display text-[11px] text-inkMuted">{t('projectDetail.revisionNeedsComment')}</p>
              <div className="flex flex-wrap gap-3">
                <button
                  disabled={deciding}
                  onClick={() => onDecide('approved', comment)}
                  className="rounded-md bg-go px-4 py-2 text-sm font-medium text-floor transition hover:opacity-90 disabled:opacity-50"
                >
                  {t('button.approve')}
                </button>
                <button
                  disabled={deciding || !canRequestRevision}
                  onClick={() => onDecide('revision_requested', comment)}
                  title={!canRequestRevision ? t('projectDetail.revisionNeedsComment') : undefined}
                  className="rounded-md bg-signal px-4 py-2 text-sm font-medium text-floor transition hover:opacity-90 disabled:opacity-50"
                >
                  {t('button.requestRevision')}
                </button>
                <button
                  disabled={deciding}
                  onClick={() => onDecide('rejected', comment)}
                  className="rounded-md bg-stop px-4 py-2 text-sm font-medium text-floor transition hover:opacity-90 disabled:opacity-50"
                >
                  {t('button.reject')}
                </button>
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
}
