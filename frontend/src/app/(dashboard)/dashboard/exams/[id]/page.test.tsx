import { Suspense, act } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ExamDetailPage from "./page";

vi.mock("@/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "admin1", role: "SCHOOL_ADMIN", fullName: "Admin" } }),
}));

const listMock = vi.fn();
const listSubjectsMock = vi.fn();
const setResultsDeadlineMock = vi.fn();
const submissionStatusMock = vi.fn();
const sectionResultsMock = vi.fn();
const createBatchMock = vi.fn();
const getBatchMock = vi.fn();
const bulkSetDatesheetMock = vi.fn();

vi.mock("@/lib/resources/exams", async () => {
  const actual = await vi.importActual<typeof import("@/lib/resources/exams")>("@/lib/resources/exams");
  return {
    ...actual,
    examsApi: {
      list: (...args: unknown[]) => listMock(...args),
      listSubjects: (...args: unknown[]) => listSubjectsMock(...args),
      setResultsDeadline: (...args: unknown[]) => setResultsDeadlineMock(...args),
      submissionStatus: (...args: unknown[]) => submissionStatusMock(...args),
      sectionResults: (...args: unknown[]) => sectionResultsMock(...args),
      createBatch: (...args: unknown[]) => createBatchMock(...args),
      getBatch: (...args: unknown[]) => getBatchMock(...args),
      bulkSetDatesheet: (...args: unknown[]) => bulkSetDatesheetMock(...args),
    },
  };
});

const listClassesMock = vi.fn();
const listSectionsMock = vi.fn();
const listSectionSubjectsMock = vi.fn();

vi.mock("@/lib/resources/academics", async () => {
  const actual = await vi.importActual<typeof import("@/lib/resources/academics")>("@/lib/resources/academics");
  return {
    ...actual,
    academicsApi: {
      listClasses: (...args: unknown[]) => listClassesMock(...args),
      listSections: (...args: unknown[]) => listSectionsMock(...args),
      listSectionSubjects: (...args: unknown[]) => listSectionSubjectsMock(...args),
    },
  };
});

vi.mock("@/lib/resources/students", () => ({
  studentsApi: { list: vi.fn().mockResolvedValue({ data: [], meta: { page: 1, limit: 8, total: 0, totalPages: 1 } }) },
}));

// Stubbed with a button that fires onChange with a fixed section — the
// cascade's own year->class->section logic is covered by its own tests;
// here we only need GenerateResultsCard/BatchReportCards to react to a pick.
vi.mock("@/components/domain/SectionCascadeSelect", () => ({
  SectionCascadeSelect: ({ onChange }: { onChange: (v: { sectionId: string } | null) => void }) => (
    <button type="button" onClick={() => onChange({ sectionId: "sec1" } as never)}>
      Pick Class 5 - A
    </button>
  ),
}));

const EXAM = { id: "exam1", name: "Mid Term", academicYearId: "y1", startDate: null, endDate: null, resultsDeadline: null, createdAt: "2026-01-01" };

async function renderPage() {
  await act(async () => {
    render(
      <Suspense fallback={null}>
        <ExamDetailPage params={Promise.resolve({ id: "exam1" })} />
      </Suspense>,
    );
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  listMock.mockResolvedValue([EXAM]);
  listSubjectsMock.mockResolvedValue([]);
  listClassesMock.mockResolvedValue([{ id: "c1", name: "Class 5", order: 5 }]);
  listSectionsMock.mockResolvedValue([]);
  listSectionSubjectsMock.mockResolvedValue([]);
  submissionStatusMock.mockResolvedValue([]);
});

describe("ExamDetailPage — results deadline", () => {
  it("sets and clears the results deadline", async () => {
    setResultsDeadlineMock.mockResolvedValue({ ...EXAM, resultsDeadline: "2026-09-01" });
    const user = userEvent.setup();
    await renderPage();

    await screen.findByText("Mid Term");
    const dateInput = screen.getByLabelText("Results deadline");
    await user.type(dateInput, "2026-09-01");
    await user.click(screen.getByRole("button", { name: "Save deadline" }));

    await waitFor(() => expect(setResultsDeadlineMock).toHaveBeenCalledWith("exam1", "2026-09-01"));
  });
});

describe("ExamDetailPage — marks submission status", () => {
  it("shows a pending-count banner and the per-subject table", async () => {
    submissionStatusMock.mockResolvedValue([
      {
        examSubjectId: "es1",
        subject: "Mathematics",
        section: "Class 5 - A",
        teacher: { id: "t1", fullName: "Mr. Khan" },
        totalStudents: 30,
        marksEnteredCount: 10,
        submitted: false,
        submittedAt: null,
        submittedBy: null,
      },
    ]);
    await renderPage();

    expect(await screen.findByText(/1 of 1 subject/)).toBeInTheDocument();
    expect(screen.getByText("Mathematics")).toBeInTheDocument();
    expect(screen.getByText("Mr. Khan")).toBeInTheDocument();
    expect(screen.getByText("10 / 30")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });
});

describe("ExamDetailPage — datesheet builder", () => {
  it("builds a datesheet for a section — default marks pre-filled, saves via the bulk endpoint", async () => {
    listSectionSubjectsMock.mockResolvedValue([
      { id: "ss1", subject: { id: "sub1", name: "Mathematics", code: null }, teacher: { id: "t1", fullName: "Mr. Khan", email: "a@a.com" }, isElective: false },
    ]);
    bulkSetDatesheetMock.mockResolvedValue([]);
    const user = userEvent.setup();
    await renderPage();

    await screen.findByText("Mid Term");
    await user.click(screen.getByRole("button", { name: "Build datesheet" }));
    const cascadeButtons = await screen.findAllByRole("button", { name: "Pick Class 5 - A" });
    await user.click(cascadeButtons[0]);

    await screen.findByText("Mathematics — Mr. Khan");
    expect(screen.getByLabelText("Max marks for Mathematics — Mr. Khan")).toHaveValue(100);
    expect(screen.getByLabelText("Passing marks for Mathematics — Mr. Khan")).toHaveValue(40);

    const saveButton = screen.getByRole("button", { name: "Save datesheet" });
    expect(saveButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Exam date for Mathematics — Mr. Khan"), { target: { value: "2026-09-10" } });
    expect(saveButton).not.toBeDisabled();
    await user.click(saveButton);

    await waitFor(() =>
      expect(bulkSetDatesheetMock).toHaveBeenCalledWith("exam1", {
        sectionId: "sec1",
        subjects: [{ sectionSubjectId: "ss1", examDate: "2026-09-10", startTime: undefined, maxMarks: 100, passingMarks: 40 }],
      }),
    );
    expect(await screen.findByText(/Datesheet saved/)).toBeInTheDocument();
  });

  it("pre-fills existing dates when reopening an already-scheduled section", async () => {
    listSectionSubjectsMock.mockResolvedValue([
      { id: "ss1", subject: { id: "sub1", name: "Mathematics", code: null }, teacher: null, isElective: false },
    ]);
    listSubjectsMock.mockImplementation((examId: string, sectionId?: string) =>
      Promise.resolve(
        sectionId
          ? [
              {
                id: "es1",
                examId: "exam1",
                maxMarks: 100,
                passingMarks: 33,
                examDate: "2026-09-10T00:00:00.000Z",
                startTime: "1970-01-01T09:00:00.000Z",
                sectionSubject: { id: "ss1", subject: { id: "sub1", name: "Mathematics" }, section: { id: "sec1", name: "A" }, teacher: null },
              },
            ]
          : [],
      ),
    );
    const user = userEvent.setup();
    await renderPage();

    await screen.findByText("Mid Term");
    await user.click(screen.getByRole("button", { name: "Build datesheet" }));
    const cascadeButtons = await screen.findAllByRole("button", { name: "Pick Class 5 - A" });
    await user.click(cascadeButtons[0]);

    await screen.findByText("Mathematics");
    expect(screen.getByLabelText("Exam date for Mathematics")).toHaveValue("2026-09-10");
    expect(screen.getByLabelText("Start time for Mathematics")).toHaveValue("09:00");
    expect(screen.getByLabelText("Passing marks for Mathematics")).toHaveValue(33);
  });

  it("shows a 'Not scheduled' badge for subjects without an exam date, and the date for ones that have it", async () => {
    listSubjectsMock.mockResolvedValue([
      {
        id: "es1",
        examId: "exam1",
        maxMarks: 100,
        passingMarks: 40,
        examDate: null,
        startTime: null,
        sectionSubject: { id: "ss1", subject: { id: "sub1", name: "Mathematics" }, section: { id: "sec1", name: "A" }, teacher: null },
      },
      {
        id: "es2",
        examId: "exam1",
        maxMarks: 100,
        passingMarks: 40,
        examDate: "2026-09-10T00:00:00.000Z",
        startTime: null,
        sectionSubject: { id: "ss2", subject: { id: "sub2", name: "English" }, section: { id: "sec1", name: "A" }, teacher: null },
      },
    ]);
    await renderPage();

    await screen.findByText("Mathematics");
    expect(screen.getByText("Not scheduled")).toBeInTheDocument();
    expect(screen.getByText(new Date("2026-09-10T00:00:00.000Z").toLocaleDateString())).toBeInTheDocument();
  });
});

describe("ExamDetailPage — generate result", () => {
  it("loads a ranked section results list with View/Edit links after picking a section", async () => {
    sectionResultsMock.mockResolvedValue([
      {
        studentId: "s1",
        studentCode: "S-001",
        fullName: "Ahmed Khan",
        totalObtained: 90,
        totalMax: 100,
        percentage: 90,
        grade: "A+",
        subjectsGraded: 1,
        subjectsTotal: 1,
        rank: 1,
        totalRanked: 2,
      },
    ]);

    const user = userEvent.setup();
    await renderPage();

    await screen.findByText("Mid Term");
    await user.click(screen.getByRole("button", { name: "Pick Class 5 - A" }));

    await waitFor(() => expect(sectionResultsMock).toHaveBeenCalledWith("exam1", "sec1"));
    const row = (await screen.findByText("Ahmed Khan")).closest("tr")!;
    expect(within(row).getByText("1 / 2")).toBeInTheDocument();
    expect(within(row).getByText("90%")).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: /View/ })).toHaveAttribute(
      "href",
      "/dashboard/exams/exam1/report-card/s1",
    );
    expect(within(row).getByRole("link", { name: /Edit/ })).toHaveAttribute(
      "href",
      "/dashboard/exams/exam1/results/s1",
    );
  });
});
