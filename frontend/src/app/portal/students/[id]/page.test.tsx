import { Suspense, act } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import PortalStudentDetailPage from "./page";

const studentMock = vi.fn();
const coursesMock = vi.fn();

vi.mock("@/lib/resources/portal", () => ({
  portalApi: {
    student: (...args: unknown[]) => studentMock(...args),
    courses: (...args: unknown[]) => coursesMock(...args),
  },
}));

// Params are threaded through React's use() hook — the promise resolves on
// a microtask, so the initial render (and its Suspense retry) must happen
// inside an awaited act() or the retry never flushes in this test
// environment.
async function renderPage() {
  await act(async () => {
    render(
      <Suspense fallback={null}>
        <PortalStudentDetailPage params={Promise.resolve({ id: "st1" })} />
      </Suspense>,
    );
  });
}

describe("PortalStudentDetailPage — Overview (My Courses)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a course card per subject, with the teacher's name and no GPA/progress widgets", async () => {
    studentMock.mockResolvedValue({
      id: "st1",
      studentCode: "2026-000001",
      fullName: "Hassan Iqbal",
      status: "ACTIVE",
      photoUrl: null,
      currentSection: { id: "sec1", name: "A", schoolClass: { name: "Class 5" } },
    });
    coursesMock.mockResolvedValue([
      {
        id: "ss1",
        subject: { id: "sub1", name: "Mathematics" },
        teacher: { id: "t1", fullName: "Mr. Farooq" },
        section: { id: "sec1", name: "A", schoolClass: { name: "Class 5" } },
      },
    ]);

    await renderPage();

    expect(await screen.findByText("Mathematics")).toBeInTheDocument();
    expect(screen.getByText("Mr. Farooq")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Mathematics/ })).toHaveAttribute(
      "href",
      "/portal/students/st1/courses/ss1",
    );
    expect(screen.queryByText(/Estimated GPA/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Total Inprogress/i)).not.toBeInTheDocument();
    // The Overview page shows only the student header + course list —
    // every other section (Timetable, Attendance, Results, Fees,
    // Discipline, Learning Support, Health) now has its own route (see
    // PortalSidebar) instead of being stacked on this same page.
    expect(screen.getByRole("heading", { name: "Hassan Iqbal" })).toBeInTheDocument();
    expect(screen.queryByText("Fee ledger")).not.toBeInTheDocument();
    expect(screen.queryByText("Attendance")).not.toBeInTheDocument();
  });

  it("shows an empty state when the student has no courses assigned yet", async () => {
    studentMock.mockResolvedValue({
      id: "st1",
      studentCode: "2026-000001",
      fullName: "Hassan Iqbal",
      status: "ACTIVE",
      photoUrl: null,
      currentSection: null,
    });
    coursesMock.mockResolvedValue([]);

    await renderPage();

    expect(await screen.findByText(/No courses assigned yet/)).toBeInTheDocument();
  });
});
