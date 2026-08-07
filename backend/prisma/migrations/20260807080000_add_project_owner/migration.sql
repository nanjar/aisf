-- V1.1.1: Project ownership (menutup celah: semua user login bisa lihat semua project)
--
-- Pola aman untuk kolom NOT NULL di tabel yang sudah berisi data (lihat postgresql-dba skill):
-- 1) tambah kolom NULLABLE dulu
-- 2) backfill data lama
-- 3) baru enforce NOT NULL + FK + index
--
-- Backfill mengarahkan SEMUA project lama ke user yang PERTAMA dibuat (created_at paling awal).
-- Ini aman untuk kasus kamu karena sebelum V1.1 hanya ada satu admin (single-admin app, seeded
-- dari ADMIN_EMAIL saat boot pertama) — jadi user pertama yang ada di tabel users SUDAH PASTI
-- admin itu, dan project "HRD Automation" dkk memang dibuat olehnya.

BEGIN;

-- CATATAN: "TEXT", bukan "UUID" — Prisma's @id @default(uuid()) disimpan sebagai TEXT/VARCHAR
-- di Postgres, bukan tipe UUID native, jadi owner_id (dan FK-nya ke users.id) harus TEXT juga
-- supaya tipe datanya cocok.
ALTER TABLE "projects" ADD COLUMN "owner_id" TEXT;

UPDATE "projects"
SET "owner_id" = (SELECT id FROM "users" ORDER BY created_at ASC LIMIT 1)
WHERE "owner_id" IS NULL;

-- Safety check: kalau ternyata masih ada project tanpa owner (mis. tabel users kosong saat
-- migrasi ini jalan), migrasi berhenti di sini alih-alih diam-diam membuat data rusak.
DO $$
DECLARE
  orphan_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO orphan_count FROM "projects" WHERE "owner_id" IS NULL;
  IF orphan_count > 0 THEN
    RAISE EXCEPTION 'Migrasi dibatalkan: % project masih tanpa owner_id setelah backfill. Cek tabel users tidak kosong.', orphan_count;
  END IF;
END $$;

ALTER TABLE "projects" ALTER COLUMN "owner_id" SET NOT NULL;

ALTER TABLE "projects"
  ADD CONSTRAINT "projects_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "projects_owner_id_idx" ON "projects"("owner_id");

COMMIT;
