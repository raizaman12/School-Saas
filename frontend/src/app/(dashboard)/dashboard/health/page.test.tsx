import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import HealthPage from "./page";

const listLogMock = vi.fn().mockResolvedValue({
  data: [],
  meta: { page: 1, limit: 20, total: 0, totalPages: 1 },
});
const createLogMock = vi.fn();
const getProfileMock = vi.fn().mockResolvedValue(null);
const saveProfileMock = vi.fn();
const STUDENT_ID = "11111111-1111-4111-8111-111111111111";
const studentsListMock = vi.fn().mockResolvedValue({
  data: [{ id: STUDENT_ID, studentCode: "TS-2026-000001", fullName: "Hassan Iqbal" }],
  meta: { page: 1, limit: 8, total: 1, totalPages: 1 },
});

vi.mock("@/lib/resources/health", async () => {
  const actual = await vi.importActual<typeof import("@/lib/resources/health")>("@/lib/resources/health");
  return {
    ...actual,
    healthApi: {
      listLogEntries: (...args: unknown[]) => listLogMock(...args),
      getLogEntry: vi.fn(),
      createLogEntry: (...args: unknown[]) => createLogMock(...args),
      updateLogEntry: vi.fn(),
      removeLogEntry: vi.fn(),
      getProfile: (...args: unknown[]) => getProfileMock(...args),
      saveProfile: (...args: unknown[]) => saveProfileMock(...args),
    },
  };
});

vi.mock("@/lib/resources/students", () => ({
  studentsApi: { list: (...args: unknown[]) => studentsListMock(...args) },
}));

vi.mock("@/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ user: { role: "SCHOOL_ADMIN" } }),
}));

describe("HealthPage", () => {
  beforeEach(() => {
    listLogMock.mockClear();
    createLogMock.mockClear();
    getProfileMock.mockClear();
    saveProfileMock.mockClear();
    studentsListMock.mockClear();
  });

  it("logs a clinic visit by searching and picking a student, then submitting the form", async () => {
    createLogMock.mockResolvedValue({ id: "h1" });
    const user = userEvent.setup();
    render(<HealthPage />);

    await user.click(screen.getByRole("button", { name: "Log visit" }));
    const logForm = screen.getByTestId("log-visit-form");
    await user.type(within(logForm).getByLabelText(/Student/), "Hassan");

    await waitFor(() => expect(screen.getByText(/Hassan Iqbal/)).toBeInTheDocument());
    await user.click(screen.getByText(/Hassan Iqbal/));

    await user.type(within(logForm).getByLabelText(/Complaint/), "Mild fever during assembly.");
    await user.type(within(logForm).getByLabelText(/Action taken/), "Given water and rested in the office.");
    await user.click(within(logForm).getByRole("button", { name: "Log visit" }));

    await waitFor(() => expect(createLogMock).toHaveBeenCalledTimes(1));
    expect(createLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        studentId: STUDENT_ID,
        complaint: "Mild fever during assembly.",
        actionTaken: "Given water and rested in the office.",
      }),
    );
  });

  it("looks up a student's health profile and saves it", async () => {
    getProfileMock.mockResolvedValue(null);
    saveProfileMock.mockResolvedValue({ id: "p1" });
    const user = userEvent.setup();
    render(<HealthPage />);

    await user.type(screen.getByLabelText(/Student/), "Hassan");
    await waitFor(() => expect(screen.getByText(/Hassan Iqbal/)).toBeInTheDocument());
    await user.click(screen.getByText(/Hassan Iqbal/));

    await waitFor(() => expect(getProfileMock).toHaveBeenCalledWith(STUDENT_ID));

    const profileForm = await screen.findByTestId("health-profile-form");
    await user.type(within(profileForm).getByLabelText(/Allergies/), "Peanuts");
    await user.click(within(profileForm).getByRole("button", { name: "Save profile" }));

    await waitFor(() => expect(saveProfileMock).toHaveBeenCalledTimes(1));
    expect(saveProfileMock).toHaveBeenCalledWith(STUDENT_ID, expect.objectContaining({ allergies: "Peanuts" }));
  });

  it("lists clinic visits from the log", async () => {
    listLogMock.mockResolvedValue({
      data: [
        {
          id: "h1",
          visitDate: "2026-03-10",
          complaint: "Fell during sports.",
          actionTaken: "Ice pack applied.",
          outcome: "PARENT_CALLED_TO_COLLECT",
          guardianNotified: true,
          student: { id: "s1", fullName: "Hassan Iqbal", studentCode: "TS-2026-000001" },
          loggedByUser: { id: "u1", fullName: "Admin User" },
        },
      ],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    render(<HealthPage />);

    expect(await screen.findByText(/Hassan Iqbal/)).toBeInTheDocument();
    expect(screen.getByText("Fell during sports.")).toBeInTheDocument();
    expect(within(screen.getByRole("table")).getByText("Parent called to collect")).toBeInTheDocument();
  });
});
