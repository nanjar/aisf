export interface ManifestFileEntry {
  path: string;
  purpose: string;
  dependsOn: string[];
}

/**
 * Kalau LLM balikin JSON array yang kepotong di tengah (finish_reason=length),
 * JSON.parse gagal total padahal N-1 entry pertama sebenarnya valid. Fungsi
 * ini "selamatkan" entry yang lengkap sampai titik terakhir kurung kurawal
 * top-level yang benar-benar tertutup, buang sisa entry yang kepotong.
 * Postmortem uiux-designer-v1 (lihat prompts.ts) — pola yang sama kejadian
 * lagi di sini dengan manifest backend.
 */
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
      if (depth === 0) lastSafeEnd = i; // baru saja nutup 1 object top-level array
    }
  }

  if (lastSafeEnd === -1) return null;
  return raw.slice(start, lastSafeEnd + 1) + ']';
}

/** §Manifest — parse & sanity-check LLM manifest output. Tidak melempar exception,
 * balikin daftar error supaya caller bisa putuskan retry/fail dengan konteks jelas. */
export function parseManifest(raw: string): { entries: ManifestFileEntry[]; errors: string[]; wasTruncated: boolean } {
  const errors: string[] = [];
  let parsed: unknown;
  let wasTruncated = false;

  try {
    parsed = JSON.parse(raw);
  } catch {
    const repaired = repairTruncatedJsonArray(raw);
    if (!repaired) {
      return { entries: [], errors: [`Manifest bukan JSON valid dan tidak bisa diperbaiki`], wasTruncated: false };
    }
    try {
      parsed = JSON.parse(repaired);
      wasTruncated = true;
    } catch (err) {
      return { entries: [], errors: [`Manifest bukan JSON valid: ${(err as Error).message}`], wasTruncated: false };
    }
  }

  if (!Array.isArray(parsed)) {
    return { entries: [], errors: ['Manifest harus berupa JSON array'], wasTruncated };
  }
  if (parsed.length === 0) {
    return { entries: [], errors: ['Manifest kosong'], wasTruncated };
  }

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
      dependsOn: Array.isArray(obj.dependsOn) ? obj.dependsOn.filter((d): d is string => typeof d === 'string') : [],
    });
  }

  const requiredFiles = ['src/main.ts', 'src/app.module.ts', 'package.json'];
  for (const required of requiredFiles) {
    if (!seenPaths.has(required)) {
      errors.push(`Manifest kehilangan file wajib: ${required}${wasTruncated ? ' (kemungkinan ke-truncate)' : ''}`);
    }
  }

  // dependsOn harus merujuk ke path lain yang ADA di manifest (§ aturan prompt).
  // Kalau manifest ke-truncate, dependsOn yang nunjuk ke entry yang hilang cukup
  // di-drop (bukan error keras) — file itu sendiri masih valid digenerate.
  for (const entry of entries) {
    entry.dependsOn = entry.dependsOn.filter((dep) => {
      const exists = seenPaths.has(dep);
      if (!exists && !wasTruncated) {
        errors.push(`${entry.path} depends on "${dep}" yang tidak ada di manifest`);
      }
      return exists;
    });
  }

  return { entries, errors, wasTruncated };
}

/**
 * Urutan array manifest dari LLM TIDAK dijamin dependency-safe lagi sejak
 * v2 (config file sengaja ditaruh di awal array supaya selamat dari
 * truncation, bukan karena itu urutan generate yang benar). Fungsi ini
 * topological-sort ringan berdasarkan "dependsOn": file tanpa dependency
 * duluan, lalu file yang dependency-nya sudah 100% ter-resolve. Siklus atau
 * dependency yang tidak ke-resolve di-taruh di akhir apa adanya (best-effort,
 * bukan hard error — generation tetap jalan, cuma konteksnya mungkin kurang
 * lengkap untuk file itu).
 */
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
      const depsResolved = entry.dependsOn.every((d) => resolved.has(d) || !byPath.has(d));
      if (depsResolved) {
        ordered.push(entry);
        resolved.add(entry.path);
        remaining.splice(i, 1);
        progress = true;
      }
    }
  }
  // Sisa (siklus dependency) — tetap disertakan di akhir, bukan dibuang.
  ordered.push(...remaining);
  return ordered;
}

export interface FileValidationOutcome {
  passed: boolean;
  errors: string[];
}

/** Validasi FILE-level ringan — real syntax/compile check ada di COMPILE-level
 * (ValidationService, jalan di Docker terisolasi dengan npm install penuh). */
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
