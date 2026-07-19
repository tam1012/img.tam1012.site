-- finishedAt: mốc request xong, không bị ghi đè khi user xóa media sau.
ALTER TABLE "RequestLog" ADD COLUMN "finishedAt" TIMESTAMP(3);

-- Backfill: chỉ các dòng CHƯA xóa media — updatedAt lúc này vẫn là mốc complete/fail.
-- Dòng đã xóa media: updatedAt = lúc xóa, không tin được → để null, không tính vào avg.
UPDATE "RequestLog"
SET "finishedAt" = "updatedAt"
WHERE "status" IN ('completed', 'failed')
  AND "mediaDeletedAt" IS NULL
  AND "finishedAt" IS NULL;
