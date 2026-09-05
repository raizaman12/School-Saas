import { api } from "@/lib/api";

/**
 * A teacher's own self-serve "class test" (quiz, class test, etc.) — created
 * directly from the Grades tab of one of their subjects, with no admin
 * setup required first. Deliberately a separate resource from exams.ts:
 * class tests never appear on a report card or in section ranking (see the
 * backend's classTests.ts doc comment) — that's not a filter applied here,
 * it's a completely separate data model on the server.
 */
export interface ClassTest {
  id: string;
  sectionSubjectId: string;
  name: string;
  maxMarks: number;
  passingMarks: number;
  createdAt: string;
  createdBy: { id: string; fullName: string };
  /** How many students already have a mark entered — powers the Grades tab's list, same as ExamForSectionSubject's submitted state. */
  marksEnteredCount: number;
}

export interface ClassTestRosterEntry {
  studentId: string;
  studentCode: string;
  fullName: string;
  marksObtained: number | null;
  remarks: string | null;
  maxMarks: number;
  passingMarks: number;
}

export interface ClassTestRoster {
  classTest: { id: string; name: string; maxMarks: number; passingMarks: number; sectionSubjectId: string };
  roster: ClassTestRosterEntry[];
}

/** One row on the student/parent portal's Class Tests list — see PortalCourseGrade for the formal-exam equivalent. */
export interface PortalClassTestResult {
  id: string;
  name: string;
  maxMarks: number;
  passingMarks: number;
  marksObtained: number | null;
  remarks: string | null;
  createdAt: string;
}

export const classTestsApi = {
  forSectionSubject: (sectionSubjectId: string) =>
    api
      .get<{ data: ClassTest[] }>(`/api/exams/class-tests/for-section-subject/${sectionSubjectId}`)
      .then((r) => r.data),

  create: (input: { sectionSubjectId: string; name: string; maxMarks: number; passingMarks: number }) =>
    api.post<{ data: ClassTest }>("/api/exams/class-tests", input).then((r) => r.data),

  getRoster: (classTestId: string) =>
    api.get<{ data: ClassTestRoster }>(`/api/exams/class-tests/${classTestId}/marks`).then((r) => r.data),

  saveMarks: (
    classTestId: string,
    records: { studentId: string; marksObtained: number | null; remarks?: string }[],
  ) => api.post(`/api/exams/class-tests/${classTestId}/marks`, { records }),

  // ── Student/parent portal ────────────────────────────────────────────
  portalResults: (studentId: string, sectionSubjectId: string) =>
    api
      .get<{ data: PortalClassTestResult[] }>(
        `/api/portal/students/${studentId}/courses/${sectionSubjectId}/class-tests`,
      )
      .then((r) => r.data),
};
