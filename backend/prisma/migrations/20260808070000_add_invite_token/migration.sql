-- V1.2: token undangan asli — sebelumnya email undangan cuma teks tanpa link/token sama sekali.
-- Additive, aman via psql langsung (tidak butuh shadow database).

BEGIN;

ALTER TABLE "organization_members"
  ADD COLUMN IF NOT EXISTS "invite_token" TEXT,
  ADD COLUMN IF NOT EXISTS "invite_token_expires_at" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "organization_members_invite_token_key"
  ON "organization_members" ("invite_token");

COMMIT;

-- Member yang sudah diundang SEBELUM migrasi ini (mis. kn.gapleh@gmail.com) akan punya
-- invite_token NULL — link lama mereka (kalau ada) tidak akan valid. Solusi: OWNER/ADMIN
-- klik "Kirim Ulang" (Resend) dari halaman /team untuk generate token baru + kirim ulang
-- email dengan link yang benar. Atau tetap bisa diaktifkan manual lewat tombol "Aktifkan".
