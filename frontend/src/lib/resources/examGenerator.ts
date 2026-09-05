import { api } from "@/lib/api";

/**
 * Deterministic, no-AI exam paper generator: admin-granted TEACHER access
 * per (Class, Subject), a shared tenant-wide question bank, and random
 * selection into an immutable generated paper. See the backend's
 * examGenerator module doc comments for the full design.
 */

export type QuestionType = "MCQ" | "SHORT_ANSWER" | "LONG_ANSWER";

export interface AccessGrant {
  id: string;
  schoolClassId: string;
  subjectId: string;
  teacherId: string;
  createdAt: string;
  schoolClass: { id: string; name: string };
  subject: { id: string; name: string };
  teacher?: { id: string; fullName: string; email: string | null };
}

export interface BankQuestion {
  id: string;
  schoolClassId: string;
  subjectId: string;
  type: QuestionType;
  questionText: string;
  chapter: string | null;
  marks: number;
  options: string[] | null;
  correctOptionIndex: number | null;
  createdAt: string;
  createdBy: { id: string; fullName: string };
}

export interface ChapterSummaryRow {
  chapter: string | null;
  mcqCount: number;
  shortCount: number;
  longCount: number;
}

export interface ChaptersSummary {
  chapters: ChapterSummaryRow[];
  totals: { mcqCount: number; shortCount: number; longCount: number };
}

export interface GeneratedPaperQuestion {
  id: string;
  type: QuestionType;
  questionText: string;
  chapter: string | null;
  marks: number;
  options: string[] | null;
  // Present in the generating teacher's own reference copy — never sent
  // to the printed PDF (see the backend's examPaperPdf.ts, whose type
  // structurally excludes this field).
  correctOptionIndex: number | null;
  sourceQuestionId: string | null;
  order: number;
}

export interface GeneratedPaper {
  id: string;
  schoolClassId: string;
  subjectId: string;
  chapters: string[];
  mcqCount: number;
  shortCount: number;
  longCount: number;
  totalMarks: number;
  createdAt: string;
  schoolClass: { id: string; name: string };
  subject: { id: string; name: string };
  generatedBy?: { id: string; fullName: string };
  questions?: GeneratedPaperQuestion[];
}

export const examGeneratorApi = {
  // ── Access grants ──────────────────────────────────────────────────
  listAccessGrants: () => api.get<{ data: AccessGrant[] }>("/api/exam-generator/access-grants").then((r) => r.data),
  myAccessGrants: () =>
    api.get<{ data: AccessGrant[] }>("/api/exam-generator/access-grants/me").then((r) => r.data),
  createAccessGrant: (input: { schoolClassId: string; subjectId: string; teacherId: string }) =>
    api.post<{ data: AccessGrant }>("/api/exam-generator/access-grants", input).then((r) => r.data),
  removeAccessGrant: (id: string) => api.delete(`/api/exam-generator/access-grants/${id}`),

  // ── Question bank ─────────────────────────────────────────────────
  listQuestions: (params: { schoolClassId?: string; subjectId?: string; chapter?: string; type?: QuestionType } = {}) => {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v) search.set(k, v);
    });
    const qs = search.toString();
    return api
      .get<{ data: BankQuestion[] }>(`/api/exam-generator/questions${qs ? `?${qs}` : ""}`)
      .then((r) => r.data);
  },
  createQuestion: (input: {
    schoolClassId: string;
    subjectId: string;
    type: QuestionType;
    questionText: string;
    chapter?: string;
    marks?: number;
    options?: string[];
    correctOptionIndex?: number;
  }) => api.post<{ data: BankQuestion }>("/api/exam-generator/questions", input).then((r) => r.data),
  updateQuestion: (
    id: string,
    input: Partial<{
      questionText: string;
      chapter: string | null;
      marks: number;
      options: string[];
      correctOptionIndex: number;
    }>,
  ) => api.patch<{ data: BankQuestion }>(`/api/exam-generator/questions/${id}`, input).then((r) => r.data),
  removeQuestion: (id: string) => api.delete(`/api/exam-generator/questions/${id}`),
  chaptersSummary: (schoolClassId: string, subjectId: string) =>
    api
      .get<{ data: ChaptersSummary }>(
        `/api/exam-generator/questions/chapters-summary?schoolClassId=${schoolClassId}&subjectId=${subjectId}`,
      )
      .then((r) => r.data),

  // ── Generate ───────────────────────────────────────────────────────
  generate: (input: {
    schoolClassId: string;
    subjectId: string;
    chapters?: string[];
    mcqCount: number;
    shortCount: number;
    longCount: number;
  }) => api.post<{ data: GeneratedPaper }>("/api/exam-generator/papers/generate", input).then((r) => r.data),
  listPapers: (schoolClassId?: string, subjectId?: string) => {
    const search = new URLSearchParams();
    if (schoolClassId) search.set("schoolClassId", schoolClassId);
    if (subjectId) search.set("subjectId", subjectId);
    const qs = search.toString();
    return api.get<{ data: GeneratedPaper[] }>(`/api/exam-generator/papers${qs ? `?${qs}` : ""}`).then((r) => r.data);
  },
  getPaper: (id: string) => api.get<{ data: GeneratedPaper }>(`/api/exam-generator/papers/${id}`).then((r) => r.data),
  // PDF download is a direct downloadFile(...) call from the page
  // component, matching every other PDF button in the app — not wrapped
  // here.
};
