-- AlterEnum
-- New value only ("delete a student" now means archive them — see
-- sis/students.ts's DELETE handler and StudentStatus's doc comment in
-- schema.prisma). Not used within this same migration file, so this is
-- safe to run as a single statement (Postgres disallows using a
-- newly-added enum value in the same transaction it was added in).
ALTER TYPE "StudentStatus" ADD VALUE 'ARCHIVED';
