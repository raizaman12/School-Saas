import { Suspense, act } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import PortalStudentDisciplinePage from "./page";

const studentMock = vi.fn();
const disciplineMock = vi.fn();

vi.mock("@/lib/resources/portal", () => ({
  portalApi: {
    student: (...args: unknown[]) => studentMock(...args),
    disciplineRecords: (...args: unknown[]) => disciplineMock(...args),
  },
}));

async function renderPage() {
  await act(async () => {
    render(
      <Suspense fallback={null}>
        <PortalStudentDisciplinePage params={Promise.resolve({ id: "st1" })} />
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

describe("PortalStudentDisciplinePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows an empty state when there are no discipline records", async () => {
    mockStudent();
    disciplineMock.mockResolvedValue([]);

    await renderPage();

    expect(await screen.findByText("No discipline records.")).toBeInTheDocument();
  });

  it("renders a discipline record row with category, severity, and status", async () => {
    mockStudent();
    disciplineMock.mockResolvedValue([
      {
        id: "d1",
        incidentDate: "2026-08-10T00:00:00.000Z",
        category: "LATE_ARRIVAL",
        severity: "MINOR",
        actionTaken: "VERBAL_WARNING",
        resolved: true,
      },
    ]);

    await renderPage();

    expect(await screen.findByText("Late arrival")).toBeInTheDocument();
    expect(screen.getByText("MINOR")).toBeInTheDocument();
    expect(screen.getByText("Verbal warning")).toBeInTheDocument();
    expect(screen.getByText("Resolved")).toBeInTheDocument();
  });
});
