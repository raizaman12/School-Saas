import { Suspense, act } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import PortalStudentAttendancePage from "./page";

const studentMock = vi.fn();
const attendanceMock = vi.fn();

vi.mock("@/lib/resources/portal", () => ({
  portalApi: {
    student: (...args: unknown[]) => studentMock(...args),
    attendance: (...args: unknown[]) => attendanceMock(...args),
  },
}));

async function renderPage() {
  await act(async () => {
    render(
      <Suspense fallback={null}>
        <PortalStudentAttendancePage params={Promise.resolve({ id: "st1" })} />
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

describe("PortalStudentAttendancePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows today's marked status, summary counts, and the records table", async () => {
    mockStudent();
    attendanceMock.mockResolvedValue({
      records: [{ id: "a1", date: "2026-08-20T00:00:00.000Z", status: "PRESENT", remarks: null }],
      summary: { totalMarked: 1, counts: { PRESENT: 1 } },
      today: { date: "2026-08-21", isNonWorkingDay: false, reason: null, label: null, status: "PRESENT" },
    });

    await renderPage();

    expect(await screen.findByText(/Marked Present today/)).toBeInTheDocument();
    // The "Present: 1" summary line splits its label and count across
    // separate text/element nodes, so match each fragment rather than the
    // combined string.
    expect(screen.getAllByText("Present").length).toBeGreaterThan(0);
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("shows a non-working-day banner instead of a marked-status banner", async () => {
    mockStudent();
    attendanceMock.mockResolvedValue({
      records: [],
      summary: { totalMarked: 0, counts: {} },
      today: { date: "2026-08-22", isNonWorkingDay: true, reason: "WEEKLY_OFF", label: "Sunday", status: null },
    });

    await renderPage();

    expect(await screen.findByText(/Weekly off — Sunday/)).toBeInTheDocument();
    expect(screen.getByText(/No attendance records yet/)).toBeInTheDocument();
  });
});
