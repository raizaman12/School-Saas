-- CreateTable
CREATE TABLE "class_tests" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "sectionSubjectId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "maxMarks" INTEGER NOT NULL,
    "passingMarks" INTEGER NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "class_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_test_marks" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "classTestId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "marksObtained" DOUBLE PRECISION,
    "remarks" TEXT,
    "enteredByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "class_test_marks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "class_tests_tenantId_idx" ON "class_tests"("tenantId");

-- CreateIndex
CREATE INDEX "class_tests_tenantId_sectionSubjectId_idx" ON "class_tests"("tenantId", "sectionSubjectId");

-- CreateIndex
CREATE INDEX "class_test_marks_tenantId_idx" ON "class_test_marks"("tenantId");

-- CreateIndex
CREATE INDEX "class_test_marks_tenantId_studentId_idx" ON "class_test_marks"("tenantId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "class_test_marks_classTestId_studentId_key" ON "class_test_marks"("classTestId", "studentId");

-- AddForeignKey
ALTER TABLE "class_tests" ADD CONSTRAINT "class_tests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_tests" ADD CONSTRAINT "class_tests_sectionSubjectId_fkey" FOREIGN KEY ("sectionSubjectId") REFERENCES "section_subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_tests" ADD CONSTRAINT "class_tests_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_test_marks" ADD CONSTRAINT "class_test_marks_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_test_marks" ADD CONSTRAINT "class_test_marks_classTestId_fkey" FOREIGN KEY ("classTestId") REFERENCES "class_tests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_test_marks" ADD CONSTRAINT "class_test_marks_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_test_marks" ADD CONSTRAINT "class_test_marks_enteredByUserId_fkey" FOREIGN KEY ("enteredByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Row-Level Security: enforce tenant isolation on the new tables.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['class_tests', 'class_test_marks']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING ("tenantId" = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK ("tenantId" = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)',
      t || '_tenant_isolation', t
    );
  END LOOP;
END $$;
