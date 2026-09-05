-- CreateEnum
CREATE TYPE "NoticeTone" AS ENUM ('GENERAL', 'IMPORTANT', 'URGENT', 'EVENT', 'HOLIDAY');

-- DropIndex
DROP INDEX "notices_tenantId_audience_idx";

-- AlterTable: add the new columns first (nullable-safe defaults), backfill
-- from the old single-value `audience` column, THEN drop it — preserves
-- every existing notice's audience/individual-only-ness instead of losing it.
ALTER TABLE "notices"
  ADD COLUMN     "audiences" "NoticeAudience"[] NOT NULL DEFAULT ARRAY[]::"NoticeAudience"[],
  ADD COLUMN     "individualOnly" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN     "tone" "NoticeTone" NOT NULL DEFAULT 'GENERAL';

UPDATE "notices"
SET "audiences" = ARRAY["audience"]::"NoticeAudience"[],
    "individualOnly" = ("audience" = 'INDIVIDUAL');

ALTER TABLE "notices"
  ALTER COLUMN "audiences" DROP DEFAULT,
  DROP COLUMN "audience";

-- CreateIndex
CREATE INDEX "notices_tenantId_individualOnly_idx" ON "notices"("tenantId", "individualOnly");
