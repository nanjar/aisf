import * as yaml from 'js-yaml';

export interface FileValidationOutcome {
  fileName: string;
  passed: boolean;
  errors: string[];
}

const REQUIRED_FILES = [
  'design-spec.yaml',
  'screens.yaml',
  'user-flows.yaml',
  'components.yaml',
  'design-system.yaml',
  'navigation.yaml',
  'accessibility.md',
] as const;

const DESIGN_SYSTEM_REQUIRED_KEYS = [
  'colors',
  'typography',
  'spacing',
  'borderRadius',
  'shadows',
  'breakpoints',
  'buttons',
  'inputs',
  'cards',
  'tables',
  'badges',
  'alerts',
  'modal',
  'navigation',
];

/** §19 Structure — pastikan LLM balikin persis 7 key yang diminta, tidak kurang tidak lebih. */
export function validateFileSet(files: Record<string, unknown>): string[] {
  const errors: string[] = [];
  for (const required of REQUIRED_FILES) {
    if (!(required in files)) errors.push(`File wajib "${required}" tidak ada di output LLM`);
  }
  for (const key of Object.keys(files)) {
    if (!REQUIRED_FILES.includes(key as (typeof REQUIRED_FILES)[number])) {
      errors.push(`File "${key}" tidak dikenal — di luar 7 file yang diminta`);
    }
  }
  return errors;
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** §19 Structure/Consistency/Accessibility — validasi per file. */
export function validateSingleFile(fileName: string, content: string): FileValidationOutcome {
  const errors: string[] = [];

  if (fileName === 'accessibility.md') {
    if (content.trim().length < 50) {
      errors.push('accessibility.md terlalu pendek untuk memuat requirement label/contrast/keyboard');
    }
    return { fileName, passed: errors.length === 0, errors };
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(content);
  } catch (err) {
    return { fileName, passed: false, errors: [`YAML tidak valid: ${(err as Error).message}`] };
  }

  if (parsed === null || parsed === undefined) {
    return { fileName, passed: false, errors: ['File kosong setelah di-parse'] };
  }

  switch (fileName) {
    case 'design-spec.yaml': {
      const doc = asRecord(parsed);
      for (const key of ['product', 'design', 'navigation', 'screens', 'components']) {
        if (!(key in doc)) errors.push(`design-spec.yaml kehilangan field "${key}"`);
      }
      break;
    }
    case 'screens.yaml': {
      const doc = asRecord(parsed);
      const screens = asArray(doc.screens ?? parsed);
      if (screens.length === 0) errors.push('screens.yaml tidak berisi satupun screen');
      for (const [i, screen] of screens.entries()) {
        const s = asRecord(screen);
        for (const key of ['id', 'name', 'route', 'purpose', 'userRoles', 'layout', 'components', 'states', 'responsive', 'actions']) {
          if (!(key in s)) errors.push(`screens.yaml[${i}] kehilangan field "${key}"`);
        }
      }
      break;
    }
    case 'user-flows.yaml': {
      const doc = asRecord(parsed);
      const flows = asArray(doc.flows ?? parsed);
      if (flows.length === 0) errors.push('user-flows.yaml tidak berisi satupun flow');
      break;
    }
    case 'components.yaml': {
      const doc = asRecord(parsed);
      const components = asArray(doc.components ?? parsed);
      if (components.length === 0) errors.push('components.yaml tidak berisi satupun component');
      for (const [i, comp] of components.entries()) {
        const c = asRecord(comp);
        for (const key of ['id', 'name', 'purpose', 'props', 'states', 'variants', 'responsive', 'accessibility']) {
          if (!(key in c)) errors.push(`components.yaml[${i}] kehilangan field "${key}"`);
        }
      }
      break;
    }
    case 'design-system.yaml': {
      const doc = asRecord(parsed);
      for (const key of DESIGN_SYSTEM_REQUIRED_KEYS) {
        if (!(key in doc)) errors.push(`design-system.yaml kehilangan field "${key}"`);
      }
      break;
    }
    case 'navigation.yaml': {
      const doc = asRecord(parsed);
      if (Object.keys(doc).length === 0) errors.push('navigation.yaml kosong');
      break;
    }
    default:
      break;
  }

  return { fileName, passed: errors.length === 0, errors };
}
