import { Suspense, act } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EditStudentResultPage from "./page";

const getReportCardMock = vi.fn();
const saveMarksMock = vi.fn();

vi.mock("@/lib/resources/exams", async () => {
  const actual = await vi.importActual<typeof import("@/lib/resources/exams")>("@/lib/resources/exams");
  return {
    ...actual,
    examsApi: {
      getReportCard: (...args: unknown[]) => getReportCardMock(...args),
      saveMarks: (...args: unknown[]) => saveMarksMock(...args),
    },
  };
});

const REPORT_CARD = {
  school: null,
  exam: { id: "exam1", name: "Mid Term", academicYear: "2025-2026" },
  student: { id: "s1", studentCode: "S-001", fullName: "Ahmed Khan", section: "Class 5 - A" },
  subjects: [
    {
      examSubjectId: "es1",
      subject: "Mathematics",
      maxMarks: 100,
      passingMarks: 33,
      marksObtained: 60,
      percentage: 60,
      grade: "B",
      passed: true,
    },
  ],
  summary: { totalObtained: 60, totalMax: 100, percentage: 60, grade: "B", subjectsGraded: 1, subjectsTotal: 1, rank: 2, totalRanked: 3 },
  attendance: null,
};

async function renderPage() {
  await act(async () => {
    render(
      <Suspense fallback={null}>
        <EditStudentResultPage params={Promise.resolve({ id: "exam1", studentId: "s1" })} />
      </Suspense>,
    );
  });
}

describe("EditStudentResultPage — admin per-student marks correction", () => {
  it("prefills the current mark and saves a correction for one subject via saveMarks", async () => {
    getReportCardMock.mockResolvedValue(REPORT_CARD);
    saveMarksMock.mockResolvedValue(undefined);

    const user = userEvent.setup();
    await renderPage();

    expect(await screen.findByText("Edit results — Ahmed Khan")).toBeInTheDocument();
    expect(screen.getByText("Position 2 of 3")).toBeInTheDocument();

    const marksInput = screen.getByLabelText("Marks for Mathematics") as HTMLInputElement;
    expect(marksInput.value).toBe("60");

    await user.clear(marksInput);
    await user.type(marksInput, "75");
    await user.click(screen.getByRole("button", { name: /Save/ }));

    await waitFor(() =>
      expect(saveMarksMock).toHaveBeenCalledWith("es1", [{ studentId: "s1", marksObtained: 75, remarks: undefined }]),
    );
  });
});
