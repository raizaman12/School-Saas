import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import DashboardHomePage from "./page";

const mySectionSubjectsMock = vi.fn();
const staffMeMock = vi.fn();
let mockUser: { role: string; fullName: string } = { role: "SCHOOL_ADMIN", fullName: "Ali Khan" };

vi.mock("@/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ user: mockUser, tenant: { id: "t1", name: "Beaconhouse", slug: "beaconhouse" } }),
}));

vi.mock("@/lib/resources/academics", async () => {
  const actual = await vi.importActual<typeof import("@/lib/resources/academics")>("@/lib/resources/academics");
  return {
    ...actual,
    academicsApi: { mySectionSubjects: (...args: unknown[]) => mySectionSubjectsMock(...args) },
  };
});

vi.mock("@/lib/resources/staff", () => ({
  staffApi: { me: (...args: unknown[]) => staffMeMock(...args) },
}));

describe("DashboardHomePage", () => {
  it("shows the generic welcome + quick links for a non-teacher role", async () => {
    mockUser = { role: "SCHOOL_ADMIN", fullName: "Ali Khan" };
    render(<DashboardHomePage />);

    expect(await screen.findByText(/Welcome back, Ali/)).toBeInTheDocument();
    expect(mySectionSubjectsMock).not.toHaveBeenCalled();
  });

  it("shows the teacher's own course cards instead of the generic welcome banner", async () => {
    mockUser = { role: "TEACHER", fullName: "Sana Malik" };
    staffMeMock.mockResolvedValue({
      photoUrl: null,
      designation: "Senior Teacher",
      employeeCode: "EMP-004",
      user: { fullName: "Sana Malik" },
    });
    mySectionSubjectsMock.mockResolvedValue([
      {
        id: "ss1",
        subject: { id: "sub1", name: "Mathematics" },
        section: { id: "sec1", name: "A", schoolClass: { id: "c1", name: "Class 5" } },
        timetableSlots: [{ id: "slot1", dayOfWeek: "MONDAY", startTime: "08:00:00", endTime: "08:45:00", roomNumber: null }],
      },
    ]);

    render(<DashboardHomePage />);

    expect(await screen.findByText("Mathematics")).toBeInTheDocument();
    expect(screen.getByText("Class 5 - A")).toBeInTheDocument();
    expect(screen.getByText("Senior Teacher · EMP-004")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/Welcome back/)).not.toBeInTheDocument());
  });

  it("shows an empty state when the teacher has no assigned courses yet", async () => {
    mockUser = { role: "TEACHER", fullName: "Sana Malik" };
    staffMeMock.mockResolvedValue({ photoUrl: null, designation: "Teacher", employeeCode: "EMP-005", user: { fullName: "Sana Malik" } });
    mySectionSubjectsMock.mockResolvedValue([]);

    render(<DashboardHomePage />);

    expect(await screen.findByText(/No courses assigned to you yet/)).toBeInTheDocument();
  });
});
