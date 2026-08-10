import { StageKey } from '@prisma/client';

/**
 * Fixed pipeline order, matching the n8n "AI Software Factory" workflow:
 * PRD -> Architecture -> UI/UX Design -> Estimation -> Database -> Backend
 * -> Frontend -> QA -> Package (V1.3 §8 — UI/UX Designer inserted as stage 3).
 * Every stage including QA now has a human approval gate (see
 * STAGES_WITHOUT_APPROVAL below — kept empty on purpose for symmetry).
 */
export const STAGE_ORDER: StageKey[] = [
  StageKey.PRD,
  StageKey.ARCHITECTURE,
  StageKey.UIUX,
  StageKey.ESTIMATION,
  StageKey.DATABASE,
  StageKey.BACKEND,
  StageKey.FRONTEND,
  StageKey.QA,
  StageKey.PACKAGE,
];

/**
 * Fix: QA sekarang punya approval gate juga (STAGES_WITHOUT_APPROVAL kosong).
 * Semula QA dikecualikan by design (auto-proceed ke Package Builder tanpa
 * approval manusia) — diubah atas permintaan user karena terasa janggal di
 * UI (QA "Generation complete" dan Package Builder "Awaiting decision"
 * muncul bersamaan tanpa jeda approval QA yang jelas).
 */
export const STAGES_WITHOUT_APPROVAL: StageKey[] = [];

export const STAGE_LABELS: Record<StageKey, string> = {
  PRD: 'Business Analyst — PRD',
  ARCHITECTURE: 'Software Architect',
  UIUX: 'UI/UX Designer',
  ESTIMATION: 'Project Estimator',
  DATABASE: 'Database Architect',
  BACKEND: 'Backend Developer',
  FRONTEND: 'Frontend Developer',
  QA: 'QA Engineer',
  PACKAGE: 'Package Builder',
};
