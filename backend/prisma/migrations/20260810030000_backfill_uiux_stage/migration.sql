-- V1.3 Fase 2 follow-up: project yang dibuat SEBELUM migration ini tidak
-- punya baris artifact_stages untuk stage_key='UIUX' (baris itu cuma dibuat
-- otomatis untuk project baru lewat STAGE_ORDER, lihat ProjectsService.create).
-- Idempotent: aman dijalankan berkali-kali / di database yang sudah punya
-- semua baris (WHERE NOT EXISTS membuatnya no-op untuk project yang sudah OK).
--
-- id di sini di-generate manual (gen_random_uuid(), built-in sejak PG13)
-- karena kolom id TEXT tidak punya DB-level default -- Prisma generate UUID
-- di application level (lihat catatan di schema.prisma / memory kerja).

INSERT INTO "artifact_stages" ("id", "project_id", "stage_key", "status", "created_at", "updated_at")
SELECT
  gen_random_uuid()::text,
  p."id",
  'UIUX',
  'PENDING',
  now(),
  now()
FROM "projects" p
WHERE NOT EXISTS (
  SELECT 1 FROM "artifact_stages" s
  WHERE s."project_id" = p."id" AND s."stage_key" = 'UIUX'
);
