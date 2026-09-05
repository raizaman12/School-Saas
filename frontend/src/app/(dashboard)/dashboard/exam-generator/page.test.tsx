import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ExamGeneratorPage from "./page";

const CLASS_ID = "11111111-1111-4111-8111-111111111111";
const SUBJECT_ID = "22222222-2222-4222-8222-222222222222";
const TEACHER_ID = "33333333-3333-4333-8333-333333333333";
const GRANT_ID = "44444444-4444-4444-8444-444444444444";
const QUESTION_ID = "55555555-5555-4555-8555-555555555555";
const PAPER_ID = "66666666-6666-4666-8666-666666666666";

const listClassesMock = vi.fn().mockResolvedValue([{ id: CLASS_ID, name: "Class 5", order: 5 }]);
const listSubjectsMock = vi.fn().mockResolvedValue([{ id: SUBJECT_ID, name: "Mathematics", code: null }]);
const staffListMock = vi.fn().mockResolvedValue({
  data: [{ id: "s1", user: { id: TEACHER_ID, fullName: "Ali Raza", role: "TEACHER" } }],
  meta: { page: 1, limit: 200, total: 1, totalPages: 1 },
});

const listAccessGrantsMock = vi.fn().mockResolvedValue([]);
const myAccessGrantsMock = vi.fn().mockResolvedValue([]);
const createAccessGrantMock = vi.fn();
const removeAccessGrantMock = vi.fn();
const listQuestionsMock = vi.fn().mockResolvedValue([]);
const createQuestionMock = vi.fn();
const removeQuestionMock = vi.fn();
const chaptersSummaryMock = vi.fn().mockResolvedValue({
  chapters: [{ chapter: "Chapter 1", mcqCount: 2, shortCount: 1, longCount: 0 }],
  totals: { mcqCount: 2, shortCount: 1, longCount: 0 },
});
const generateMock = vi.fn();
const listPapersMock = vi.fn().mockResolvedValue([]);

let currentRole = "SCHOOL_ADMIN";

vi.mock("@/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ user: { role: currentRole } }),
}));

vi.mock("@/lib/resources/academics", async () => {
  const actual = await vi.importActual<typeof import("@/lib/resources/academics")>("@/lib/resources/academics");
  return {
    ...actual,
    academicsApi: {
      listClasses: (...args: unknown[]) => listClassesMock(...args),
      listSubjects: (...args: unknown[]) => listSubjectsMock(...args),
    },
  };
});

vi.mock("@/lib/resources/staff", () => ({
  staffApi: { list: (...args: unknown[]) => staffListMock(...args) },
}));

vi.mock("@/lib/resources/examGenerator", async () => {
  const actual = await vi.importActual<typeof import("@/lib/resources/examGenerator")>(
    "@/lib/resources/examGenerator",
  );
  return {
    ...actual,
    examGeneratorApi: {
      listAccessGrants: (...args: unknown[]) => listAccessGrantsMock(...args),
      myAccessGrants: (...args: unknown[]) => myAccessGrantsMock(...args),
      createAccessGrant: (...args: unknown[]) => createAccessGrantMock(...args),
      removeAccessGrant: (...args: unknown[]) => removeAccessGrantMock(...args),
      listQuestions: (...args: unknown[]) => listQuestionsMock(...args),
      createQuestion: (...args: unknown[]) => createQuestionMock(...args),
      updateQuestion: vi.fn(),
      removeQuestion: (...args: unknown[]) => removeQuestionMock(...args),
      chaptersSummary: (...args: unknown[]) => chaptersSummaryMock(...args),
      generate: (...args: unknown[]) => generateMock(...args),
      listPapers: (...args: unknown[]) => listPapersMock(...args),
      getPaper: vi.fn(),
    },
  };
});

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, downloadFile: vi.fn() };
});

async function pickClassAndSubject(user: ReturnType<typeof userEvent.setup>) {
  const classSelect = await screen.findByLabelText("Class");
  await user.selectOptions(classSelect, CLASS_ID);
  const subjectSelect = await screen.findByLabelText("Subject");
  await user.selectOptions(subjectSelect, SUBJECT_ID);
}

describe("ExamGeneratorPage", () => {
  beforeEach(() => {
    currentRole = "SCHOOL_ADMIN";
    vi.clearAllMocks();
    listClassesMock.mockResolvedValue([{ id: CLASS_ID, name: "Class 5", order: 5 }]);
    listSubjectsMock.mockResolvedValue([{ id: SUBJECT_ID, name: "Mathematics", code: null }]);
    staffListMock.mockResolvedValue({
      data: [{ id: "s1", user: { id: TEACHER_ID, fullName: "Ali Raza", role: "TEACHER" } }],
      meta: { page: 1, limit: 200, total: 1, totalPages: 1 },
    });
    listAccessGrantsMock.mockResolvedValue([]);
    myAccessGrantsMock.mockResolvedValue([]);
    listQuestionsMock.mockResolvedValue([]);
    chaptersSummaryMock.mockResolvedValue({
      chapters: [{ chapter: "Chapter 1", mcqCount: 2, shortCount: 1, longCount: 0 }],
      totals: { mcqCount: 2, shortCount: 1, longCount: 0 },
    });
    listPapersMock.mockResolvedValue([]);
  });

  it("shows the Access tab to SCHOOL_ADMIN", async () => {
    render(<ExamGeneratorPage />);
    expect(await screen.findByRole("button", { name: "Access" })).toBeInTheDocument();
  });

  it("hides the Access tab from TEACHER", async () => {
    currentRole = "TEACHER";
    render(<ExamGeneratorPage />);
    await waitFor(() => expect(listSubjectsMock).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Access" })).not.toBeInTheDocument();
  });

  describe("Access tab", () => {
    it("grants a teacher access and lists existing grants", async () => {
      listAccessGrantsMock.mockResolvedValueOnce([
        {
          id: GRANT_ID,
          schoolClassId: CLASS_ID,
          subjectId: SUBJECT_ID,
          teacherId: TEACHER_ID,
          createdAt: "2026-01-01T00:00:00Z",
          schoolClass: { id: CLASS_ID, name: "Class 5" },
          subject: { id: SUBJECT_ID, name: "Mathematics" },
          teacher: { id: TEACHER_ID, fullName: "Ali Raza", email: null },
        },
      ]);
      const user = userEvent.setup();
      render(<ExamGeneratorPage />);

      const table = await screen.findByRole("table");
      expect(within(table).getByText("Ali Raza")).toBeInTheDocument();

      createAccessGrantMock.mockResolvedValue({});
      await user.selectOptions(await screen.findByLabelText(/^Class/), CLASS_ID);
      await user.selectOptions(screen.getByLabelText(/^Subject/), SUBJECT_ID);
      await user.selectOptions(screen.getByLabelText(/^Teacher/), TEACHER_ID);
      await user.click(screen.getByRole("button", { name: "Grant access" }));

      await waitFor(() =>
        expect(createAccessGrantMock).toHaveBeenCalledWith({
          schoolClassId: CLASS_ID,
          subjectId: SUBJECT_ID,
          teacherId: TEACHER_ID,
        }),
      );
    });

    it("revokes a grant via the two-step confirm button", async () => {
      listAccessGrantsMock.mockResolvedValue([
        {
          id: GRANT_ID,
          schoolClassId: CLASS_ID,
          subjectId: SUBJECT_ID,
          teacherId: TEACHER_ID,
          createdAt: "2026-01-01T00:00:00Z",
          schoolClass: { id: CLASS_ID, name: "Class 5" },
          subject: { id: SUBJECT_ID, name: "Mathematics" },
          teacher: { id: TEACHER_ID, fullName: "Ali Raza", email: null },
        },
      ]);
      removeAccessGrantMock.mockResolvedValue({});
      const user = userEvent.setup();
      render(<ExamGeneratorPage />);

      await screen.findByRole("table");
      await user.click(screen.getByRole("button", { name: "Revoke" }));
      await user.click(screen.getByRole("button", { name: "Revoke access" }));

      await waitFor(() => expect(removeAccessGrantMock).toHaveBeenCalledWith(GRANT_ID));
    });
  });

  describe("Question Bank tab", () => {
    it("switches fields by question type and validates MCQ options before submitting", async () => {
      const user = userEvent.setup();
      render(<ExamGeneratorPage />);

      await user.click(await screen.findByRole("button", { name: "Question Bank" }));
      await pickClassAndSubject(user);

      expect(await screen.findByText("Options (mark the correct one)")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Add question" }));
      expect(await screen.findByText("Question text is required.")).toBeInTheDocument();

      const typeSelect = screen.getByLabelText("Type");
      await user.selectOptions(typeSelect, "SHORT_ANSWER");
      expect(screen.queryByText("Options (mark the correct one)")).not.toBeInTheDocument();
      expect(screen.getByLabelText(/^Marks/)).toBeInTheDocument();
    });

    it("creates a question and shows it in the table, and can delete it", async () => {
      createQuestionMock.mockResolvedValue({});
      listQuestionsMock.mockResolvedValueOnce([]).mockResolvedValue([
        {
          id: QUESTION_ID,
          schoolClassId: CLASS_ID,
          subjectId: SUBJECT_ID,
          type: "SHORT_ANSWER",
          questionText: "Define a prime number.",
          chapter: "Chapter 1",
          marks: 3,
          options: null,
          correctOptionIndex: null,
          createdAt: "2026-01-01T00:00:00Z",
          createdBy: { id: "u1", fullName: "Ali Raza" },
        },
      ]);
      removeQuestionMock.mockResolvedValue({});
      const user = userEvent.setup();
      render(<ExamGeneratorPage />);

      await user.click(await screen.findByRole("button", { name: "Question Bank" }));
      await pickClassAndSubject(user);

      await user.selectOptions(screen.getByLabelText("Type"), "SHORT_ANSWER");
      await user.type(screen.getByLabelText(/^Question text/), "Define a prime number.");
      await user.click(screen.getByRole("button", { name: "Add question" }));

      await waitFor(() => expect(createQuestionMock).toHaveBeenCalled());
      expect(await screen.findByText("Define a prime number.")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Delete" }));
      await user.click(screen.getByRole("button", { name: "Delete question" }));
      await waitFor(() => expect(removeQuestionMock).toHaveBeenCalledWith(QUESTION_ID));
    });
  });

  describe("Generate tab", () => {
    it("restricts a TEACHER's class/subject picker to their own grants", async () => {
      currentRole = "TEACHER";
      myAccessGrantsMock.mockResolvedValue([
        {
          id: GRANT_ID,
          schoolClassId: CLASS_ID,
          subjectId: SUBJECT_ID,
          teacherId: TEACHER_ID,
          createdAt: "2026-01-01T00:00:00Z",
          schoolClass: { id: CLASS_ID, name: "Class 5" },
          subject: { id: SUBJECT_ID, name: "Mathematics" },
        },
      ]);
      const user = userEvent.setup();
      render(<ExamGeneratorPage />);
      await user.click(await screen.findByRole("button", { name: "Generate" }));

      const classSelect = await screen.findByLabelText("Class");
      expect(within(classSelect).getByText("Class 5")).toBeInTheDocument();
    });

    it("shows an empty state for a TEACHER with zero grants", async () => {
      currentRole = "TEACHER";
      myAccessGrantsMock.mockResolvedValue([]);
      const user = userEvent.setup();
      render(<ExamGeneratorPage />);
      await user.click(await screen.findByRole("button", { name: "Generate" }));

      expect(await screen.findByText(/No class\/subject assigned yet/)).toBeInTheDocument();
    });

    it("renders the chapters-summary checklist with per-type counts", async () => {
      const user = userEvent.setup();
      render(<ExamGeneratorPage />);
      await user.click(await screen.findByRole("button", { name: "Generate" }));
      await pickClassAndSubject(user);

      expect(await screen.findByText(/MCQ: 2 · Short: 1 · Long: 0/)).toBeInTheDocument();
    });

    it("surfaces an insufficient-bank error inline", async () => {
      generateMock.mockRejectedValue(
        Object.assign(new Error("Not enough mcq questions in the bank for this selection"), {
          name: "ApiError",
        }),
      );
      const user = userEvent.setup();
      render(<ExamGeneratorPage />);
      await user.click(await screen.findByRole("button", { name: "Generate" }));
      await pickClassAndSubject(user);

      const mcqInput = await screen.findByLabelText("MCQ");
      await user.clear(mcqInput);
      await user.type(mcqInput, "5");
      await user.click(screen.getByRole("button", { name: "Generate Exam" }));

      await waitFor(() => expect(generateMock).toHaveBeenCalled());
    });

    it("shows the generated paper with a download button on success, and lists history with per-row download", async () => {
      generateMock.mockResolvedValue({
        id: PAPER_ID,
        schoolClassId: CLASS_ID,
        subjectId: SUBJECT_ID,
        chapters: [],
        mcqCount: 1,
        shortCount: 0,
        longCount: 0,
        totalMarks: 1,
        createdAt: "2026-01-01T00:00:00Z",
        schoolClass: { id: CLASS_ID, name: "Class 5" },
        subject: { id: SUBJECT_ID, name: "Mathematics" },
        questions: [
          {
            id: QUESTION_ID,
            type: "MCQ",
            questionText: "What is 2 + 2?",
            chapter: "Chapter 1",
            marks: 1,
            options: ["3", "4", "5", "6"],
            correctOptionIndex: 1,
            sourceQuestionId: QUESTION_ID,
            order: 0,
          },
        ],
      });
      listPapersMock.mockResolvedValueOnce([]).mockResolvedValue([
        {
          id: PAPER_ID,
          schoolClassId: CLASS_ID,
          subjectId: SUBJECT_ID,
          chapters: [],
          mcqCount: 1,
          shortCount: 0,
          longCount: 0,
          totalMarks: 1,
          createdAt: "2026-01-01T00:00:00Z",
          schoolClass: { id: CLASS_ID, name: "Class 5" },
          subject: { id: SUBJECT_ID, name: "Mathematics" },
        },
      ]);

      const user = userEvent.setup();
      render(<ExamGeneratorPage />);
      await user.click(await screen.findByRole("button", { name: "Generate" }));
      await pickClassAndSubject(user);

      const mcqInput = await screen.findByLabelText("MCQ");
      await user.clear(mcqInput);
      await user.type(mcqInput, "1");
      await user.click(screen.getByRole("button", { name: "Generate Exam" }));

      expect(await screen.findByText(/Generated paper — 1 total marks/)).toBeInTheDocument();
      expect(screen.getByText(/4 \(correct\)/)).toBeInTheDocument();
      expect(screen.getAllByRole("button", { name: /Download Exam PDF|PDF/ }).length).toBeGreaterThan(0);
    });
  });
});
