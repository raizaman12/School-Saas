-- Attendance becomes per-lecture instead of per-day: a student with 5
-- lectures in a day can now have 5 separate PRESENT/ABSENT records (one per
-- sectionSubjectId), each triggering its own WhatsApp message to guardians
-- (see attendance.ts's POST / handler). The general Attendance page's
-- whole-section/whole-day flow (no specific lecture) keeps behaving exactly
-- as before — see the partial unique index below.

-- AddColumn
ALTER TABLE "attendance_records" ADD COLUMN "sectionSubjectId" UUID;

-- DropIndex
-- The old "one row per student per day" constraint — every existing row
-- has sectionSubjectId = NULL after the column add above, so dropping this
-- and adding the two indexes below is a zero-data-loss, zero-downtime
-- change: every existing row immediately satisfies the new partial index.
DROP INDEX "attendance_records_studentId_date_key";

-- AddForeignKey
-- SetNull (not Cascade/Restrict) — retiring a subject-section mapping
-- later must never delete attendance history, only detach which lecture a
-- past record was for. Matches this project's "never destroy history"
-- principle (see the student/staff archive migrations).
ALTER TABLE "attendance_records"
  ADD CONSTRAINT "attendance_records_sectionSubjectId_fkey"
  FOREIGN KEY ("sectionSubjectId") REFERENCES "section_subjects"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
-- Composite unique — enforces "one row per student per date per specific
-- lecture." Matches schema.prisma's @@unique([studentId, date,
-- sectionSubjectId]).
CREATE UNIQUE INDEX "attendance_records_studentId_date_sectionSubjectId_key"
  ON "attendance_records" ("studentId", "date", "sectionSubjectId");

-- CreateIndex (partial, hand-written — not expressible via Prisma's
-- declarative @@unique, same as this project's RLS policies)
-- Postgres treats every NULL in a plain composite unique constraint as
-- distinct from every other NULL, so the constraint above does NOT, by
-- itself, stop two whole-day (NULL sectionSubjectId) rows for the same
-- student+date. This partial index is what actually preserves today's "one
-- whole-day mark per student per day" behavior for the general Attendance
-- page's flow.
CREATE UNIQUE INDEX "attendance_records_student_date_whole_day_key"
  ON "attendance_records" ("studentId", "date")
  WHERE "sectionSubjectId" IS NULL;
