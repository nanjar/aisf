export const BACKEND_MANIFEST_PROMPT_VERSION = 'backend-manifest-v2'; // v2: truncation-resistant (config file di awal, output lebih ringkas)
export const BACKEND_FILE_PROMPT_VERSION = 'backend-file-generator-v1';
export const BACKEND_REPAIR_PROMPT_VERSION = 'backend-repair-v1';

const TECH_STACK =
  'NestJS, TypeScript, Prisma ORM, PostgreSQL, Redis, RabbitMQ, MinIO/S3-compatible object storage. ' +
  'Clean Architecture / Domain-Driven Design (module per domain, controller -> service -> repository/Prisma).';

export const BACKEND_MANIFEST_SYSTEM_PROMPT = `Anda adalah AI Backend Developer di AI Software Factory.

Tugas Anda SEKARANG hanya membuat MANIFEST — daftar file backend yang perlu
digenerate, BUKAN isi filenya. Stack: ${TECH_STACK}

Manifest HARUS mencakup:
- Semua file config dasar: package.json, tsconfig.json, .env.example, src/main.ts, src/app.module.ts
- package.json WAJIB punya script "build" yang menghasilkan folder dist/ (mis.
  "nest build" atau "tsc -p tsconfig.build.json") — validator akan menjalankan
  "npm run build" sungguhan, generation GAGAL kalau script ini tidak ada atau
  tidak benar-benar berhasil compile.
- 1 module NestJS per domain sesuai Architecture (controller, service, module,
  DTO per domain) — cukup untuk MENDUKUNG SEMUA endpoint yang tersirat dari
  "actions" di setiap screen pada UI/UX Design Specification. Jangan sampai
  ada action UI yang tidak punya endpoint pendukung.
- Skema harus konsisten dengan Database Design yang sudah disetujui.

ATURAN KETAT OUTPUT:
- Balas HANYA dengan satu JSON array valid, TIDAK ADA teks lain di luar JSON,
  TIDAK ADA markdown code fence.
- Setiap item: {"path": "src/...", "purpose": "deskripsi SANGAT singkat,
  maksimal 8 kata", "dependsOn": ["path file lain yang isinya WAJIB dibaca
  untuk generate file ini dengan benar — MAKSIMAL 3 path paling penting saja,
  jangan daftar semua"]}
- URUTAN DI JSON: taruh package.json, tsconfig.json, .env.example, src/main.ts,
  src/app.module.ts DI PALING AWAL array (bukan di akhir) — supaya kalau
  output ke-truncate karena kepanjangan, file wajib ini tetap aman ter-include.
  Urutan generate sebenarnya (dependency order) ditentukan dari "dependsOn",
  BUKAN dari urutan array ini.
- "dependsOn" HANYA boleh berisi path yang JUGA ada di manifest ini (bukan
  path eksternal/library).
- JAGA TOTAL PANJANG OUTPUT — kalau project punya banyak domain, gunakan
  "purpose" sesingkat mungkin dan "dependsOn" seminim mungkin, supaya SELURUH
  manifest selesai dalam satu response, bukan kepotong di tengah.
- Jangan sertakan Dockerfile atau docker-compose.yml — itu ditangani Package
  Builder secara terpisah.`;

export function buildManifestUserPrompt(params: {
  projectName: string;
  prdContent: string;
  architectureContent: string;
  databaseContent: string;
  uiuxCombined: string;
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
    `# Database Design (sudah APPROVED)`,
    params.databaseContent,
    ``,
    `# UI/UX Design Specification (sudah APPROVED — sumber "actions" yang butuh endpoint)`,
    params.uiuxCombined,
  ];
  if (params.revisionNote) {
    sections.push(
      ``,
      `# REVISION REQUESTED`,
      `Manifest sebelumnya perlu diperbaiki sesuai feedback berikut:`,
      params.revisionNote,
    );
  }
  sections.push(``, `Hasilkan manifest sesuai instruksi system prompt.`);
  return sections.join('\n');
}

const OUTPUT_RULES = `ATURAN KETAT OUTPUT:
- Balas HANYA dengan isi mentah file ini, tidak ada markdown code fence,
  tidak ada penjelasan di luar isi file.
- Kode harus konsisten dengan file-file dependency yang dilampirkan di bawah
  (nama export, signature method, nama field DTO, dst HARUS sama persis).
- Jangan pernah memotong output di tengah.`;

export function buildFileSystemPrompt(fileInfo: { path: string; purpose: string }): string {
  const packageJsonHint =
    fileInfo.path === 'package.json'
      ? `\nPENTING soal dependency: HANYA gunakan nama package npm yang BENAR-BENAR
ADA dan yakin benar (mis. "@nestjs/common", "@nestjs/core", "@nestjs/config",
"@prisma/client", "class-validator", "class-transformer", "ioredis",
"@nestjs-modules/ioredis", "amqplib", "bcrypt", dst — package populer dan
umum dipakai). JANGAN mengarang nama package yang terdengar masuk akal tapi
tidak yakin ada (mis. "nestjs-ioredis" BUKAN package asli — yang benar
"ioredis" langsung atau "@nestjs-modules/ioredis"). Kalau ragu apakah
sebuah package benar-benar ada di npm, JANGAN pakai — cari alternatif yang
sudah pasti familiar.\n`
      : '';

  return `Anda adalah AI Backend Developer di AI Software Factory. Stack: ${TECH_STACK}

Anda sedang generate SATU file dari manifest backend, SATU PER PANGGILAN:
- Path: ${fileInfo.path}
- Tujuan file ini: ${fileInfo.purpose}
${packageJsonHint}
${OUTPUT_RULES}`;
}

export function buildFileUserPrompt(params: {
  prdContent: string;
  architectureContent: string;
  databaseContent: string;
  uiuxCombined: string;
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
    `# Database Design`,
    params.databaseContent,
    ``,
    `# UI/UX Design Specification`,
    params.uiuxCombined,
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
  const packageJsonHint =
    fileInfo.path === 'package.json'
      ? `\nKalau error-nya "No matching version found" / "notarget" / "E404" untuk
sebuah package: package itu KEMUNGKINAN BESAR TIDAK ADA di npm registry
(nama hasil karangan). JANGAN coba versi lain dari package yang sama —
GANTI ke package NYATA yang benar-benar ada di npm untuk kebutuhan yang
sama (mis. untuk Redis di NestJS pakai "ioredis" langsung atau
"@nestjs-modules/ioredis", BUKAN "nestjs-ioredis"). Kalau tidak yakin
package mana yang benar ada, HAPUS dependency itu daripada menebak nama
yang mungkin juga tidak ada.\n`
      : '';

  return `Anda adalah AI Backend Developer di AI Software Factory. Stack: ${TECH_STACK}

File "${fileInfo.path}" gagal compile. Perbaiki HANYA error yang disebutkan
di error log — jangan ubah behavior/struktur lain yang tidak error.
${packageJsonHint}
${OUTPUT_RULES}`;
}

export function buildRepairUserPrompt(params: {
  originalContent: string;
  errorLog: string;
}): string {
  return [
    `# Isi file saat ini (yang gagal compile)`,
    params.originalContent,
    ``,
    `# Error log dari tsc --noEmit`,
    params.errorLog,
    ``,
    `Perbaiki file ini supaya lolos compile.`,
  ].join('\n');
}
