-- CreateEnum
CREATE TYPE "ImageUsageKind" AS ENUM ('generate', 'edit');

-- CreateTable
CREATE TABLE "ImageUsage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "imageId" TEXT,
    "kind" "ImageUsageKind" NOT NULL,
    "model" TEXT NOT NULL,
    "providerName" TEXT NOT NULL,
    "costVnd" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImageUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ImageUsage_imageId_key" ON "ImageUsage"("imageId");

-- CreateIndex
CREATE INDEX "ImageUsage_userId_createdAt_idx" ON "ImageUsage"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ImageUsage_createdAt_idx" ON "ImageUsage"("createdAt");

-- CreateIndex
CREATE INDEX "ImageUsage_model_createdAt_idx" ON "ImageUsage"("model", "createdAt");

-- AddForeignKey
ALTER TABLE "ImageUsage" ADD CONSTRAINT "ImageUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill từ ảnh còn trong DB (completed + soft-deleted). Ảnh hard-delete trước đây không cứu được.
INSERT INTO "ImageUsage" ("id", "userId", "imageId", "kind", "model", "providerName", "costVnd", "createdAt")
SELECT
  gen_random_uuid()::text,
  i."userId",
  i."id",
  CASE
    WHEN i."editPrompt" IS NOT NULL OR i."originalImageId" IS NOT NULL THEN 'edit'::"ImageUsageKind"
    ELSE 'generate'::"ImageUsageKind"
  END,
  i."model",
  i."providerName",
  i."costVnd",
  i."createdAt"
FROM "Image" i
WHERE i."status" IN ('completed', 'deleted')
ON CONFLICT ("imageId") DO NOTHING;
