export const FRONTEND_MANIFEST_PROMPT_VERSION = 'frontend-manifest-v1';
export const FRONTEND_FILE_PROMPT_VERSION = 'frontend-file-generator-v1';
export const FRONTEND_REPAIR_PROMPT_VERSION = 'frontend-repair-v1';

const TECH_STACK = 'Next.js 14 (App Router), TypeScript, TailwindCSS, Radix UI, Recharts untuk chart.';

export const FRONTEND_MANIFEST_SYSTEM_PROMPT = `Anda adalah AI Frontend Developer di AI Software Factory.

Tugas Anda SEKARANG hanya membuat MANIFEST — daftar file frontend yang perlu
digenerate, BUKAN isi filenya. Stack: ${TECH_STACK}

ATURAN PALING PENTING (§18 Frontend Design Contract PRD V1.3): Anda TIDAK
BOLEH mendesain ulang UI secara bebas. UI/UX Design Specification yang
dilampirkan adalah KONTRAK WAJIB — bukan referensi/inspirasi.

Manifest HARUS mencakup:
- File config dasar: package.json (WAJIB ada script "build" yang jalankan
  "next build" sungguhan — validator akan jalankan npm run build asli),
  tsconfig.json, tailwind.config.ts, .env.example, app/layout.tsx.
- TEPAT SATU file page untuk SETIAP screen yang terdaftar di screens.yaml
  (path Next.js App Router mengikuti "route" di screens.yaml, mis. route
  "/projects/:id" -> app/projects/[id]/page.tsx). JANGAN skip satupun,
  JANGAN tambah screen yang tidak ada di screens.yaml.
- Satu file component untuk SETIAP component yang terdaftar di
  components.yaml (folder components/). JANGAN skip satupun.
- File client API (lib/api.ts atau serupa) yang memanggil Backend API
  Contract yang dilampirkan di bawah — endpoint yang dipanggil frontend
  HARUS benar-benar ada di Backend API Contract, jangan mengarang endpoint.
- Design token (warna, typography, spacing, dst dari design-system.yaml)
  WAJIB diterapkan lewat tailwind.config.ts / CSS variable, bukan hardcode
  warna sembarangan di tiap component.

ATURAN KETAT OUTPUT:
- Balas HANYA dengan satu JSON array valid, TIDAK ADA teks lain di luar JSON,
  TIDAK ADA markdown code fence.
- Setiap item: {"path": "app/...", "purpose": "deskripsi SANGAT singkat,
  maksimal 8 kata", "screenId": "id screen dari screens.yaml kalau file ini
  adalah page untuk screen tsb, kosongkan kalau bukan", "componentId": "id
  component dari components.yaml kalau file ini adalah component tsb,
  kosongkan kalau bukan", "dependsOn": ["path file lain yang isinya WAJIB
  dibaca — MAKSIMAL 3 path paling penting saja"]}
- URUTAN DI JSON: taruh package.json, tsconfig.json, tailwind.config.ts,
  app/layout.tsx DI PALING AWAL array — supaya kalau output ke-truncate,
  file wajib ini tetap aman. Urutan generate sebenarnya dari "dependsOn".
- JAGA TOTAL PANJANG OUTPUT — purpose sesingkat mungkin, dependsOn seminim
  mungkin, supaya SELURUH manifest selesai dalam satu response.`;

export function buildManifestUserPrompt(params: {
  projectName: string;
  prdContent: string;
  architectureContent: string;
  uiuxCombined: string;
  backendSummary: string;
  revisionNote?: string;
}): string {
  const sections = [
    `# Nama Project`,
    params.projectName,
    ``,
    `# PRD (sudah APPROVED)`,
    params.prdContent,
    ``,
    `# Architecture (sudah APPROVED)`,
    params.architectureContent,
    ``,
    `# UI/UX Design Specification (sudah APPROVED — KONTRAK WAJIB, lihat §18)`,
    params.uiuxCombined,
    ``,
    `# Backend API Contract (endpoint yang boleh dipanggil frontend)`,
    params.backendSummary,
  ];
  if (params.revisionNote) {
    sections.push(``, `# REVISION REQUESTED`, `Manifest sebelumnya perlu diperbaiki sesuai feedback berikut:`, params.revisionNote);
  }
  sections.push(``, `Hasilkan manifest sesuai instruksi system prompt.`);
  return sections.join('\n');
}

const OUTPUT_RULES = `ATURAN KETAT OUTPUT:
- Balas HANYA dengan isi mentah file ini, tidak ada markdown code fence,
  tidak ada penjelasan di luar isi file.
- Kalau file ini page untuk sebuah screen, WAJIB implementasikan SEMUA states
  yang didefinisikan screen tsb di screens.yaml (loading, empty, error,
  success, disabled, permission-denied) dan SEMUA actions yang terdaftar.
- Kode harus konsisten dengan file dependency yang dilampirkan (nama export,
  props, dst HARUS sama persis) dan dengan Backend API Contract (nama
  endpoint, method, request/response shape).
- Jangan pernah memotong output di tengah.`;

export function buildFileSystemPrompt(fileInfo: { path: string; purpose: string }): string {
  return `Anda adalah AI Frontend Developer di AI Software Factory. Stack: ${TECH_STACK}

Anda sedang generate SATU file dari manifest frontend, SATU PER PANGGILAN:
- Path: ${fileInfo.path}
- Tujuan file ini: ${fileInfo.purpose}

${OUTPUT_RULES}`;
}

export function buildFileUserPrompt(params: {
  prdContent: string;
  architectureContent: string;
  uiuxCombined: string;
  backendSummary: string;
  manifestOverview: string;
  dependencyFiles: { path: string; content: string }[];
}): string {
  const sections = [
    `# Manifest lengkap (referensi struktur project)`,
    params.manifestOverview,
    ``,
    `# PRD`,
    params.prdContent,
    ``,
    `# Architecture`,
    params.architectureContent,
    ``,
    `# UI/UX Design Specification (KONTRAK WAJIB)`,
    params.uiuxCombined,
    ``,
    `# Backend API Contract`,
    params.backendSummary,
  ];
  if (params.dependencyFiles.length > 0) {
    sections.push(``, `# File dependency (WAJIB konsisten dengan isi file ini)`);
    for (const dep of params.dependencyFiles) {
      sections.push(``, `### ${dep.path}`, dep.content);
    }
  }
  return sections.join('\n');
}

export function buildRepairSystemPrompt(fileInfo: { path: string }): string {
  return `Anda adalah AI Frontend Developer di AI Software Factory. Stack: ${TECH_STACK}

File "${fileInfo.path}" gagal compile/build. Perbaiki HANYA error yang
disebutkan di error log — jangan ubah behavior/struktur lain yang tidak error.

${OUTPUT_RULES}`;
}

export function buildRepairUserPrompt(params: { originalContent: string; errorLog: string }): string {
  return [
    `# Isi file saat ini (yang gagal compile/build)`,
    params.originalContent,
    ``,
    `# Error log`,
    params.errorLog,
    ``,
    `Perbaiki file ini supaya lolos compile/build.`,
  ].join('\n');
}
