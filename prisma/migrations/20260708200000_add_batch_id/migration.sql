-- AlterTable
ALTER TABLE "Image" ADD COLUMN "batchId" TEXT;

-- CreateIndex
CREATE INDEX "Image_batchId_idx" ON "Image"("batchId");
