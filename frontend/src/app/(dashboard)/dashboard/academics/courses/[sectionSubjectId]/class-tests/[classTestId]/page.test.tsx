import { Suspense, act } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ClassTestMarksEntryPage from "./page";

const getRosterMock = vi.fn();
const saveMarksMock = vi.fn();

vi.mock("@/lib/resources/classTests", async () => {
  const actual = await vi.importActual<typeof import("@/lib/resources/classTests")>("@/lib/resources/classTests");
  return {
    ...actual,
    classTestsApi: {
      getRoster: (...args: unknown[]) => getRosterMock(...args),
      saveMarks: (...args: unknown[]) => saveMarksMock(...args),
    },
  };
});

async function renderPage() {
  await act(async () => {
    render(
      <Suspense fallback={null}>
        <ClassTestMarksEntryPage params={Promise.resolve({ sectionSubjectId: "ss1", classTestId: "ct1" })} />
      </Suspense>,
    );
  });
}

describe("ClassTestMarksEntryPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the whole class roster and saves entered marks", async () => {
    getRosterMock.mockResolvedValue({
      classTest: { id: "ct1", name: "Chapter 3 quiz", maxMarks: 20, passingMarks: 8, sectionSubjectId: "ss1" },
      roster: [
        { studentId: "s1", studentCode: "S-001", fullName: "Ali Raza", marksObtained: null, remarks: null, maxMarks: 20, passingMarks: 8 },
      ],
    });
    saveMarksMock.mockResolvedValue(undefined);

    const user = userEvent.setup();
    await renderPage();

    expect(await screen.findByText(/Chapter 3 quiz/)).toBeInTheDocument();
    expect(screen.getByText("Ali Raza")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Marks for Ali Raza"), "17");
    await user.click(screen.getByRole("button", { name: "Save marks" }));

    await waitFor(() =>
      expect(saveMarksMock).toHaveBeenCalledWith("ct1", [{ studentId: "s1", marksObtained: 17, remarks: undefined }]),
    );
    expect(await screen.findByText("Marks saved.")).toBeInTheDocument();
  });

  it("links back to the course page", async () => {
    getRosterMock.mockResolvedValue({
      classTest: { id: "ct1", name: "Chapter 3 quiz", maxMarks: 20, passingMarks: 8, sectionSubjectId: "ss1" },
      roster: [],
    });

    await renderPage();

    expect(await screen.findByRole("link", { name: /Back to course/ })).toHaveAttribute(
      "href",
      "/dashboard/academics/courses/ss1",
    );
  });
});
