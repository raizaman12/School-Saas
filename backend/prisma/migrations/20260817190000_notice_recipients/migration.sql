-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NoticeAudience" ADD VALUE 'ALL_STUDENTS';
ALTER TYPE "NoticeAudience" ADD VALUE 'INDIVIDUAL';

-- CreateTable
CREATE TABLE "notice_recipients" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "noticeId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notice_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notice_recipients_tenantId_idx" ON "notice_recipients"("tenantId");

-- CreateIndex
CREATE INDEX "notice_recipients_tenantId_userId_idx" ON "notice_recipients"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "notice_recipients_noticeId_userId_key" ON "notice_recipients"("noticeId", "userId");

-- AddForeignKey
ALTER TABLE "notice_recipients" ADD CONSTRAINT "notice_recipients_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notice_recipients" ADD CONSTRAINT "notice_recipients_noticeId_fkey" FOREIGN KEY ("noticeId") REFERENCES "notices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notice_recipients" ADD CONSTRAINT "notice_recipients_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RowLevelSecurity: same tenant-isolation policy as every other tenant-scoped
-- table in this schema (see 20260815222607_exams_grading/migration.sql for
-- the original pattern).
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['notice_recipients']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING ("tenantId" = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK ("tenantId" = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)',
      t || '_tenant_isolation', t
    );
  END LOOP;
END $$;
