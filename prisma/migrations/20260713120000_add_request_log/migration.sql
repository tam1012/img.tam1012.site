-- CreateEnum
CREATE TYPE "RequestLogKind" AS ENUM ('generate', 'edit', 'video');

-- CreateEnum
CREATE TYPE "RequestLogStatus" AS ENUM ('processing', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "RequestDeleteMode" AS ENUM ('soft', 'hard');

-- CreateTable
CREATE TABLE "RequestLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "RequestLogKind" NOT NULL,
    "model" TEXT NOT NULL,
    "providerName" TEXT,
    "account" TEXT,
    "status" "RequestLogStatus" NOT NULL DEFAULT 'processing',
    "costVnd" INTEGER NOT NULL DEFAULT 0,
    "aspectRatio" TEXT,
    "resolution" TEXT,
    "errorMessage" TEXT,
    "batchId" TEXT,
    "relatedImageId" TEXT,
    "relatedVideoId" TEXT,
    "mediaDeletedAt" TIMESTAMP(3),
    "mediaDeletedBy" TEXT,
    "mediaDeleteMode" "RequestDeleteMode",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RequestLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RequestLog_relatedImageId_key" ON "RequestLog"("relatedImageId");

-- CreateIndex
CREATE UNIQUE INDEX "RequestLog_relatedVideoId_key" ON "RequestLog"("relatedVideoId");

-- CreateIndex
CREATE INDEX "RequestLog_userId_createdAt_idx" ON "RequestLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "RequestLog_createdAt_idx" ON "RequestLog"("createdAt");

-- CreateIndex
CREATE INDEX "RequestLog_kind_createdAt_idx" ON "RequestLog"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "RequestLog_status_createdAt_idx" ON "RequestLog"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "RequestLog" ADD CONSTRAINT "RequestLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill nguồn 1: từ Image còn trong DB (mọi status). Ảnh soft-delete giữ nhãn đã xóa.
INSERT INTO "RequestLog" (
  "id", "userId", "kind", "model", "providerName", "account", "status", "costVnd",
  "aspectRatio", "resolution", "errorMessage", "batchId", "relatedImageId",
  "mediaDeletedAt", "mediaDeletedBy", "mediaDeleteMode", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  i."userId",
  CASE
    WHEN i."editPrompt" IS NOT NULL OR i."originalImageId" IS NOT NULL THEN 'edit'::"RequestLogKind"
    ELSE 'generate'::"RequestLogKind"
  END,
  i."model",
  i."providerName",
  NULL,
  CASE
    WHEN i."status" = 'deleted' THEN 'completed'::"RequestLogStatus"
    WHEN i."status" = 'completed' THEN 'completed'::"RequestLogStatus"
    WHEN i."status" = 'failed' THEN 'failed'::"RequestLogStatus"
    ELSE 'processing'::"RequestLogStatus"
  END,
  i."costVnd",
  i."aspectRatio",
  i."resolution",
  i."errorMessage",
  i."batchId",
  i."id",
  CASE WHEN i."status" = 'deleted' THEN i."deletedAt" ELSE NULL END,
  CASE WHEN i."status" = 'deleted' THEN i."deletedBy" ELSE NULL END,
  CASE WHEN i."status" = 'deleted' THEN 'soft'::"RequestDeleteMode" ELSE NULL END,
  i."createdAt",
  i."updatedAt"
FROM "Image" i
ON CONFLICT ("relatedImageId") DO NOTHING;

-- Backfill nguồn 2: từ Video còn trong DB.
INSERT INTO "RequestLog" (
  "id", "userId", "kind", "model", "providerName", "account", "status", "costVnd",
  "aspectRatio", "resolution", "errorMessage", "batchId", "relatedVideoId",
  "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  v."userId",
  'video'::"RequestLogKind",
  v."model",
  NULL,
  v."account",
  CASE
    WHEN v."status" = 'completed' THEN 'completed'::"RequestLogStatus"
    WHEN v."status" = 'failed' THEN 'failed'::"RequestLogStatus"
    ELSE 'processing'::"RequestLogStatus"
  END,
  v."costVnd",
  v."aspectRatio",
  v."resolution",
  v."errorMessage",
  NULL,
  v."id",
  v."createdAt",
  v."updatedAt"
FROM "Video" v
ON CONFLICT ("relatedVideoId") DO NOTHING;

-- Backfill nguồn 3: từ ImageUsage mà ảnh gốc đã bị hard-delete (không còn trong Image).
-- Cứu các request đã mất dòng Image (vd ca xóa vĩnh viễn), đánh dấu hard-delete.
INSERT INTO "RequestLog" (
  "id", "userId", "kind", "model", "providerName", "account", "status", "costVnd",
  "relatedImageId", "mediaDeletedAt", "mediaDeleteMode", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  u."userId",
  u."kind"::text::"RequestLogKind",
  u."model",
  u."providerName",
  NULL,
  'completed'::"RequestLogStatus",
  u."costVnd",
  u."imageId",
  u."createdAt",
  'hard'::"RequestDeleteMode",
  u."createdAt",
  u."createdAt"
FROM "ImageUsage" u
LEFT JOIN "Image" i ON i."id" = u."imageId"
WHERE u."imageId" IS NOT NULL AND i."id" IS NULL
ON CONFLICT ("relatedImageId") DO NOTHING;
