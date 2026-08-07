import { StageKey } from '@prisma/client';

/**
 * Fixed pipeline order, matching the n8n "AI Software Factory" workflow:
 * PRD -> Architecture -> Estimation -> Database -> Backend -> Frontend -> QA -> Package.
 * QA has no human approval gate (workflow continues automatically to Package Builder).
 * Package Builder DOES have an approval gate — workflow only completes after it.
 */
export const STAGE_ORDER: StageKey[] = [
  StageKey.PRD,
  StageKey.ARCHITECTURE,
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
  ESTIMATION: 'Project Estimator',
  DATABASE: 'Database Architect',
  BACKEND: 'Backend Developer',
  FRONTEND: 'Frontend Developer',
  QA: 'QA Engineer',
  PACKAGE: 'Package Builder',
};
