-- AlterEnum
ALTER TYPE "LedgerType" ADD VALUE 'charge_video';
ALTER TYPE "LedgerType" ADD VALUE 'refund_video';

-- CreateEnum
CREATE TYPE "VideoStatus" AS ENUM ('processing', 'completed', 'failed');

-- AlterTable
ALTER TABLE "WalletLedger" ADD COLUMN "relatedVideoId" TEXT;

-- CreateTable
CREATE TABLE "Video" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "aspectRatio" TEXT,
    "resolution" TEXT,
    "durationSeconds" INTEGER,
    "mode" TEXT,
    "account" TEXT,
    "costVnd" INTEGER NOT NULL DEFAULT 5000,
    "filename" TEXT,
    "status" "VideoStatus" NOT NULL DEFAULT 'processing',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Video_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Video_userId_createdAt_idx" ON "Video"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletLedger" ADD CONSTRAINT "WalletLedger_relatedVideoId_fkey" FOREIGN KEY ("relatedVideoId") REFERENCES "Video"("id") ON DELETE SET NULL ON UPDATE CASCADE;