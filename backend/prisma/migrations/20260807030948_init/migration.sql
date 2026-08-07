-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('RUNNING', 'COMPLETED', 'REJECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "StageStatus" AS ENUM ('PENDING', 'GENERATED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "StageKey" AS ENUM ('PRD', 'ARCHITECTURE', 'ESTIMATION', 'DATABASE', 'BACKEND', 'FRONTEND', 'QA');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "business_idea" TEXT NOT NULL,
    "knowledge_base_id" TEXT,
    "ai_model" TEXT NOT NULL DEFAULT 'gpt-5-mini',
    "status" "ProjectStatus" NOT NULL DEFAULT 'RUNNING',
    "n8n_execution_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artifact_stages" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "stage_key" "StageKey" NOT NULL,
    "artifact_name" TEXT,
    "content" TEXT,
    "status" "StageStatus" NOT NULL DEFAULT 'PENDING',
    "resume_url" TEXT,
    "comment" TEXT,
    "decided_by" TEXT,
    "generated_at" TIMESTAMP(3),
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "artifact_stages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "artifact_stages_project_id_idx" ON "artifact_stages"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "artifact_stages_project_id_stage_key_key" ON "artifact_stages"("project_id", "stage_key");

-- AddForeignKey
ALTER TABLE "artifact_stages" ADD CONSTRAINT "artifact_stages_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
