'use client';

import { useState } from 'react';
import type { ProjectStage } from '@/lib/api';

const STATUS_BADGE: Record<string, string> = {
  APPROVED: 'bg-go/15 text-go border-go/30',
  GENERATED: 'bg-signal/15 text-signal border-signal/30',
  REJECTED: 'bg-stop/15 text-stop border-stop/30',
  PENDING: 'bg-panel text-inkMuted border-panelBorder',
};

const STATUS_TEXT: Record<string, string> = {
  APPROVED: 'Disetujui',
  GENERATED: 'Menunggu keputusan',
  REJECTED: 'Ditolak',
  PENDING: 'Belum sampai giliran',
};

export function StageCard({
  stage,
  onDecide,
  deciding,
}: {
  stage: ProjectStage;
  onDecide: (decision: 'approved' | 'rejected', comment: string) => void;
  deciding: boolean;
}) {
  const [expanded, setExpanded] = useState(stage.status === 'GENERATED');
  const [comment, setComment] = useState('');

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
          {stage.status === 'GENERATED' && stage.stageKey === 'QA' ? 'Selesai digenerate' : STATUS_TEXT[stage.status]}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-panelBorder px-5 py-4">
          {stage.content ? (
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-floor p-4 font-display text-xs leading-relaxed text-inkMuted">
              {stage.content}
            </pre>
          ) : (
            <p className="font-display text-xs text-inkMuted">Belum ada artifact untuk tahap ini.</p>
          )}

          {stage.comment && (
            <p className="mt-3 text-sm text-inkMuted">
              <span className="text-ink">Catatan:</span> {stage.comment}
              {stage.decidedBy && <span className="text-inkMuted"> — {stage.decidedBy}</span>}
            </p>
          )}

          {stage.status === 'GENERATED' && stage.stageKey !== 'QA' && (
            <div className="mt-4 space-y-3">
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Catatan (opsional) — alasan approve/reject"
                rows={2}
                className="w-full rounded-md border border-panelBorder bg-floor p-3 text-sm text-ink placeholder:text-inkMuted focus:border-track focus:outline-none"
              />
              <div className="flex gap-3">
                <button
                  disabled={deciding}
                  onClick={() => onDecide('approved', comment)}
                  className="rounded-md bg-go px-4 py-2 text-sm font-medium text-floor transition hover:opacity-90 disabled:opacity-50"
                >
                  Setujui
                </button>
                <button
                  disabled={deciding}
                  onClick={() => onDecide('rejected', comment)}
                  className="rounded-md bg-stop px-4 py-2 text-sm font-medium text-floor transition hover:opacity-90 disabled:opacity-50"
                >
                  Tolak
                </button>
              </div>
            </div>
          )}

          {stage.status === 'GENERATED' && stage.stageKey === 'QA' && (
            <p className="mt-4 font-display text-xs text-inkMuted">
              Tahap ini tidak memerlukan approval — workflow akan otomatis menyelesaikan project setelah QA selesai digenerate.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
