-- Remediation pass driven by docs/VERIFICATION-REPORT.md. Combines several
-- launch-blocking/high-value gaps into one migration:
--   * Invoice.lateFineAmount + LateFeePolicy (Fee & Finance late-fine calc)
--   * GradingBand (per-tenant configurable percentage->letter-grade bands)
--   * ReportCardBatchJob (DB-backed background job for bulk report cards —
--     no Redis/BullMQ exists in this deployment; see docs/DEPLOYMENT.md)
--   * TransferCertificate (SIS leaving-certificate generation)
--   * PRINCIPAL role, Student.rollNumber/contactPhone, Tenant.logoUrl,
--     and the composite indexes flagged in the verification report
--     (students(tenantId, fullName), invoices(tenantId, issueDate),
--     staff_profiles(tenantId, status)).

-- CreateEnum
CREATE TYPE "TransferCertificateReason" AS ENUM ('PARENT_REQUEST', 'RELOCATION', 'ACADEMIC', 'DISCIPLINARY', 'GRADUATED', 'OTHER');

-- CreateEnum
CREATE TYPE "ReportCardBatchJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "LateFeeType" AS ENUM ('FIXED', 'PERCENTAGE');

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'PRINCIPAL';

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "lateFineAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "students" ADD COLUMN     "contactPhone" TEXT,
ADD COLUMN     "rollNumber" TEXT;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "logoUrl" TEXT,
ADD COLUMN     "nextTcSeq" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "transfer_certificates" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "tcNumber" TEXT NOT NULL,
    "issueDate" DATE NOT NULL,
    "lastAttendanceDate" DATE,
    "reason" "TransferCertificateReason" NOT NULL,
    "conduct" TEXT,
    "remarks" TEXT,
    "issuedByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transfer_certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grading_bands" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "grade" TEXT NOT NULL,
    "minPercentage" DECIMAL(5,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "grading_bands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_card_batch_jobs" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "classId" UUID NOT NULL,
    "examId" UUID NOT NULL,
    "status" "ReportCardBatchJobStatus" NOT NULL DEFAULT 'PENDING',
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "processedCount" INTEGER NOT NULL DEFAULT 0,
    "resultFileUrl" TEXT,
    "errorMessage" TEXT,
    "requestedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "report_card_batch_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "late_fee_policies" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "graceDays" INTEGER NOT NULL DEFAULT 0,
    "fineType" "LateFeeType" NOT NULL,
    "fineValue" DECIMAL(12,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "late_fee_policies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "transfer_certificates_tenantId_idx" ON "transfer_certificates"("tenantId");

-- CreateIndex
CREATE INDEX "transfer_certificates_tenantId_studentId_idx" ON "transfer_certificates"("tenantId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_certificates_tenantId_tcNumber_key" ON "transfer_certificates"("tenantId", "tcNumber");

-- CreateIndex
CREATE INDEX "grading_bands_tenantId_idx" ON "grading_bands"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "grading_bands_tenantId_grade_key" ON "grading_bands"("tenantId", "grade");

-- CreateIndex
CREATE INDEX "report_card_batch_jobs_tenantId_idx" ON "report_card_batch_jobs"("tenantId");

-- CreateIndex
CREATE INDEX "report_card_batch_jobs_tenantId_status_idx" ON "report_card_batch_jobs"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "late_fee_policies_tenantId_key" ON "late_fee_policies"("tenantId");

-- CreateIndex
CREATE INDEX "invoices_tenantId_issueDate_idx" ON "invoices"("tenantId", "issueDate");

-- CreateIndex
CREATE INDEX "staff_profiles_tenantId_status_idx" ON "staff_profiles"("tenantId", "status");

-- CreateIndex
CREATE INDEX "students_tenantId_fullName_idx" ON "students"("tenantId", "fullName");

-- CreateIndex
CREATE UNIQUE INDEX "students_tenantId_currentSectionId_rollNumber_key" ON "students"("tenantId", "currentSectionId", "rollNumber");

-- AddForeignKey
ALTER TABLE "transfer_certificates" ADD CONSTRAINT "transfer_certificates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_certificates" ADD CONSTRAINT "transfer_certificates_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_certificates" ADD CONSTRAINT "transfer_certificates_issuedByUserId_fkey" FOREIGN KEY ("issuedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grading_bands" ADD CONSTRAINT "grading_bands_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_card_batch_jobs" ADD CONSTRAINT "report_card_batch_jobs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_card_batch_jobs" ADD CONSTRAINT "report_card_batch_jobs_classId_fkey" FOREIGN KEY ("classId") REFERENCES "school_classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_card_batch_jobs" ADD CONSTRAINT "report_card_batch_jobs_examId_fkey" FOREIGN KEY ("examId") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_card_batch_jobs" ADD CONSTRAINT "report_card_batch_jobs_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "late_fee_policies" ADD CONSTRAINT "late_fee_policies_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-Level Security: every new tenant-scoped table gets the same
-- tenant-isolation policy pattern as every other table in this schema
-- (see 20260815222607_exams_grading/migration.sql for the original).
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['transfer_certificates', 'grading_bands', 'report_card_batch_jobs', 'late_fee_policies']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING ("tenantId" = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK ("tenantId" = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)',
      t || '_tenant_isolation', t
    );
  END LOOP;
END $$;
