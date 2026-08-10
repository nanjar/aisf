export interface ManifestFileEntry {
  path: string;
  purpose: string;
  dependsOn: string[];
}

/** §Manifest — parse & sanity-check LLM manifest output. Tidak melempar exception,
 * balikin daftar error supaya caller bisa putuskan retry/fail dengan konteks jelas. */
export function parseManifest(raw: string): { entries: ManifestFileEntry[]; errors: string[] } {
  const errors: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { entries: [], errors: [`Manifest bukan JSON valid: ${(err as Error).message}`] };
  }

  if (!Array.isArray(parsed)) {
    return { entries: [], errors: ['Manifest harus berupa JSON array'] };
  }
  if (parsed.length === 0) {
    return { entries: [], errors: ['Manifest kosong'] };
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
      errors.push(`Manifest kehilangan file wajib: ${required}`);
    }
  }

  // dependsOn harus merujuk ke path lain yang ADA di manifest (§ aturan prompt).
  for (const entry of entries) {
    for (const dep of entry.dependsOn) {
      if (!seenPaths.has(dep)) {
        errors.push(`${entry.path} depends on "${dep}" yang tidak ada di manifest`);
      }
    }
  }

  return { entries, errors };
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
