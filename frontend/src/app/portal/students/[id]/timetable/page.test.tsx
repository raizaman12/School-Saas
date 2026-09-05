import { Suspense, act } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import PortalStudentTimetablePage from "./page";

const studentMock = vi.fn();
const timetableMock = vi.fn();

vi.mock("@/lib/resources/portal", () => ({
  portalApi: {
    student: (...args: unknown[]) => studentMock(...args),
    timetable: (...args: unknown[]) => timetableMock(...args),
  },
}));

async function renderPage() {
  await act(async () => {
    render(
      <Suspense fallback={null}>
        <PortalStudentTimetablePage params={Promise.resolve({ id: "st1" })} />
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

describe("PortalStudentTimetablePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows teacher name, time, and room for each slot on the student's weekly grid", async () => {
    mockStudent();
    timetableMock.mockResolvedValue([
      {
        id: "slot1",
        dayOfWeek: "MONDAY",
        startTime: "1970-01-01T08:00:00.000Z",
        endTime: "1970-01-01T08:45:00.000Z",
        roomNumber: "C9",
        sectionSubject: {
          id: "ss1",
          subject: { id: "sub1", name: "Mathematics", code: "MATH" },
          teacher: { id: "t1", fullName: "Mr. Farooq" },
          section: { id: "sec1", name: "A", schoolClass: { name: "Class 5" } },
        },
      },
    ]);

    await renderPage();

    expect(await screen.findByText("Mathematics")).toBeInTheDocument();
    expect(screen.getByText("Mr. Farooq")).toBeInTheDocument();
    expect(screen.getByText("C9")).toBeInTheDocument();
    expect(screen.getByText("08:00–08:45")).toBeInTheDocument();
  });

  it("falls back to 'No teacher assigned' when a slot's subject has no teacher", async () => {
    mockStudent();
    timetableMock.mockResolvedValue([
      {
        id: "slot1",
        dayOfWeek: "TUESDAY",
        startTime: "1970-01-01T09:00:00.000Z",
        endTime: "1970-01-01T09:40:00.000Z",
        roomNumber: null,
        sectionSubject: {
          id: "ss1",
          subject: { id: "sub1", name: "Physics", code: null },
          teacher: null,
          section: { id: "sec1", name: "A", schoolClass: { name: "Class 5" } },
        },
      },
    ]);

    await renderPage();

    expect(await screen.findByText("Physics")).toBeInTheDocument();
    expect(screen.getByText("No teacher assigned")).toBeInTheDocument();
  });

  it("shows an empty state when the section has no timetable slots yet", async () => {
    mockStudent();
    timetableMock.mockResolvedValue([]);

    await renderPage();

    expect(await screen.findByText(/No timetable published/)).toBeInTheDocument();
  });
});
