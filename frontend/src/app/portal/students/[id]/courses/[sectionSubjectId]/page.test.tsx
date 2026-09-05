import { Suspense, act } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PortalCourseDetailPage from "./page";

const coursesMock = vi.fn();
const announcementsMock = vi.fn();
const materialsMock = vi.fn();
const homeworkMock = vi.fn();
const gradesMock = vi.fn();
const attendanceMock = vi.fn();
const classTestsMock = vi.fn();

vi.mock("@/lib/resources/portal", () => ({
  portalApi: {
    courses: (...args: unknown[]) => coursesMock(...args),
    courseAnnouncements: (...args: unknown[]) => announcementsMock(...args),
    courseMaterials: (...args: unknown[]) => materialsMock(...args),
    courseHomework: (...args: unknown[]) => homeworkMock(...args),
    courseGrades: (...args: unknown[]) => gradesMock(...args),
    attendance: (...args: unknown[]) => attendanceMock(...args),
  },
}));

vi.mock("@/lib/resources/classTests", () => ({
  classTestsApi: { portalResults: (...args: unknown[]) => classTestsMock(...args) },
}));

const COURSE = {
  id: "ss1",
  subject: { id: "sub1", name: "Chemistry" },
  teacher: { id: "t1", fullName: "Mr. Farooq" },
  section: { id: "sec1", name: "B", schoolClass: { name: "Class 9" } },
};

// See portal/students/[id]/page.test.tsx's renderPage for why this must be
// wrapped in an awaited act() — params is unwrapped via React's use(), and
// its Suspense retry needs a flushed microtask to land in this environment.
async function renderPage() {
  await act(async () => {
    render(
      <Suspense fallback={null}>
        <PortalCourseDetailPage params={Promise.resolve({ id: "st1", sectionSubjectId: "ss1" })} />
      </Suspense>,
    );
  });
}

describe("PortalCourseDetailPage", () => {
  it("shows the course header and the Announcements tab by default", async () => {
    coursesMock.mockResolvedValue([COURSE]);
    announcementsMock.mockResolvedValue([
      { id: "n1", title: "Test next week", body: "Bring your calculator.", tone: "IMPORTANT", isPinned: true, publishedAt: "2026-08-10T00:00:00.000Z", publishedByUser: { id: "t1", fullName: "Mr. Farooq" } },
    ]);
    materialsMock.mockResolvedValue([]);
    homeworkMock.mockResolvedValue([]);
    gradesMock.mockResolvedValue([]);
    classTestsMock.mockResolvedValue([]);
    attendanceMock.mockResolvedValue({ records: [], summary: { totalMarked: 0, counts: {} }, today: { date: "2026-08-21", isNonWorkingDay: false, reason: null, label: null, status: null } });

    await renderPage();

    expect(await screen.findByText("Chemistry")).toBeInTheDocument();
    // Appears twice — once in the header, once as the announcement's author.
    expect(screen.getAllByText(/Mr\. Farooq/).length).toBeGreaterThanOrEqual(2);
    expect(await screen.findByText("Test next week")).toBeInTheDocument();
  });

  it("switches to the Course Material tab and shows a download link", async () => {
    coursesMock.mockResolvedValue([COURSE]);
    announcementsMock.mockResolvedValue([]);
    materialsMock.mockResolvedValue([
      { id: "m1", title: "Chapter 3 slides", fileUrl: "http://localhost:4000/uploads/t1/slides.pdf", createdAt: "2026-08-10T00:00:00.000Z", uploadedByUser: { id: "t1", fullName: "Mr. Farooq" } },
    ]);
    homeworkMock.mockResolvedValue([]);
    gradesMock.mockResolvedValue([]);
    classTestsMock.mockResolvedValue([]);
    attendanceMock.mockResolvedValue({ records: [], summary: { totalMarked: 0, counts: {} }, today: { date: "2026-08-21", isNonWorkingDay: false, reason: null, label: null, status: null } });

    const user = userEvent.setup();
    await renderPage();

    await user.click(await screen.findByRole("button", { name: /Course Material/ }));
    expect(await screen.findByText("Chapter 3 slides")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Download/ })).toHaveAttribute(
      "href",
      "http://localhost:4000/uploads/t1/slides.pdf",
    );
  });

  it("switches to the Attendance tab and shows the student's attendance summary", async () => {
    coursesMock.mockResolvedValue([COURSE]);
    announcementsMock.mockResolvedValue([]);
    materialsMock.mockResolvedValue([]);
    homeworkMock.mockResolvedValue([]);
    gradesMock.mockResolvedValue([]);
    classTestsMock.mockResolvedValue([]);
    attendanceMock.mockResolvedValue({
      records: [{ id: "a1", date: "2026-08-01T00:00:00.000Z", status: "PRESENT", remarks: null }],
      summary: { totalMarked: 1, counts: { PRESENT: 1 } },
      today: { date: "2026-08-21", isNonWorkingDay: false, reason: null, label: null, status: null },
    });

    const user = userEvent.setup();
    await renderPage();

    await user.click(await screen.findByRole("button", { name: /Attendance/ }));
    await waitFor(() => expect(screen.getByText(/Present:/)).toBeInTheDocument());
  });

  // Real feature this covers: a teacher's self-serve class tests (see the
  // teacher-side ClassTestsSection) must also be visible to the student/
  // parent portal, shown as its own list separate from formal exam grades
  // — never merged into the same table, since a class test is a distinct
  // concept that (unlike a formal exam) never counts toward the report
  // card or class ranking.
  it("shows both formal exam grades and self-serve class test results on the View Grades tab, as separate lists", async () => {
    coursesMock.mockResolvedValue([COURSE]);
    announcementsMock.mockResolvedValue([]);
    materialsMock.mockResolvedValue([]);
    homeworkMock.mockResolvedValue([]);
    gradesMock.mockResolvedValue([
      { exam: { id: "exam1", name: "Mid Term", startDate: null, endDate: null }, maxMarks: 100, passingMarks: 33, marksObtained: 87, remarks: null },
    ]);
    classTestsMock.mockResolvedValue([
      { id: "ct1", name: "Pop quiz", maxMarks: 10, passingMarks: 4, marksObtained: 9, remarks: null, createdAt: "2026-08-20T00:00:00.000Z" },
    ]);
    attendanceMock.mockResolvedValue({ records: [], summary: { totalMarked: 0, counts: {} }, today: { date: "2026-08-21", isNonWorkingDay: false, reason: null, label: null, status: null } });

    const user = userEvent.setup();
    await renderPage();

    await user.click(await screen.findByRole("button", { name: /View Grades/ }));
    expect(await screen.findByText("Mid Term")).toBeInTheDocument();
    expect(screen.getByText("87 / 100")).toBeInTheDocument();
    expect(screen.getByText("Pop quiz")).toBeInTheDocument();
    expect(screen.getByText("9 / 10")).toBeInTheDocument();
  });
});
