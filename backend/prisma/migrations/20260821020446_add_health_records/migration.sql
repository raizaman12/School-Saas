-- CreateEnum
CREATE TYPE "BloodGroup" AS ENUM ('A_POSITIVE', 'A_NEGATIVE', 'B_POSITIVE', 'B_NEGATIVE', 'AB_POSITIVE', 'AB_NEGATIVE', 'O_POSITIVE', 'O_NEGATIVE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "HealthLogOutcome" AS ENUM ('RETURNED_TO_CLASS', 'SENT_HOME', 'TAKEN_TO_HOSPITAL', 'PARENT_CALLED_TO_COLLECT');

-- CreateTable
CREATE TABLE "student_health_profiles" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "bloodGroup" "BloodGroup",
    "allergies" TEXT,
    "chronicConditions" TEXT,
    "currentMedications" TEXT,
    "emergencyMedicalNotes" TEXT,
    "emergencyContactName" TEXT,
    "emergencyContactPhone" TEXT,
    "doctorName" TEXT,
    "doctorPhone" TEXT,
    "updatedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_health_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "health_log_entries" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "visitDate" DATE NOT NULL,
    "complaint" TEXT NOT NULL,
    "actionTaken" TEXT NOT NULL,
    "outcome" "HealthLogOutcome" NOT NULL DEFAULT 'RETURNED_TO_CLASS',
    "guardianNotified" BOOLEAN NOT NULL DEFAULT false,
    "guardianNotifiedAt" TIMESTAMP(3),
    "loggedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "health_log_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "student_health_profiles_studentId_key" ON "student_health_profiles"("studentId");

-- CreateIndex
CREATE INDEX "student_health_profiles_tenantId_studentId_idx" ON "student_health_profiles"("tenantId", "studentId");

-- CreateIndex
CREATE INDEX "health_log_entries_tenantId_studentId_idx" ON "health_log_entries"("tenantId", "studentId");

-- CreateIndex
CREATE INDEX "health_log_entries_tenantId_visitDate_idx" ON "health_log_entries"("tenantId", "visitDate");

-- AddForeignKey
ALTER TABLE "student_health_profiles" ADD CONSTRAINT "student_health_profiles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_health_profiles" ADD CONSTRAINT "student_health_profiles_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_health_profiles" ADD CONSTRAINT "student_health_profiles_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_log_entries" ADD CONSTRAINT "health_log_entries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_log_entries" ADD CONSTRAINT "health_log_entries_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_log_entries" ADD CONSTRAINT "health_log_entries_loggedByUserId_fkey" FOREIGN KEY ("loggedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-Level Security: enforce tenant isolation on both new tables.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['student_health_profiles', 'health_log_entries']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING ("tenantId" = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK ("tenantId" = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)',
      t || '_tenant_isolation', t
    );
  END LOOP;
END $$;
