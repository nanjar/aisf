import { StageKey } from '@prisma/client';

/**
 * Fixed pipeline order, matching the n8n "AI Software Factory" workflow:
 * PRD -> Architecture -> Estimation -> Database -> Backend -> Frontend -> QA.
 * QA has no human approval gate (workflow completes right after it).
 */
export const STAGE_ORDER: StageKey[] = [
  StageKey.PRD,
  StageKey.ARCHITECTURE,
  StageKey.ESTIMATION,
  StageKey.DATABASE,
  StageKey.BACKEND,
  StageKey.FRONTEND,
  StageKey.QA,
];

export const STAGES_WITHOUT_APPROVAL: StageKey[] = [StageKey.QA];

export const STAGE_LABELS: Record<StageKey, string> = {
  PRD: 'Business Analyst — PRD',
  ARCHITECTURE: 'Software Architect',
  ESTIMATION: 'Project Estimator',
  DATABASE: 'Database Architect',
  BACKEND: 'Backend Developer',
  FRONTEND: 'Frontend Developer',
  QA: 'QA Engineer',
};
