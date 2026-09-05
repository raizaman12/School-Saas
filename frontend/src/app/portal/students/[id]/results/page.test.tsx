import { Suspense, act } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PortalStudentResultsPage from "./page";

const studentMock = vi.fn();
const examsMock = vi.fn();
const reportCardMock = vi.fn();
const examDatesheetMock = vi.fn();

vi.mock("@/lib/resources/portal", () => ({
  portalApi: {
    student: (...args: unknown[]) => studentMock(...args),
    exams: (...args: unknown[]) => examsMock(...args),
    reportCard: (...args: unknown[]) => reportCardMock(...args),
    examDatesheet: (...args: unknown[]) => examDatesheetMock(...args),
  },
}));

async function renderPage() {
  await act(async () => {
    render(
      <Suspense fallback={null}>
        <PortalStudentResultsPage params={Promise.resolve({ id: "st1" })} />
      </Suspense>,
    );
  });
}

function mockStudent() {
  studentMock.mockResolvedValue({
    id: "st1",
    studentCode: "2026-000001",
    fullName: "Hassan Iqbal",
    status: "ACTIVE",
    photoUrl: null,
    currentSection: { id: "sec1", name: "A", schoolClass: { name: "Class 5" } },
  });
}

describe("PortalStudentResultsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists exams and shows an empty state when there are none", async () => {
    mockStudent();
    examsMock.mockResolvedValue([]);

    await renderPage();

    expect(await screen.findByText(/No exams found/)).toBeInTheDocument();
  });

  it("loads and displays a report card when 'Report card' is clicked", async () => {
    mockStudent();
    examsMock.mockResolvedValue([{ id: "e1", name: "Mid-Term 2026", startDate: null, endDate: null }]);
    reportCardMock.mockResolvedValue({
      exam: { id: "e1", name: "Mid-Term 2026", academicYear: "2025-2026" },
      student: { id: "st1", studentCode: "2026-000001", fullName: "Hassan Iqbal", section: "Class 5 - A" },
      subjects: [
        { subject: "Mathematics", maxMarks: 100, passingMarks: 40, marksObtained: 85, percentage: 85, grade: "A", passed: true },
      ],
      summary: {
        totalObtained: 85,
        totalMax: 100,
        percentage: 85,
        grade: "A",
        subjectsGraded: 1,
        subjectsTotal: 1,
        rank: 2,
        totalRanked: 30,
      },
    });

    await renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /Report card/i }));

    expect(await screen.findByText("Position 2 of 30")).toBeInTheDocument();
    expect(screen.getByText("Grade A")).toBeInTheDocument();
    // "85 / 100" appears twice (the subject row and the summary total) —
    // just confirm both renders happened rather than picking one.
    expect(screen.getAllByText("85 / 100")).toHaveLength(2);
  });

  it("loads and displays the datesheet when 'Datesheet' is clicked", async () => {
    mockStudent();
    examsMock.mockResolvedValue([{ id: "e1", name: "Mid-Term 2026", startDate: null, endDate: null }]);
    examDatesheetMock.mockResolvedValue([
      { examSubjectId: "es1", subject: "Mathematics", examDate: "2026-09-10T00:00:00.000Z", startTime: "1970-01-01T09:00:00.000Z", maxMarks: 100 },
      { examSubjectId: "es2", subject: "English", examDate: "2026-09-12T00:00:00.000Z", startTime: null, maxMarks: 100 },
    ]);

    await renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /Datesheet/i }));

    expect(await screen.findByText("Mathematics")).toBeInTheDocument();
    expect(screen.getByText("English")).toBeInTheDocument();
    expect(screen.getByText(new Date("2026-09-10T00:00:00.000Z").toLocaleDateString())).toBeInTheDocument();
    expect(examDatesheetMock).toHaveBeenCalledWith("st1", "e1");
  });

  it("shows an empty state when no datesheet has been published yet", async () => {
    mockStudent();
    examsMock.mockResolvedValue([{ id: "e1", name: "Mid-Term 2026", startDate: null, endDate: null }]);
    examDatesheetMock.mockResolvedValue([]);

    await renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /Datesheet/i }));

    expect(await screen.findByText(/No datesheet has been published/)).toBeInTheDocument();
  });
});
