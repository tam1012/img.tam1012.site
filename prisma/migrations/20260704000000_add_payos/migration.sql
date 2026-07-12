-- AlterEnum
ALTER TYPE "LedgerType" ADD VALUE 'topup_payos';

-- CreateEnum
CREATE TYPE "PayosStatus" AS ENUM ('pending', 'paid', 'cancelled');

-- CreateTable
CREATE TABLE "PayosOrder" (
    "orderCode" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "amountVnd" INTEGER NOT NULL,
    "status" "PayosStatus" NOT NULL DEFAULT 'pending',
    "paymentLinkId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayosOrder_pkey" PRIMARY KEY ("orderCode")
);

-- CreateIndex
CREATE INDEX "PayosOrder_userId_createdAt_idx" ON "PayosOrder"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "PayosOrder" ADD CONSTRAINT "PayosOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
