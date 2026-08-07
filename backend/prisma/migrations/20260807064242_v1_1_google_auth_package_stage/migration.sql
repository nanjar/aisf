/*
  Warnings:

  - A unique constraint covering the columns `[google_id]` on the table `users` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('LOCAL', 'GOOGLE');

-- AlterEnum
ALTER TYPE "StageKey" ADD VALUE 'PACKAGE';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "auth_provider" "AuthProvider" NOT NULL DEFAULT 'LOCAL',
ADD COLUMN     "google_id" TEXT,
ADD COLUMN     "name" TEXT,
ALTER COLUMN "password_hash" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "users_google_id_key" ON "users"("google_id");
