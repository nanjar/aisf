-- V1.2: assignment stage sekarang bisa ke TEAM, bukan cuma ke satu member.

BEGIN;

ALTER TABLE "stage_assignments"
  ALTER COLUMN "assigned_member_id" DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS "assigned_team_id" TEXT;

ALTER TABLE "stage_assignments"
  ADD CONSTRAINT "stage_assignments_assigned_team_id_fkey"
  FOREIGN KEY ("assigned_team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "stage_assignments_assigned_team_id_idx" ON "stage_assignments" ("assigned_team_id");

-- Pastikan tepat satu dari dua kolom terisi (bukan dua-duanya, bukan kosong dua-duanya).
ALTER TABLE "stage_assignments"
  ADD CONSTRAINT "stage_assignments_member_xor_team"
  CHECK (
    (assigned_member_id IS NOT NULL AND assigned_team_id IS NULL) OR
    (assigned_member_id IS NULL AND assigned_team_id IS NOT NULL)
  );

COMMIT;
