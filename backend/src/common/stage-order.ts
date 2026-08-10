import { StageKey } from '@prisma/client';

/**
 * Fixed pipeline order, matching the n8n "AI Software Factory" workflow:
 * PRD -> Architecture -> UI/UX Design -> Estimation -> Database -> Backend
 * -> Frontend -> QA -> Package (V1.3 §8 — UI/UX Designer inserted as stage 3).
 * QA has no human approval gate (workflow continues automatically to Package Builder).
 * Package Builder DOES have an approval gate — workflow only completes after it.
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

export const STAGES_WITHOUT_APPROVAL: StageKey[] = [StageKey.QA];

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
