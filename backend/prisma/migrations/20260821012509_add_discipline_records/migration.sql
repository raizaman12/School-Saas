-- CreateEnum
CREATE TYPE "DisciplineCategory" AS ENUM ('UNIFORM_VIOLATION', 'LATE_ARRIVAL', 'MISSED_HOMEWORK', 'DISRUPTIVE_BEHAVIOR', 'DISRESPECT_TO_STAFF', 'BULLYING', 'FIGHTING', 'CHEATING', 'PROPERTY_DAMAGE', 'UNAUTHORIZED_ABSENCE', 'MOBILE_PHONE_VIOLATION', 'OTHER');

-- CreateEnum
CREATE TYPE "DisciplineSeverity" AS ENUM ('MINOR', 'MODERATE', 'MAJOR');

-- CreateEnum
CREATE TYPE "DisciplineAction" AS ENUM ('NONE', 'VERBAL_WARNING', 'WRITTEN_WARNING', 'DETENTION', 'PARENT_CALLED', 'PARENT_MEETING_REQUIRED', 'SUSPENSION', 'REFERRED_TO_PRINCIPAL');

-- CreateTable
CREATE TABLE "discipline_records" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "incidentDate" DATE NOT NULL,
    "category" "DisciplineCategory" NOT NULL,
    "severity" "DisciplineSeverity" NOT NULL,
    "description" TEXT NOT NULL,
    "actionTaken" "DisciplineAction" NOT NULL DEFAULT 'NONE',
    "actionNotes" TEXT,
    "reportedByUserId" UUID NOT NULL,
    "guardianNotified" BOOLEAN NOT NULL DEFAULT false,
    "guardianNotifiedAt" TIMESTAMP(3),
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "resolvedNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discipline_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "discipline_records_tenantId_studentId_idx" ON "discipline_records"("tenantId", "studentId");

-- CreateIndex
CREATE INDEX "discipline_records_tenantId_incidentDate_idx" ON "discipline_records"("tenantId", "incidentDate");

-- AddForeignKey
ALTER TABLE "discipline_records" ADD CONSTRAINT "discipline_records_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discipline_records" ADD CONSTRAINT "discipline_records_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discipline_records" ADD CONSTRAINT "discipline_records_reportedByUserId_fkey" FOREIGN KEY ("reportedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RowLevelSecurity: same tenant-isolation policy as every other tenant-scoped
-- table in this schema (see 20260815222607_exams_grading/migration.sql for
-- the original pattern).
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['discipline_records']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING ("tenantId" = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK ("tenantId" = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)',
      t || '_tenant_isolation', t
    );
  END LOOP;
END $$;
