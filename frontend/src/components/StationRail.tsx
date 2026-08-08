'use client';

import type { ProjectStage } from '@/lib/api';

const STATUS_STYLES: Record<string, { node: string; label: string }> = {
  APPROVED: { node: 'border-go bg-go text-floor', label: 'text-go' },
  GENERATED: { node: 'border-signal bg-signal text-floor animate-pulse', label: 'text-signal' },
  REJECTED: { node: 'border-stop bg-stop text-floor', label: 'text-stop' },
  PENDING: { node: 'border-panelBorder bg-panel text-inkMuted', label: 'text-inkMuted' },
};

// Note: stage.label comes from the backend (STAGE_LABELS in
// backend/src/common/stage-order.ts) and is a set of professional role
// titles ("Business Analyst — PRD", "QA Engineer", etc.) — these are kept
// language-agnostic by design, same as job titles wouldn't normally be
// translated. If that's not the intended behavior, STAGE_LABELS would need
// to move into the i18n dictionaries and be looked up by lang server-side.
export function StationRail({ stages, activeKey }: { stages: ProjectStage[]; activeKey?: string | null }) {
  return (
    <div className="w-full overflow-x-auto pb-2">
      <ol className="flex min-w-max items-start gap-0">
        {stages.map((stage, idx) => {
          const style = STATUS_STYLES[stage.status] ?? STATUS_STYLES.PENDING;
          const isActive = stage.stageKey === activeKey;
          return (
            <li key={stage.stageKey} className="flex items-start">
              <div className="flex flex-col items-center gap-2 px-3">
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-full border-2 font-display text-xs font-bold ${style.node} ${
                    isActive ? 'ring-2 ring-track ring-offset-2 ring-offset-floor' : ''
                  }`}
                >
                  {String(idx + 1).padStart(2, '0')}
                </div>
                <span className={`max-w-[8rem] text-center text-[11px] leading-tight ${style.label}`}>
                  {stage.label}
                </span>
              </div>
              {idx < stages.length - 1 && (
                <div
                  className={`mt-5 h-[2px] w-10 ${
                    stage.status === 'APPROVED' ? 'bg-go' : 'bg-panelBorder'
                  }`}
                />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
