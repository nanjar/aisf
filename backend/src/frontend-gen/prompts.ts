export const FRONTEND_MANIFEST_PROMPT_VERSION = 'frontend-manifest-v4';
export const FRONTEND_FILE_PROMPT_VERSION = 'frontend-file-generator-v5';
export const FRONTEND_REPAIR_PROMPT_VERSION = 'frontend-repair-v5';

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
- lib/utils.ts — WAJIB ada di manifest secara eksplisit (jangan biarkan
  dirujuk implisit tanpa entry manifest), berisi HANYA fungsi util kecil
  seperti "cn()" untuk gabung className Tailwind. Lihat instruksi detail
  di file-generation-nya nanti.
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

WAJIB — TAGGING "screenId" DAN "componentId" (postmortem: dari 100+ file
manifest, "screenId" HAMPIR SELALU diisi dengan benar, tapi "componentId"
NYARIS SELALU DIKOSONGKAN walau file component-nya benar-benar dibuat —
ini BUKAN opsional, ini WAJIB, dicek otomatis oleh sistem):
- SETIAP file yang path-nya ada di folder components/ DAN namanya cocok
  (mengabaikan besar/kecil huruf) dengan salah satu "id" di components.yaml
  yang dilampirkan, WAJIB isi field "componentId" dengan id tsb PERSIS
  seperti yang tertulis di components.yaml. JANGAN dikosongkan.
- Contoh: kalau components.yaml punya entry {"id": "button", ...} dan Anda
  bikin file "components/Button.tsx", field componentId file itu WAJIB
  "button" — BUKAN string kosong, BUKAN "Button", HARUS PERSIS "button"
  (case-sensitive, samakan dengan id di components.yaml).
- Sebelum selesai, cek ulang: apakah SEMUA id di components.yaml sudah
  muncul sebagai componentId di SALAH SATU entry manifest? Kalau ada yang
  belum, itu artinya Anda lupa tag file yang bersangkutan — perbaiki.

WAJIB — DEPENDENCY NPM YANG BENAR-BENAR DIPAKAI (postmortem: banyak file
component pakai import seperti "react-hook-form", "@hookform/resolvers/zod",
"next-auth/react", "sonner" — TAPI package.json TIDAK PERNAH mencantumkan
paket-paket itu di dependencies, jadi tsc gagal total "Cannot find module"):
- Kalau UI/UX Design Specification menyiratkan kebutuhan form validation,
  toast notification, auth session, dst — package.json WAJIB cantumkan
  package yang benar-benar akan dipakai file-file lain (mis. jangan sebut
  "react-hook-form" di file lain kalau package.json tidak mencantumkannya).
  Sebaliknya, kalau memang tidak perlu library eksternal untuk sebuah
  kebutuhan (mis. form sederhana), JANGAN import library yang tidak
  tercantum di package.json — tulis manual pakai useState/native HTML
  form saja.

ATURAN KETAT OUTPUT (postmortem: LLM lain pernah balas dengan teks
"We need to output a JSON array..." alih-alih JSON-nya langsung, buang
seluruh budget token buat mikir/menjelaskan sampai tidak sempat sampai ke
jawaban asli):
- JANGAN PERNAH menjelaskan cara berpikir Anda, JANGAN PERNAH menulis
  kalimat pembuka seperti "We need to..." / "Let's compile..." / "Baiklah,
  saya akan...". LANGSUNG mulai balasan dengan karakter "[" — tidak ada
  satu kata pun sebelum itu.
- Balas HANYA dengan satu JSON array valid, TIDAK ADA teks lain di luar JSON,
  TIDAK ADA markdown code fence, TIDAK ADA penjelasan/reasoning di awal
  ATAU akhir.
- Setiap item: {"path": "app/...", "purpose": "deskripsi SANGAT singkat,
  maksimal 8 kata", "screenId": "id screen dari screens.yaml kalau file ini
  adalah page untuk screen tsb, kosongkan kalau bukan", "componentId": "id
  component dari components.yaml — WAJIB diisi kalau file ini component,
  lihat aturan tagging di atas, JANGAN dikosongkan kalau memang component",
  "dependsOn": ["path file lain yang isinya WAJIB dibaca — MAKSIMAL 3 path
  paling penting saja"]}
- URUTAN DI JSON: taruh package.json, tsconfig.json, tailwind.config.ts,
  app/layout.tsx, lib/utils.ts DI PALING AWAL array — supaya kalau output
  ke-truncate, file wajib ini tetap aman. Urutan generate sebenarnya dari
  "dependsOn".
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
  sections.push(``, `Balas LANGSUNG dengan JSON array-nya, mulai dari karakter "[" — tanpa basa-basi apapun sebelumnya. Ingat: SETIAP file component WAJIB punya componentId terisi, jangan dikosongkan; JANGAN import package npm yang tidak tercantum di package.json; sertakan lib/utils.ts secara eksplisit.`);
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
- Jangan pernah memotong output di tengah.
- JAGA FILE TETAP FOKUS DAN RINGKAS (postmortem: file bisa kepotong kalau
  kepanjangan). Kalau satu file mulai terasa terlalu besar (>400-500 baris),
  fokus ke implementasi inti, hindari komentar panjang dan boilerplate
  berulang.
- PERHATIKAN JSX DITUTUP DENGAN BENAR (postmortem: component kalender
  kompleks pernah gagal build karena tag <div> tidak ketutup semua —
  TS17008). Sebelum selesai, hitung ulang pasangan tag pembuka/penutup,
  terutama untuk component dengan banyak nested div/conditional rendering.
- HATI-HATI DENGAN TEMPLATE LITERAL (backtick), TERUTAMA DI DALAM className
  DINAMIS (postmortem FATAL: "Unterminated template literal" muncul di
  BARIS PALING AKHIR file, tapi error lain muncul dari BARIS AWAL - ini
  tanda 1 backtick tidak pernah ditutup di awal file, bikin SISA seluruh
  file dianggap "masih di dalam string" oleh compiler sampai akhir, error
  jadi menyebar ke ratusan baris). Kalau butuh className dinamis, PASTIKAN
  setiap backtick pembuka punya PERSIS SATU backtick penutup di baris yang
  sama. Kalau ragu atau kondisinya rumit (banyak kondisi bercabang), JANGAN
  pakai template literal sama sekali - pakai fungsi cn() dari lib/utils
  dengan argumen terpisah dan operator ternary biasa, jauh lebih aman dari
  risiko salah tutup backtick.
- WAJIB PAKAI NAMED EXPORT UNTUK SEMUA COMPONENT REACT, JANGAN DEFAULT EXPORT
  (postmortem FATAL: puluhan file gagal build "Module has no exported
  member 'Button'" karena components/Button.tsx pakai "export default"
  sementara SEMUA file lain yang meng-import-nya pakai
  "import { Button } from '@/components/Button'" — konvensi harus
  KONSISTEN di SELURUH project). Tulis SELALU begini:
  "export function Button(props: ButtonProps) { ... }" atau
  "export const Button = (props: ButtonProps) => { ... }" — TIDAK PERNAH
  "export default function Button...". Ini berlaku untuk SEMUA file di
  folder components/, tanpa kecuali.
- KALAU file ini page (app/.../page.tsx), page BOLEH default export
  (konvensi Next.js App Router memang wajib default export untuk page.tsx
  — aturan named-export di atas KHUSUS untuk folder components/, bukan
  untuk page.tsx).
- HANYA import package npm yang BENAR-BENAR ada di package.json project ini
  (lihat manifest overview/dependency yang dilampirkan). JANGAN import
  "react-hook-form", "next-auth", "sonner", atau library lain yang terasa
  umum tapi belum pasti ada di package.json — cek dulu, kalau ragu tulis
  manual tanpa library.
- DESAIN PROP COMPONENT SHARED HARUS FLEKSIBEL, TERIMA "children" UNTUK
  KONTEN TEKS (postmortem FATAL: puluhan file pakai pola React wajar
  "<Badge>{teks}</Badge>" atau "<Alert>{pesan}</Alert>", tapi component
  BadgeProps/AlertProps HANYA terima prop "label"/"message", TIDAK terima
  "children" — bikin error "Property 'children' does not exist on type").
  Kalau Anda generate component shared (Badge, Alert, Card, Tooltip, dst)
  yang menampilkan TEKS/KONTEN: WAJIB terima "children: React.ReactNode" di
  props-nya SEBAGAI CARA UTAMA menampilkan isi (bukan cuma prop "label"
  string) — ini pola React paling umum dipakai file lain secara alami.
  Kalau memang perlu prop "label" juga (mis. untuk aksesibilitas), buat
  keduanya optional dan render salah satu (children diutamakan kalau ada).
- KONVENSI BAKU NAMA "variant"/STATUS UNTUK Badge/StatusBadge/Alert DAN
  SEJENISNYA - WAJIB SAMA PERSIS DI SELURUH PROJECT (postmortem FATAL:
  puluhan error "Type 'error' is not assignable to type ...'danger'..." -
  sebagian file pakai kata "error", sebagian lain component-nya didefinisikan
  pakai "danger" untuk MAKNA YANG SAMA, jadi antar file saling tidak
  cocok). Prop "variant" (atau "status"/"color") pada component seperti ini
  WAJIB PERSIS pakai union type berikut, TIDAK ADA VARIASI LAIN:
  "success" | "warning" | "danger" | "info" | "neutral"
  - PAKAI "danger" UNTUK KONDISI GAGAL/ERROR/DITOLAK, JANGAN PERNAH tulis
    "error" (walau secara bahasa mirip, harus konsisten "danger").
  - Component Badge/StatusBadge WAJIB terima prop bernama PERSIS "variant"
    (bukan "color", bukan "status") dengan union type di atas - SEMUA file
    lain yang memakainya akan menebak nama prop ini "variant" secara alami.
- WAJIB IMPORT SEMUA YANG DIPAKAI, TANPA KECUALI (postmortem FATAL: puluhan
  file pakai useState/useMemo/component custom seperti Button/Badge/Avatar
  TANPA satu baris import pun — file "berjalan" seolah semua itu global,
  padahal tidak). Sebelum selesai, baca ULANG kode Anda baris per baris,
  dan untuk SETIAP nama yang dipakai (hook React, component custom, icon,
  type/interface dari file lain) PASTIKAN ada baris import-nya di paling
  atas file. Kalau pakai useState/useEffect/useMemo/dst dari React, WAJIB
  "import { useState } from 'react'" (atau gabung: "import { useState,
  useMemo } from 'react'"). Kalau pakai component seperti <Button>,
  <Badge>, <Modal>, WAJIB "import { Button } from '@/components/Button'"
  dst — SATU baris import per component yang dipakai.
- Path dan tujuan spesifik file yang harus Anda generate SEKARANG ada di
  BAGIAN PALING BAWAH pesan user setelah semua konteks project — baca
  sampai ke situ sebelum mulai menulis.`;

const API_CLIENT_HINT = `\nPENTING soal lib/api.ts (postmortem FATAL: file ini digenerate PALING
AWAL, sebelum page/component lain yang akan MEMAKAINYA — puluhan file lain
gagal build "Module @/lib/api has no exported member 'login'/'getTeams'/dst"
karena lib/api.ts cuma export function yang "kelihatan perlu" saat itu, TIDAK
lengkap mencakup semua endpoint Backend API Contract):
- Export SATU named function terpisah untuk SETIAP endpoint yang ada di
  Backend API Contract yang dilampirkan — bukan cuma yang terasa relevan.
  Kalau Backend API Contract punya endpoint GET /users, POST /users,
  PUT /users/:id, DELETE /users/:id — WAJIB ada getUsers(), createUser(),
  updateUser(), deleteUser() (atau nama serupa yang jelas & konsisten),
  SEMUANYA, bukan cuma yang paling jelas dipakai.
- Nama function HARUS deskriptif & predictable (verb+noun: getTeams,
  createSwapRequest, login, dst) — file lain akan menebak nama ini dari
  konteks penggunaan tanpa bisa melihat isi lib/api.ts, jadi nama harus
  masuk akal dan konsisten dengan pola REST standar.
- JANGAN bungkus semua endpoint jadi 1 object besar (mis. "export default
  { getUsers, createUser }") — WAJIB named export terpisah per function
  ("export function getUsers() {...}", "export function createUser() {...}"
  dst), supaya file lain bisa "import { getUsers } from '@/lib/api'".
- IMPLEMENTASI HTTP: pakai "axios" LANGSUNG di dalam lib/api.ts, JANGAN
  bergantung pada Context/class ApiClient terpisah yang rumit (postmortem
  FATAL: puluhan error "'get'/'post' does not exist on type
  ApiClientContextValue" - lib/api.ts coba panggil method dari sebuah
  Context yang sebenarnya tidak expose method HTTP langsung). Buat 1
  instance axios SEDERHANA di ATAS file ini, lalu SETIAP function endpoint
  panggil method dari instance axios INI LANGSUNG (bukan ke Context, bukan
  ke class terpisah, bukan lewat abstraction lain):
  "import axios from 'axios'; const api = axios.create({ baseURL:
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:6001' });" lalu
  panggil "api.get(...)" / "api.post(...)" dst langsung ke variabel "api"
  itu di setiap function endpoint. Sesederhana mungkin.\n`;

const PACKAGE_JSON_HINT = `\nPENTING soal dependency: HANYA gunakan nama package npm yang BENAR-BENAR
ADA dan yakin benar (mis. "next", "react", "react-dom", "tailwindcss",
"@radix-ui/*", "recharts", "axios", "zod" — package populer dan umum
dipakai). JANGAN mengarang nama package yang terdengar masuk akal tapi
tidak yakin ada. Kalau ragu, JANGAN pakai — cari alternatif yang sudah
pasti familiar. PENTING: package.json ini jadi SATU-SATUNYA sumber
kebenaran dependency untuk SELURUH project — file lain HANYA boleh import
package yang tercantum di sini.\n`;

// Fix kritikal (postmortem FATAL berulang: lib/utils.ts membengkak jadi
// 1950 baris, lalu 2796 baris di percobaan berikutnya — bukan file kecil
// yang dimaksud, LLM terus menambahkan isi sampai rusak/timpang tindih
// deklarasi fungsi. Ini file yang PALING SERING dirujuk banyak component
// (lewat "@/lib/utils"), jadi kalau dia rusak, TSC ikut bingung resolve
// module untuk PULUHAN file lain sekaligus — cascading failure). Kasih
// instruksi SANGAT PRESKRIPTIF, bukan cuma "jaga ringkas" — beri TAHU
// PERSIS isinya yang diharapkan, supaya tidak ada ruang LLM berimprovisasi
// jadi berlebihan.
const UTILS_HINT = `\nPENTING soal lib/utils.ts (postmortem FATAL: file ini pernah membengkak
sampai 2796 baris dan rusak — file ini WAJIB TETAP KECIL, MAKSIMAL 30 BARIS):
- Isi HARUS PERSIS pola standar berikut (shadcn/ui convention), JANGAN
  tambah fungsi lain apapun kecuali benar-benar ada bukti KUAT dari UI/UX
  spec yang secara eksplisit butuh utility lain:

import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

- Pastikan "clsx" dan "tailwind-merge" ADA di package.json dependencies
  (kalau file dependency package.json dilampirkan, cek — kalau tidak ada,
  tetap tulis kode di atas, package.json akan diperbaiki terpisah).
- JANGAN tambahkan fungsi format tanggal, format currency, validasi, dst
  di file ini — itu HARUS jadi file util TERPISAH (mis. lib/date.ts,
  lib/format.ts) kalau memang dibutuhkan, BUKAN ditumpuk di lib/utils.ts.\n`;

export function buildFileSystemPrompt(): string {
  return `Anda adalah AI Frontend Developer di AI Software Factory. Stack: ${TECH_STACK}

Anda akan generate file frontend SATU PER PANGGILAN. Detail file yang harus
digenerate SEKARANG (path & tujuannya) ada di BAGIAN PALING BAWAH user
prompt — baca konteks project dulu (PRD/Architecture/UI-UX/Backend API),
baru scroll ke bawah untuk tahu file mana yang diminta kali ini.

${OUTPUT_RULES}`;
}

export function buildFileUserPrompt(params: {
  prdContent: string;
  architectureContent: string;
  uiuxCombined: string;
  backendSummary: string;
  manifestOverview: string;
  dependencyFiles: { path: string; content: string }[];
  fileInfo: { path: string; purpose: string };
}): string {
  // Urutan SENGAJA: konten besar yang SAMA PERSIS tiap panggilan (manifest,
  // PRD, Architecture, UIUX, Backend summary) di paling ATAS — ini yang
  // dapat manfaat context caching DeepSeek. Info spesifik file (beda tiap
  // panggilan) SELALU di paling BAWAH — lihat komentar di buildFileSystemPrompt.
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

  const packageJsonHint = params.fileInfo.path === 'package.json' ? PACKAGE_JSON_HINT : '';
  const apiHint = params.fileInfo.path.includes('lib/api') ? API_CLIENT_HINT : '';
  const utilsHint = params.fileInfo.path.includes('lib/utils') ? UTILS_HINT : '';
  sections.push(
    ``,
    `# ===== FILE YANG HARUS DIGENERATE SEKARANG =====`,
    `Path: ${params.fileInfo.path}`,
    `Tujuan file ini: ${params.fileInfo.purpose}`,
    packageJsonHint,
    apiHint,
    utilsHint,
  );

  return sections.join('\n');
}

export function buildRepairSystemPrompt(): string {
  return `Anda adalah AI Frontend Developer di AI Software Factory. Stack: ${TECH_STACK}

Anda akan diminta perbaiki SATU file yang gagal compile/build. Detail file
(path, isi saat ini, error log) ada di user prompt. Perbaiki HANYA error
yang disebutkan — jangan ubah behavior/struktur lain yang tidak error.

Kalau error-nya "No matching version found" / "notarget" / "E404" untuk
sebuah package: package itu KEMUNGKINAN BESAR TIDAK ADA di npm registry
(nama hasil karangan). JANGAN coba versi lain dari package yang sama —
GANTI ke package NYATA yang benar-benar ada, atau HAPUS dependency itu
kalau tidak yakin nama yang benar.

Kalau error-nya "Cannot find module 'X'" untuk package npm ASLI (mis.
react-hook-form, next-auth, sonner) yang dipakai file LAIN tapi tidak ada
di package.json ini: TAMBAHKAN package itu ke dependencies dengan versi
yang wajar (mis. "^7.0.0" untuk react-hook-form) — JANGAN hapus/ubah
import di file lain, package.json yang harus menyesuaikan.

Kalau file ini "lib/utils.ts" dan error soal syntax rusak (function
declaration duplikat, "implementation is missing", dst): file ini KEMUNGKINAN
BESAR membengkak jadi ratusan/ribuan baris tanpa perlu. TULIS ULANG DARI NOL
jadi HANYA pola standar berikut, JANGAN pertahankan isi lama:

import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

Kalau error-nya soal JSX (TS17008 "no corresponding closing tag", TS1005
"'/' expected" atau "'</' expected"): itu tanda ada tag pembuka yang tidak
punya pasangan penutup, atau sebaliknya. Baca ULANG SELURUH file dari awal,
hitung setiap <div>, <span>, dst yang dibuka HARUS ketemu penutupnya
sebelum function/component berakhir. Tulis ULANG STRUKTUR JSX-nya dari nol
dengan indentasi rapi kalau perlu — jangan cuma tempel penutup di akhir
tanpa mastikan urutan nesting-nya benar.

Kalau error-nya "has no exported member 'X'" atau "has no default export"
(TS2305/TS2613/TS2614): ini soal KONVENSI EXPORT yang tidak konsisten.
File component React di folder components/ WAJIB pakai NAMED EXPORT
("export function X" atau "export const X = ..."), TIDAK PERNAH default
export. Kalau file ini SEDANG memakai "export default", ganti jadi named
export SAMBIL TETAP JAGA nama function/component-nya persis sama (supaya
file lain yang sudah import { X } otomatis cocok tanpa perlu diubah juga).
Kalau error-nya "Cannot find name 'X'" (TS2304): ini berarti nama X dipakai
di file tapi TIDAK ADA import untuk itu. Tentukan sumbernya:
- Kalau X adalah hook React (useState, useEffect, useMemo, useCallback,
  useRef, dst): tambahkan/lengkapi baris "import { X } from 'react'" di
  paling atas file (gabung dengan hook lain yang sudah di-import kalau ada).
- Kalau X adalah nama Component (huruf awal kapital, mis. Button, Select,
  ToggleSwitch, Table): tambahkan "import { X } from '@/components/X'" —
  asumsikan nama file component sama dengan nama Component-nya.
- Kalau X adalah nama icon (mis. EyeIcon, TrashIcon, SearchIcon): kemungkinan
  dari library icon yang sudah ada di package.json (mis. lucide-react) —
  tambahkan import yang sesuai.
- PERBAIKI SEMUA kemunculan "Cannot find name" di error log ini, jangan
  cuma yang pertama — biasanya banyak nama hilang sekaligus di 1 file.

Kalau file ini "lib/api.ts" dan error "no exported member 'namaFungsi'":
TAMBAHKAN function itu sebagai named export baru (jangan hapus fungsi lain
yang sudah ada) — errornya bermakna file LAIN sudah coba import fungsi ini,
jadi buat implementasi yang masuk akal berdasar namanya (mis. "getTeams"
berarti GET request ke endpoint teams).

${OUTPUT_RULES}`;
}

export function buildRepairUserPrompt(params: { path: string; originalContent: string; errorLog: string }): string {
  return [
    `# Path file`,
    params.path,
    ``,
    `# Isi file saat ini (yang gagal compile/build)`,
    params.originalContent,
    ``,
    `# Error log`,
    params.errorLog,
    ``,
    `Perbaiki file ini supaya lolos compile/build.`,
  ].join('\n');
}
