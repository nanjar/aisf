-- V1.3 Fase 1 (§69, §70 PRD V1.3): Generation Engine data model.
-- Additive only — no existing table/column touched.

-- CreateEnum
CREATE TYPE "LLMProviderName" AS ENUM ('DEEPSEEK', 'OPENAI_COMPATIBLE', 'QWEN');

-- CreateEnum
CREATE TYPE "GenerationJobStatus" AS ENUM ('PLANNED', 'RUNNING', 'VALIDATING', 'BUILDING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "GenerationFileStatus" AS ENUM ('PLANNED', 'GENERATING', 'GENERATED', 'VALIDATING', 'VALID', 'INVALID', 'REPAIRING', 'FAILED');

-- CreateEnum
CREATE TYPE "ValidationLevel" AS ENUM ('FILE', 'PROJECT', 'COMPILE', 'BUILD');

-- CreateEnum
CREATE TYPE "ChunkStatus" AS ENUM ('PENDING', 'RECEIVED', 'MERGED');

-- CreateTable
CREATE TABLE "generation_jobs" (
    "id" TEXT NOT NULL,
    "artifact_stage_id" TEXT NOT NULL,
    "provider" "LLMProviderName" NOT NULL DEFAULT 'DEEPSEEK',
    "model" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "status" "GenerationJobStatus" NOT NULL DEFAULT 'PLANNED',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "total_files" INTEGER NOT NULL DEFAULT 0,
    "generated_files" INTEGER NOT NULL DEFAULT 0,
    "missing_files" INTEGER NOT NULL DEFAULT 0,
    "invalid_files" INTEGER NOT NULL DEFAULT 0,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "total_tokens" INTEGER NOT NULL DEFAULT 0,
    "estimated_cost_usd" DECIMAL(10,4),
    "error_category" TEXT,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "generation_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generation_files" (
    "id" TEXT NOT NULL,
    "generation_job_id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "status" "GenerationFileStatus" NOT NULL DEFAULT 'PLANNED',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "depends_on_paths" TEXT[],
    "artifact_object_id" TEXT,
    "checksum" TEXT,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "generation_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generation_chunks" (
    "id" TEXT NOT NULL,
    "generation_file_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "total_chunks" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "status" "ChunkStatus" NOT NULL DEFAULT 'RECEIVED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generation_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "validation_results" (
    "id" TEXT NOT NULL,
    "generation_job_id" TEXT NOT NULL,
    "generation_file_id" TEXT,
    "level" "ValidationLevel" NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "errors" JSONB,
    "duration_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "validation_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repair_attempts" (
    "id" TEXT NOT NULL,
    "generation_file_id" TEXT NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "error_summary" TEXT NOT NULL,
    "repair_prompt_version" TEXT NOT NULL,
    "result_status" "GenerationFileStatus" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repair_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "generation_files_artifact_object_id_key" ON "generation_files"("artifact_object_id");

-- CreateIndex
CREATE UNIQUE INDEX "generation_files_generation_job_id_path_key" ON "generation_files"("generation_job_id", "path");

-- CreateIndex
CREATE INDEX "generation_files_generation_job_id_idx" ON "generation_files"("generation_job_id");

-- CreateIndex
CREATE UNIQUE INDEX "generation_chunks_generation_file_id_sequence_key" ON "generation_chunks"("generation_file_id", "sequence");

-- CreateIndex
CREATE INDEX "generation_chunks_generation_file_id_idx" ON "generation_chunks"("generation_file_id");

-- CreateIndex
CREATE INDEX "validation_results_generation_job_id_idx" ON "validation_results"("generation_job_id");

-- CreateIndex
CREATE INDEX "validation_results_generation_file_id_idx" ON "validation_results"("generation_file_id");

-- CreateIndex
CREATE INDEX "repair_attempts_generation_file_id_idx" ON "repair_attempts"("generation_file_id");

-- CreateIndex
CREATE INDEX "generation_jobs_artifact_stage_id_idx" ON "generation_jobs"("artifact_stage_id");

-- AddForeignKey
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_artifact_stage_id_fkey" FOREIGN KEY ("artifact_stage_id") REFERENCES "artifact_stages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_files" ADD CONSTRAINT "generation_files_generation_job_id_fkey" FOREIGN KEY ("generation_job_id") REFERENCES "generation_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_files" ADD CONSTRAINT "generation_files_artifact_object_id_fkey" FOREIGN KEY ("artifact_object_id") REFERENCES "artifact_objects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_chunks" ADD CONSTRAINT "generation_chunks_generation_file_id_fkey" FOREIGN KEY ("generation_file_id") REFERENCES "generation_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "validation_results" ADD CONSTRAINT "validation_results_generation_job_id_fkey" FOREIGN KEY ("generation_job_id") REFERENCES "generation_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "validation_results" ADD CONSTRAINT "validation_results_generation_file_id_fkey" FOREIGN KEY ("generation_file_id") REFERENCES "generation_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_attempts" ADD CONSTRAINT "repair_attempts_generation_file_id_fkey" FOREIGN KEY ("generation_file_id") REFERENCES "generation_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;
