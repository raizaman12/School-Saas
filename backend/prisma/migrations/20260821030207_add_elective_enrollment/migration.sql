-- AlterTable
ALTER TABLE "section_subjects" ADD COLUMN     "isElective" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "student_elective_enrollments" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "sectionSubjectId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_elective_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "student_elective_enrollments_tenantId_idx" ON "student_elective_enrollments"("tenantId");

-- CreateIndex
CREATE INDEX "student_elective_enrollments_tenantId_sectionSubjectId_idx" ON "student_elective_enrollments"("tenantId", "sectionSubjectId");

-- CreateIndex
CREATE UNIQUE INDEX "student_elective_enrollments_studentId_sectionSubjectId_key" ON "student_elective_enrollments"("studentId", "sectionSubjectId");

-- AddForeignKey
ALTER TABLE "student_elective_enrollments" ADD CONSTRAINT "student_elective_enrollments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_elective_enrollments" ADD CONSTRAINT "student_elective_enrollments_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_elective_enrollments" ADD CONSTRAINT "student_elective_enrollments_sectionSubjectId_fkey" FOREIGN KEY ("sectionSubjectId") REFERENCES "section_subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-Level Security: enforce tenant isolation on the new table.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['student_elective_enrollments']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING ("tenantId" = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK ("tenantId" = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)',
      t || '_tenant_isolation', t
    );
  END LOOP;
END $$;
