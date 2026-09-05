-- CreateEnum
CREATE TYPE "QuestionBankQuestionType" AS ENUM ('MCQ', 'SHORT_ANSWER', 'LONG_ANSWER');

-- CreateTable
CREATE TABLE "exam_paper_access_grants" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "schoolClassId" UUID NOT NULL,
    "subjectId" UUID NOT NULL,
    "teacherId" UUID NOT NULL,
    "grantedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exam_paper_access_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_bank_questions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "schoolClassId" UUID NOT NULL,
    "subjectId" UUID NOT NULL,
    "type" "QuestionBankQuestionType" NOT NULL,
    "questionText" TEXT NOT NULL,
    "chapter" TEXT,
    "marks" INTEGER NOT NULL DEFAULT 1,
    "options" JSONB,
    "correctOptionIndex" INTEGER,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "question_bank_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generated_exam_papers" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "schoolClassId" UUID NOT NULL,
    "subjectId" UUID NOT NULL,
    "chapters" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "mcqCount" INTEGER NOT NULL,
    "shortCount" INTEGER NOT NULL,
    "longCount" INTEGER NOT NULL,
    "totalMarks" INTEGER NOT NULL,
    "generatedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generated_exam_papers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generated_exam_questions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "paperId" UUID NOT NULL,
    "sourceQuestionId" UUID,
    "type" "QuestionBankQuestionType" NOT NULL,
    "questionText" TEXT NOT NULL,
    "chapter" TEXT,
    "marks" INTEGER NOT NULL,
    "options" JSONB,
    "correctOptionIndex" INTEGER,
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generated_exam_questions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "exam_paper_access_grants_tenantId_idx" ON "exam_paper_access_grants"("tenantId");

-- CreateIndex
CREATE INDEX "exam_paper_access_grants_tenantId_teacherId_idx" ON "exam_paper_access_grants"("tenantId", "teacherId");

-- CreateIndex
CREATE UNIQUE INDEX "exam_paper_access_grants_schoolClassId_subjectId_teacherId_key" ON "exam_paper_access_grants"("schoolClassId", "subjectId", "teacherId");

-- CreateIndex
CREATE INDEX "question_bank_questions_tenantId_idx" ON "question_bank_questions"("tenantId");

-- CreateIndex
CREATE INDEX "question_bank_questions_tenantId_schoolClassId_subjectId_idx" ON "question_bank_questions"("tenantId", "schoolClassId", "subjectId");

-- CreateIndex
CREATE INDEX "question_bank_questions_tenantId_schoolClassId_subjectId_ch_idx" ON "question_bank_questions"("tenantId", "schoolClassId", "subjectId", "chapter");

-- CreateIndex
CREATE INDEX "question_bank_questions_tenantId_schoolClassId_subjectId_ty_idx" ON "question_bank_questions"("tenantId", "schoolClassId", "subjectId", "type");

-- CreateIndex
CREATE INDEX "generated_exam_papers_tenantId_idx" ON "generated_exam_papers"("tenantId");

-- CreateIndex
CREATE INDEX "generated_exam_papers_tenantId_schoolClassId_subjectId_idx" ON "generated_exam_papers"("tenantId", "schoolClassId", "subjectId");

-- CreateIndex
CREATE INDEX "generated_exam_questions_tenantId_idx" ON "generated_exam_questions"("tenantId");

-- CreateIndex
CREATE INDEX "generated_exam_questions_tenantId_paperId_idx" ON "generated_exam_questions"("tenantId", "paperId");

-- AddForeignKey
ALTER TABLE "exam_paper_access_grants" ADD CONSTRAINT "exam_paper_access_grants_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_paper_access_grants" ADD CONSTRAINT "exam_paper_access_grants_schoolClassId_fkey" FOREIGN KEY ("schoolClassId") REFERENCES "school_classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_paper_access_grants" ADD CONSTRAINT "exam_paper_access_grants_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_paper_access_grants" ADD CONSTRAINT "exam_paper_access_grants_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_paper_access_grants" ADD CONSTRAINT "exam_paper_access_grants_grantedByUserId_fkey" FOREIGN KEY ("grantedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_bank_questions" ADD CONSTRAINT "question_bank_questions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_bank_questions" ADD CONSTRAINT "question_bank_questions_schoolClassId_fkey" FOREIGN KEY ("schoolClassId") REFERENCES "school_classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_bank_questions" ADD CONSTRAINT "question_bank_questions_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_bank_questions" ADD CONSTRAINT "question_bank_questions_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_exam_papers" ADD CONSTRAINT "generated_exam_papers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_exam_papers" ADD CONSTRAINT "generated_exam_papers_schoolClassId_fkey" FOREIGN KEY ("schoolClassId") REFERENCES "school_classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_exam_papers" ADD CONSTRAINT "generated_exam_papers_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_exam_papers" ADD CONSTRAINT "generated_exam_papers_generatedByUserId_fkey" FOREIGN KEY ("generatedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_exam_questions" ADD CONSTRAINT "generated_exam_questions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_exam_questions" ADD CONSTRAINT "generated_exam_questions_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "generated_exam_papers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_exam_questions" ADD CONSTRAINT "generated_exam_questions_sourceQuestionId_fkey" FOREIGN KEY ("sourceQuestionId") REFERENCES "question_bank_questions"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Enable Row Level Security (multi-tenant isolation) on new tables
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['exam_paper_access_grants', 'question_bank_questions', 'generated_exam_papers', 'generated_exam_questions']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING ("tenantId" = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK ("tenantId" = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)',
      t || '_tenant_isolation', t
    );
  END LOOP;
END $$;
