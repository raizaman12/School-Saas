import { api } from "@/lib/api";

export interface Exam {
  id: string;
  name: string;
  academicYearId: string;
  startDate: string | null;
  endDate: string | null;
  /** Admin-set date by which subject teachers should submit marks — informational, not enforced. */
  resultsDeadline: string | null;
  createdAt: string;
}

export interface ExamSubject {
  id: string;
  examId: string;
  maxMarks: number;
  passingMarks: number;
  /** The datesheet itself — which day (and, optionally, what time) this paper is held. Null until the admin sets it via bulkSetDatesheet. */
  examDate: string | null;
  startTime: string | null;
  marksSubmittedAt?: string | null;
  marksSubmittedBy?: { id: string; fullName: string } | null;
  sectionSubject: {
    id: string;
    subject: { id: string; name: string };
    section: { id: string; name: string };
    teacher: { id: string; fullName: string } | null;
  };
}

/** One row of the teacher subject page's "Grades" tab — an exam this course has been added to. */
export interface ExamForSectionSubject {
  id: string; // examSubjectId
  maxMarks: number;
  passingMarks: number;
  marksSubmittedAt: string | null;
  marksSubmittedBy: { id: string; fullName: string } | null;
  exam: Exam;
}

export interface SectionExamResultRow {
  studentId: string;
  studentCode: string;
  fullName: string;
  totalObtained: number;
  totalMax: number;
  percentage: number | null;
  grade: string | null;
  subjectsGraded: number;
  subjectsTotal: number;
  rank: number | null;
  totalRanked: number;
}

export interface SubmissionStatusRow {
  examSubjectId: string;
  subject: string;
  section: string;
  teacher: { id: string; fullName: string } | null;
  totalStudents: number;
  marksEnteredCount: number;
  submitted: boolean;
  submittedAt: string | null;
  submittedBy: { id: string; fullName: string } | null;
}

export interface MarkRosterEntry {
  studentId: string;
  studentCode: string;
  fullName: string;
  marksObtained: number | null;
  remarks: string | null;
  maxMarks: number;
  passingMarks: number;
}

export interface GradingBand {
  id: string;
  grade: string;
  minPercentage: string;
  sortOrder: number;
}

export interface ReportCardSubject {
  examSubjectId: string;
  subject: string;
  maxMarks: number;
  passingMarks: number;
  marksObtained: number | null;
  percentage: number | null;
  grade: string | null;
  passed: boolean | null;
}

export interface ReportCard {
  school: { name: string; logoUrl: string | null } | null;
  exam: { id: string; name: string; academicYear: string };
  student: { id: string; studentCode: string; fullName: string; section: string | null };
  subjects: ReportCardSubject[];
  summary: {
    totalObtained: number;
    totalMax: number;
    percentage: number | null;
    grade: string | null;
    subjectsGraded: number;
    subjectsTotal: number;
    /** Class position among ranked students in this section for this exam — null if not currently enrolled/ranked. */
    rank: number | null;
    totalRanked: number;
  };
  attendance: { present: number; absent: number; leave: number; totalMarked: number } | null;
}

export type ReportCardBatchStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";

export interface ReportCardBatchJob {
  id: string;
  examId: string;
  classId: string;
  status: ReportCardBatchStatus;
  totalCount: number;
  processedCount: number;
  resultFileUrl: string | null;
  errorMessage: string | null;
}

export const examsApi = {
  list: (params: { academicYearId?: string } = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][],
    ).toString();
    return api.get<{ data: Exam[] }>(`/api/exams${qs ? `?${qs}` : ""}`).then((r) => r.data);
  },
  create: (input: { academicYearId: string; name: string; startDate?: string; endDate?: string }) =>
    api.post<{ data: Exam }>("/api/exams", input).then((r) => r.data),
  setResultsDeadline: (examId: string, resultsDeadline: string | null) =>
    api.patch<{ data: Exam }>(`/api/exams/${examId}`, { resultsDeadline }).then((r) => r.data),

  examsForSectionSubject: (sectionSubjectId: string) =>
    api
      .get<{ data: ExamForSectionSubject[] }>(`/api/exams/for-section-subject/${sectionSubjectId}`)
      .then((r) => r.data),
  submitMarks: (examSubjectId: string) =>
    api.post<{ data: ExamSubject }>(`/api/exams/subjects/${examSubjectId}/submit`).then((r) => r.data),
  unsubmitMarks: (examSubjectId: string) =>
    api.post<{ data: ExamSubject }>(`/api/exams/subjects/${examSubjectId}/unsubmit`).then((r) => r.data),
  submissionStatus: (examId: string) =>
    api.get<{ data: SubmissionStatusRow[] }>(`/api/exams/${examId}/submission-status`).then((r) => r.data),
  sectionResults: (examId: string, sectionId: string) =>
    api
      .get<{ data: SectionExamResultRow[] }>(`/api/exams/${examId}/results?${new URLSearchParams({ sectionId })}`)
      .then((r) => r.data),

  listSubjects: (examId: string, sectionId?: string) => {
    const qs = sectionId ? `?sectionId=${sectionId}` : "";
    return api.get<{ data: ExamSubject[] }>(`/api/exams/${examId}/subjects${qs}`).then((r) => r.data);
  },
  addSubject: (examId: string, input: { sectionSubjectId: string; maxMarks: number; passingMarks: number }) =>
    api.post<{ data: ExamSubject }>(`/api/exams/${examId}/subjects`, input).then((r) => r.data),
  /** Builds (or edits) a whole class's exam datesheet in one call — one row per subject, each getting its own date/time. Re-running it for the same exam+section edits the existing rows instead of duplicating them. */
  bulkSetDatesheet: (
    examId: string,
    input: {
      sectionId: string;
      subjects: {
        sectionSubjectId: string;
        examDate: string;
        startTime?: string;
        maxMarks: number;
        passingMarks: number;
      }[];
    },
  ) => api.post<{ data: ExamSubject[] }>(`/api/exams/${examId}/subjects/bulk`, input).then((r) => r.data),

  getRoster: (examSubjectId: string) =>
    api.get<{ data: MarkRosterEntry[] }>(`/api/exams/subjects/${examSubjectId}/marks`).then((r) => r.data),
  saveMarks: (examSubjectId: string, records: { studentId: string; marksObtained: number | null; remarks?: string }[]) =>
    api.post(`/api/exams/subjects/${examSubjectId}/marks`, { records }),

  getReportCard: (examId: string, studentId: string) =>
    api.get<{ data: ReportCard }>(`/api/exams/${examId}/report-card/${studentId}`).then((r) => r.data),

  createBatch: (examId: string, classId: string, sectionId?: string) =>
    api
      .post<{ data: ReportCardBatchJob }>(`/api/exams/${examId}/report-card-batches`, { classId, sectionId })
      .then((r) => r.data),
  getBatch: (jobId: string) =>
    api.get<{ data: ReportCardBatchJob }>(`/api/exams/report-card-batches/${jobId}`).then((r) => r.data),

  listGradingBands: () => api.get<{ data: GradingBand[] }>("/api/grading-bands").then((r) => r.data),
  replaceGradingBands: (bands: { grade: string; minPercentage: number }[]) =>
    api.put<{ data: GradingBand[] }>("/api/grading-bands", { bands }).then((r) => r.data),
};
