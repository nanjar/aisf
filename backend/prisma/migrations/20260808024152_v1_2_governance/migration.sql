/*
  Warnings:

  - You are about to drop the column `owner_id` on the `projects` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "OrgRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER');

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('INVITED', 'ACTIVE', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "ValidationStatus" AS ENUM ('PENDING', 'PASSED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReminderType" AS ENUM ('T_MINUS_24H', 'T_MINUS_3H', 'OVERDUE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StageStatus" ADD VALUE 'GENERATING';
ALTER TYPE "StageStatus" ADD VALUE 'VALIDATING';
ALTER TYPE "StageStatus" ADD VALUE 'SELF_HEALING';
ALTER TYPE "StageStatus" ADD VALUE 'REVISION_REQUESTED';
ALTER TYPE "StageStatus" ADD VALUE 'ARCHIVED';

-- DropForeignKey
ALTER TABLE "projects" DROP CONSTRAINT "projects_owner_id_fkey";

-- DropIndex
DROP INDEX "projects_owner_id_idx";

-- AlterTable
ALTER TABLE "artifact_stages" ADD COLUMN     "deadline_at" TIMESTAMP(3),
ADD COLUMN     "decided_by_id" TEXT,
ADD COLUMN     "failed_validation" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "overdue_at" TIMESTAMP(3),
ADD COLUMN     "revision_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "self_healing_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "validation_status" "ValidationStatus" NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "projects" DROP COLUMN "owner_id",
ADD COLUMN     "created_by_id" TEXT,
ADD COLUMN     "deadline_at" TIMESTAMP(3),
ADD COLUMN     "organization_id" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "preferred_language" TEXT NOT NULL DEFAULT 'id';

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_members" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "OrgRole" NOT NULL DEFAULT 'MEMBER',
    "status" "MemberStatus" NOT NULL DEFAULT 'INVITED',
    "invited_by" TEXT,
    "invited_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "joined_at" TIMESTAMP(3),

    CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_members" (
    "id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "organization_member_id" TEXT NOT NULL,
    "job_title" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stage_assignments" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "stage_key" "StageKey" NOT NULL,
    "assigned_member_id" TEXT NOT NULL,
    "assigned_by" TEXT NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stage_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revision_requests" (
    "id" TEXT NOT NULL,
    "artifact_stage_id" TEXT NOT NULL,
    "comment" TEXT NOT NULL,
    "requested_by" TEXT NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revision_number" INTEGER NOT NULL,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "revision_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artifact_objects" (
    "id" TEXT NOT NULL,
    "artifact_stage_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "storage_provider" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "object_key" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "mime_type" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "artifact_objects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminder_logs" (
    "id" TEXT NOT NULL,
    "artifact_stage_id" TEXT NOT NULL,
    "reminder_type" "ReminderType" NOT NULL,
    "sent_to" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reminder_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "teams_organization_id_idx" ON "teams"("organization_id");

-- CreateIndex
CREATE INDEX "organization_members_organization_id_idx" ON "organization_members"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "organization_members_organization_id_user_id_key" ON "organization_members"("organization_id", "user_id");

-- CreateIndex
CREATE INDEX "team_members_team_id_idx" ON "team_members"("team_id");

-- CreateIndex
CREATE UNIQUE INDEX "team_members_team_id_organization_member_id_key" ON "team_members"("team_id", "organization_member_id");

-- CreateIndex
CREATE INDEX "stage_assignments_assigned_member_id_idx" ON "stage_assignments"("assigned_member_id");

-- CreateIndex
CREATE UNIQUE INDEX "stage_assignments_project_id_stage_key_key" ON "stage_assignments"("project_id", "stage_key");

-- CreateIndex
CREATE INDEX "revision_requests_artifact_stage_id_idx" ON "revision_requests"("artifact_stage_id");

-- CreateIndex
CREATE INDEX "artifact_objects_artifact_stage_id_idx" ON "artifact_objects"("artifact_stage_id");

-- CreateIndex
CREATE INDEX "artifact_objects_artifact_stage_id_file_name_version_idx" ON "artifact_objects"("artifact_stage_id", "file_name", "version");

-- CreateIndex
CREATE UNIQUE INDEX "reminder_logs_artifact_stage_id_reminder_type_key" ON "reminder_logs"("artifact_stage_id", "reminder_type");

-- CreateIndex
CREATE INDEX "projects_organization_id_idx" ON "projects"("organization_id");

-- CreateIndex
CREATE INDEX "projects_created_by_id_idx" ON "projects"("created_by_id");

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_organization_member_id_fkey" FOREIGN KEY ("organization_member_id") REFERENCES "organization_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifact_stages" ADD CONSTRAINT "artifact_stages_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stage_assignments" ADD CONSTRAINT "stage_assignments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stage_assignments" ADD CONSTRAINT "stage_assignments_assigned_member_id_fkey" FOREIGN KEY ("assigned_member_id") REFERENCES "organization_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revision_requests" ADD CONSTRAINT "revision_requests_artifact_stage_id_fkey" FOREIGN KEY ("artifact_stage_id") REFERENCES "artifact_stages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifact_objects" ADD CONSTRAINT "artifact_objects_artifact_stage_id_fkey" FOREIGN KEY ("artifact_stage_id") REFERENCES "artifact_stages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_logs" ADD CONSTRAINT "reminder_logs_artifact_stage_id_fkey" FOREIGN KEY ("artifact_stage_id") REFERENCES "artifact_stages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
