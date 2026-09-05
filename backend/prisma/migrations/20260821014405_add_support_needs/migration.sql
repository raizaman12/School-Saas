-- CreateEnum
CREATE TYPE "SupportNeedCategory" AS ENUM ('LEARNING_SUPPORT', 'ATTENTION_FOCUS_SUPPORT', 'SPEECH_LANGUAGE_SUPPORT', 'HEARING_SUPPORT', 'VISION_SUPPORT', 'MOBILITY_PHYSICAL_SUPPORT', 'SOCIAL_EMOTIONAL_SUPPORT', 'AUTISM_SPECTRUM_SUPPORT', 'INTELLECTUAL_DEVELOPMENTAL_SUPPORT', 'GIFTED_TALENTED_SUPPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "SupportNeedStatus" AS ENUM ('ACTIVE', 'UNDER_REVIEW', 'RESOLVED', 'DISCONTINUED');

-- CreateTable
CREATE TABLE "support_needs" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "category" "SupportNeedCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "identifiedDate" DATE NOT NULL,
    "status" "SupportNeedStatus" NOT NULL DEFAULT 'ACTIVE',
    "supportProvided" TEXT NOT NULL,
    "examAccommodations" TEXT,
    "coordinatorUserId" UUID,
    "nextReviewDate" DATE,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_needs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_need_reviews" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "supportNeedId" UUID NOT NULL,
    "reviewDate" DATE NOT NULL,
    "notes" TEXT NOT NULL,
    "updatedStatus" "SupportNeedStatus",
    "reviewedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_need_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "support_needs_tenantId_studentId_idx" ON "support_needs"("tenantId", "studentId");

-- CreateIndex
CREATE INDEX "support_needs_tenantId_status_idx" ON "support_needs"("tenantId", "status");

-- CreateIndex
CREATE INDEX "support_need_reviews_tenantId_supportNeedId_idx" ON "support_need_reviews"("tenantId", "supportNeedId");

-- AddForeignKey
ALTER TABLE "support_needs" ADD CONSTRAINT "support_needs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_needs" ADD CONSTRAINT "support_needs_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_needs" ADD CONSTRAINT "support_needs_coordinatorUserId_fkey" FOREIGN KEY ("coordinatorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_needs" ADD CONSTRAINT "support_needs_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_need_reviews" ADD CONSTRAINT "support_need_reviews_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_need_reviews" ADD CONSTRAINT "support_need_reviews_supportNeedId_fkey" FOREIGN KEY ("supportNeedId") REFERENCES "support_needs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_need_reviews" ADD CONSTRAINT "support_need_reviews_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RowLevelSecurity: same tenant-isolation policy as every other tenant-scoped
-- table in this schema (see 20260815222607_exams_grading/migration.sql for
-- the original pattern).
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['support_needs', 'support_need_reviews']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING ("tenantId" = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK ("tenantId" = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)',
      t || '_tenant_isolation', t
    );
  END LOOP;
END $$;
