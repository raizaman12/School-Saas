import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import TeacherTimetablePage from "./page";

const myTimetableMock = vi.fn();

// Partial mock: only academicsApi.myTimetable needs stubbing — everything
// else (formatSlotTime, the DayOfWeek type) must stay real, since
// WeeklyTimetableGrid imports those directly from this same module.
vi.mock("@/lib/resources/academics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/resources/academics")>();
  return {
    ...actual,
    academicsApi: {
      ...actual.academicsApi,
      myTimetable: (...args: unknown[]) => myTimetableMock(...args),
    },
  };
});

describe("TeacherTimetablePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders each timetable slot with the class/section and room number", async () => {
    myTimetableMock.mockResolvedValue([
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

    render(<TeacherTimetablePage />);

    expect(await screen.findByText("Mathematics")).toBeInTheDocument();
    expect(screen.getByText("Class 5 - A")).toBeInTheDocument();
    expect(screen.getByText("C9")).toBeInTheDocument();
    expect(screen.getByText("08:00–08:45")).toBeInTheDocument();
  });

  it("shows an empty state when the teacher has no assigned classes yet", async () => {
    myTimetableMock.mockResolvedValue([]);

    render(<TeacherTimetablePage />);

    expect(await screen.findByText(/hasn't built your timetable/)).toBeInTheDocument();
  });

  it("shows an error message when the timetable fails to load", async () => {
    myTimetableMock.mockRejectedValue(new Error("Network error"));

    render(<TeacherTimetablePage />);

    expect(await screen.findByText(/Failed to load timetable/)).toBeInTheDocument();
  });
});
