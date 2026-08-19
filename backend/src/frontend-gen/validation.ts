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

  // Fix sama dengan backend-gen/validation.ts — lihat komentar di sana.
  if (!Array.isArray(parsed) && parsed && typeof parsed === 'object') {
    const values = Object.values(parsed as Record<string, unknown>);
    const firstArray = values.find((v) => Array.isArray(v));
    if (firstArray) parsed = firstArray;
  }
  if (!Array.isArray(parsed)) return { entries: [], errors: ['Manifest harus berupa JSON array'], wasTruncated };
  if (parsed.length === 0) return { entries: [], errors: ['Manifest kosong'], wasTruncated };

  const entries: ManifestFileEntry[] = [];
  // Fix kritikal (postmortem: tsc TS1149 "File name differs from already
  // included file name only in casing" — manifest generate DUA file
  // terpisah untuk component yang sama, mis. "components/Card.tsx" DAN
  // "components/card.tsx", cuma beda huruf besar/kecil. Linux/git
  // menganggap itu 2 file BEDA, tapi tsc/bundler bingung dan tsc langsung
  // error fatal begitu ada import yang merujuk casing berbeda-beda ke
  // "file yang sama secara konsep". Deteksi duplikat sekarang CASE-
  // INSENSITIVE — anggap "Card.tsx" dan "card.tsx" itu path yang SAMA,
  // simpan cuma yang PERTAMA muncul, exact casing-nya).
  const seenPaths = new Set<string>(); // exact-case, buat isi entries.path
  const seenPathsLower = new Map<string, string>(); // lowercase -> exact-case pertama yang dipakai
  for (const [i, item] of parsed.entries()) {
    const obj = item as Record<string, unknown>;
    if (typeof obj?.path !== 'string' || !obj.path.trim()) {
      errors.push(`Manifest[${i}] tidak punya "path" yang valid`);
      continue;
    }
    const pathLower = obj.path.toLowerCase();
    if (seenPathsLower.has(pathLower)) {
      // Duplikat (persis atau cuma beda casing) — entry pertama tetap
      // dipakai, tidak perlu jadi error fatal.
      continue;
    }
    seenPathsLower.set(pathLower, obj.path);
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
    if (!seenPathsLower.has(required.toLowerCase())) {
      errors.push(`Manifest kehilangan file wajib: ${required}${wasTruncated ? ' (kemungkinan ke-truncate)' : ''}`);
    }
  }

  // Fix kritikal (postmortem: 29 "X depends on Y yang tidak ada di manifest"
  // dianggap error FATAL, menggagalkan SELURUH manifest yang sebenarnya
  // valid). LLM sering referensikan component (mis. SelectField.tsx,
  // RequestCard.tsx) sebagai dependsOn tanpa bikin entry manifest terpisah
  // untuk component itu — ini WAJAR dan TIDAK FATAL: dependsOn cuma dipakai
  // buat kasih context tambahan waktu generate (lihat
  // frontend-gen.service.ts, fileContents.has(p) check), bukan referensi
  // yang wajib ada. Cukup filter diam-diam, jangan gagalkan manifest.
  // Resolusi dependsOn JUGA case-insensitive, samakan dengan path
  // kanonis-nya (exact-case pertama yang dipakai) — supaya dependsOn yang
  // sebut casing berbeda dari entry aslinya tetap ke-resolve dengan benar.
  for (const entry of entries) {
    entry.dependsOn = entry.dependsOn
      .map((dep) => seenPathsLower.get(dep.toLowerCase()))
      .filter((dep): dep is string => dep !== undefined);
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

/** Fix (postmortem coverage self-tagging tidak reliable) — ambil {id, route} sekaligus buat screens, dipakai inferensi path. */
function extractScreenRoutes(yamlContent: string): { id: string; route: string }[] {
  try {
    const parsed = yaml.load(yamlContent) as Record<string, unknown>;
    const list = Array.isArray(parsed?.screens) ? parsed.screens : Array.isArray(parsed) ? parsed : [];
    return (list as unknown[])
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const obj = item as Record<string, unknown>;
        const id = typeof obj.id === 'string' ? obj.id : null;
        const route = typeof obj.route === 'string' ? obj.route : null;
        return id && route ? { id, route } : null;
      })
      .filter((x): x is { id: string; route: string } => x !== null);
  } catch {
    return [];
  }
}

/** Route Next.js App Router ("/projects/:id" atau "/projects/[id]") -> path page.tsx yang diharapkan. */
function routeToExpectedPagePath(route: string): string {
  const segments = route
    .split('/')
    .filter(Boolean)
    .map((seg) => (seg.startsWith(':') ? `[${seg.slice(1)}]` : seg)); // dukung dua gaya penulisan route
  return segments.length > 0 ? `app/${segments.join('/')}/page.tsx` : 'app/page.tsx';
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
 *
 * Fix kritikal (postmortem: self-tagging screenId/componentId oleh LLM
 * TIDAK RELIABLE — kadang 63%, kadang jatuh ke 7% untuk manifest yang
 * SEBENARNYA lengkap filenya, tergantung provider/model/keberuntungan
 * saat itu). Sekarang PAKAI DUA LAPIS deteksi:
 *   1. Self-tagging LLM (screenId/componentId di manifest) — tetap prioritas
 *      utama kalau LLM benar mengisinya.
 *   2. INFERENSI DARI PATH — kalau self-tagging kosong, coba cocokkan:
 *      - Screen: path file (mis. "app/admin/dashboard/page.tsx") terhadap
 *        "route" di screens.yaml (mis. "/admin/dashboard") pakai konversi
 *        App Router standar.
 *      - Component: nama file di folder components/ (mis. "Button.tsx")
 *        dicocokkan case-insensitive terhadap id di components.yaml
 *        (mis. "button").
 * Ini jauh lebih robust — tidak bergantung LLM "ingat" isi tag, cukup file
 * fisiknya benar-benar ada di tempat yang benar.
 */
export function checkUiuxCoverage(entries: ManifestFileEntry[], uiuxCombined: string): CoverageResult {
  const screensYaml = extractUiuxSection(uiuxCombined, 'screens.yaml') ?? '';
  const componentsYaml = extractUiuxSection(uiuxCombined, 'components.yaml') ?? '';

  const screenIds = extractIds(screensYaml, 'screens');
  const componentIds = extractIds(componentsYaml, 'components');
  const screenRoutes = extractScreenRoutes(screensYaml);

  // Lapis 1: self-tagging LLM.
  const coveredScreenIds = new Set(entries.map((e) => e.screenId).filter((id): id is string => !!id));
  const coveredComponentIds = new Set(entries.map((e) => e.componentId).filter((id): id is string => !!id));

  // Lapis 2: inferensi path — hanya proses screen/component yang BELUM ke-cover lewat self-tagging.
  const entryPathsLower = new Set(entries.map((e) => e.path.toLowerCase()));
  for (const { id, route } of screenRoutes) {
    if (coveredScreenIds.has(id)) continue;
    const expectedPath = routeToExpectedPagePath(route).toLowerCase();
    if (entryPathsLower.has(expectedPath)) coveredScreenIds.add(id);
  }
  for (const entry of entries) {
    const match = entry.path.match(/(?:^|\/)components\/([^/]+)\.tsx?$/i);
    if (!match) continue;
    const fileStem = match[1].toLowerCase();
    const matchingId = componentIds.find((id) => id.toLowerCase() === fileStem);
    if (matchingId) coveredComponentIds.add(matchingId);
  }

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
