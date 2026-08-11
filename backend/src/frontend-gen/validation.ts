import * as yaml from 'js-yaml';

export interface ManifestFileEntry {
  path: string;
  purpose: string;
  screenId: string | null;
  componentId: string | null;
  dependsOn: string[];
}

function repairTruncatedJsonArray(raw: string): string | null {
  const start = raw.indexOf('[');
  if (start === -1) return null;
  let depth = 0;
  let lastSafeEnd = -1;
  let inString = false;
  let escape = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) lastSafeEnd = i;
    }
  }
  if (lastSafeEnd === -1) return null;
  return raw.slice(start, lastSafeEnd + 1) + ']';
}

/** Sama pola dengan backend-gen — lihat postmortem uiux-designer-v1/backend-manifest-v1. */
export function parseManifest(raw: string): { entries: ManifestFileEntry[]; errors: string[]; wasTruncated: boolean } {
  const errors: string[] = [];
  let parsed: unknown;
  let wasTruncated = false;

  try {
    parsed = JSON.parse(raw);
  } catch {
    const repaired = repairTruncatedJsonArray(raw);
    if (!repaired) return { entries: [], errors: ['Manifest bukan JSON valid dan tidak bisa diperbaiki'], wasTruncated: false };
    try {
      parsed = JSON.parse(repaired);
      wasTruncated = true;
    } catch (err) {
      return { entries: [], errors: [`Manifest bukan JSON valid: ${(err as Error).message}`], wasTruncated: false };
    }
  }

  if (!Array.isArray(parsed)) return { entries: [], errors: ['Manifest harus berupa JSON array'], wasTruncated };
  if (parsed.length === 0) return { entries: [], errors: ['Manifest kosong'], wasTruncated };

  const entries: ManifestFileEntry[] = [];
  const seenPaths = new Set<string>();
  for (const [i, item] of parsed.entries()) {
    const obj = item as Record<string, unknown>;
    if (typeof obj?.path !== 'string' || !obj.path.trim()) {
      errors.push(`Manifest[${i}] tidak punya "path" yang valid`);
      continue;
    }
    if (seenPaths.has(obj.path)) {
      errors.push(`Manifest punya duplikat path: ${obj.path}`);
      continue;
    }
    seenPaths.add(obj.path);
    entries.push({
      path: obj.path,
      purpose: typeof obj.purpose === 'string' ? obj.purpose : '',
      screenId: typeof obj.screenId === 'string' && obj.screenId.trim() ? obj.screenId : null,
      componentId: typeof obj.componentId === 'string' && obj.componentId.trim() ? obj.componentId : null,
      dependsOn: Array.isArray(obj.dependsOn) ? obj.dependsOn.filter((d): d is string => typeof d === 'string') : [],
    });
  }

  const requiredFiles = ['package.json', 'tsconfig.json', 'app/layout.tsx'];
  for (const required of requiredFiles) {
    if (!seenPaths.has(required)) {
      errors.push(`Manifest kehilangan file wajib: ${required}${wasTruncated ? ' (kemungkinan ke-truncate)' : ''}`);
    }
  }

  for (const entry of entries) {
    entry.dependsOn = entry.dependsOn.filter((dep) => {
      const exists = seenPaths.has(dep);
      if (!exists && !wasTruncated) errors.push(`${entry.path} depends on "${dep}" yang tidak ada di manifest`);
      return exists;
    });
  }

  return { entries, errors, wasTruncated };
}

export function reorderByDependencies(entries: ManifestFileEntry[]): ManifestFileEntry[] {
  const byPath = new Map(entries.map((e) => [e.path, e]));
  const resolved = new Set<string>();
  const ordered: ManifestFileEntry[] = [];
  const remaining = [...entries];
  let progress = true;
  while (remaining.length > 0 && progress) {
    progress = false;
    for (let i = remaining.length - 1; i >= 0; i--) {
      const entry = remaining[i];
      if (entry.dependsOn.every((d) => resolved.has(d) || !byPath.has(d))) {
        ordered.push(entry);
        resolved.add(entry.path);
        remaining.splice(i, 1);
        progress = true;
      }
    }
  }
  ordered.push(...remaining);
  return ordered;
}

export interface FileValidationOutcome {
  passed: boolean;
  errors: string[];
}

export function validateFileContent(path: string, content: string): FileValidationOutcome {
  const errors: string[] = [];
  if (content.trim().length === 0) {
    errors.push('File kosong');
    return { passed: false, errors };
  }
  if (path.endsWith('.json')) {
    try {
      JSON.parse(content);
    } catch (err) {
      errors.push(`JSON tidak valid: ${(err as Error).message}`);
    }
  }
  return { passed: errors.length === 0, errors };
}

/** Ambil isi 1 section (mis. "screens.yaml") dari teks gabungan UiuxService.getContentForFrontend(). */
function extractUiuxSection(combined: string, fileName: string): string | null {
  const sections = combined.split('\n\n---\n\n');
  const match = sections.find((s) => s.trimStart().startsWith(`### ${fileName}`));
  if (!match) return null;
  return match.replace(new RegExp(`^### ${fileName}\\n\\n`), '');
}

function extractIds(yamlContent: string, listKey: string): string[] {
  try {
    const parsed = yaml.load(yamlContent) as Record<string, unknown>;
    const list = Array.isArray(parsed?.[listKey]) ? parsed[listKey] : Array.isArray(parsed) ? parsed : [];
    return (list as unknown[])
      .map((item) => (item && typeof item === 'object' ? (item as Record<string, unknown>).id : null))
      .filter((id): id is string => typeof id === 'string');
  } catch {
    return [];
  }
}

export interface CoverageResult {
  totalScreens: number;
  coveredScreens: number;
  missingScreens: string[];
  totalComponents: number;
  coveredComponents: number;
  missingComponents: string[];
  coveragePercent: number;
}

/**
 * §48 UI/UX Implementation Validation — Screen Coverage & Component Coverage.
 * Best-effort: cocokkan id di screens.yaml/components.yaml terhadap
 * screenId/componentId yang LLM tandai sendiri di manifest saat generate
 * (bukan AST-parsing kode React sungguhan — itu jauh lebih berat, ini
 * pendekatan pragmatis yang tetap menegakkan §18 kontrak UI/UX).
 */
export function checkUiuxCoverage(entries: ManifestFileEntry[], uiuxCombined: string): CoverageResult {
  const screensYaml = extractUiuxSection(uiuxCombined, 'screens.yaml') ?? '';
  const componentsYaml = extractUiuxSection(uiuxCombined, 'components.yaml') ?? '';

  const screenIds = extractIds(screensYaml, 'screens');
  const componentIds = extractIds(componentsYaml, 'components');

  const coveredScreenIds = new Set(entries.map((e) => e.screenId).filter((id): id is string => !!id));
  const coveredComponentIds = new Set(entries.map((e) => e.componentId).filter((id): id is string => !!id));

  const missingScreens = screenIds.filter((id) => !coveredScreenIds.has(id));
  const missingComponents = componentIds.filter((id) => !coveredComponentIds.has(id));

  const total = screenIds.length + componentIds.length;
  const covered = screenIds.length - missingScreens.length + (componentIds.length - missingComponents.length);

  return {
    totalScreens: screenIds.length,
    coveredScreens: screenIds.length - missingScreens.length,
    missingScreens,
    totalComponents: componentIds.length,
    coveredComponents: componentIds.length - missingComponents.length,
    missingComponents,
    coveragePercent: total > 0 ? Math.round((covered / total) * 100) : 100,
  };
}
