-- AlterTable
ALTER TABLE "exam_subjects" ADD COLUMN     "marksSubmittedAt" TIMESTAMP(3),
ADD COLUMN     "marksSubmittedByUserId" UUID;

-- AlterTable
ALTER TABLE "exams" ADD COLUMN     "resultsDeadline" DATE;

-- AlterTable
ALTER TABLE "report_card_batch_jobs" ADD COLUMN     "sectionId" UUID;

-- AddForeignKey
ALTER TABLE "report_card_batch_jobs" ADD CONSTRAINT "report_card_batch_jobs_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_subjects" ADD CONSTRAINT "exam_subjects_marksSubmittedByUserId_fkey" FOREIGN KEY ("marksSubmittedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
