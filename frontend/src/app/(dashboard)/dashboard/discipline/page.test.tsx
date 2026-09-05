import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DisciplinePage from "./page";

const listMock = vi.fn().mockResolvedValue({
  data: [],
  meta: { page: 1, limit: 20, total: 0, totalPages: 1 },
});
const createMock = vi.fn();
const updateMock = vi.fn();
const STUDENT_ID = "11111111-1111-4111-8111-111111111111";
const studentsListMock = vi.fn().mockResolvedValue({
  data: [{ id: STUDENT_ID, studentCode: "TS-2026-000001", fullName: "Hassan Iqbal" }],
  meta: { page: 1, limit: 8, total: 1, totalPages: 1 },
});

vi.mock("@/lib/resources/discipline", async () => {
  const actual = await vi.importActual<typeof import("@/lib/resources/discipline")>("@/lib/resources/discipline");
  return {
    ...actual,
    disciplineApi: {
      list: (...args: unknown[]) => listMock(...args),
      create: (...args: unknown[]) => createMock(...args),
      update: (...args: unknown[]) => updateMock(...args),
      remove: vi.fn(),
    },
  };
});

vi.mock("@/lib/resources/students", () => ({
  studentsApi: { list: (...args: unknown[]) => studentsListMock(...args) },
}));

describe("DisciplinePage", () => {
  beforeEach(() => {
    listMock.mockClear();
    createMock.mockClear();
    updateMock.mockClear();
    studentsListMock.mockClear();
  });

  it("logs an incident by searching and picking a student, then submitting the form", async () => {
    createMock.mockResolvedValue({ id: "d1" });
    const user = userEvent.setup();
    render(<DisciplinePage />);

    await user.click(screen.getByRole("button", { name: "Log incident" }));
    await user.type(screen.getByLabelText(/Student/), "Hassan");

    await waitFor(() => expect(screen.getByText(/Hassan Iqbal/)).toBeInTheDocument());
    await user.click(screen.getByText(/Hassan Iqbal/));

    await user.type(screen.getByLabelText(/What happened/), "Arrived 30 minutes late without a note.");
    const form = screen.getByTestId("log-incident-form");
    await user.click(within(form).getByRole("button", { name: "Log incident" }));

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        studentId: STUDENT_ID,
        description: "Arrived 30 minutes late without a note.",
        severity: "MINOR",
        category: "OTHER",
      }),
    );
  });

  it("lists records and marks an unresolved one as resolved", async () => {
    listMock.mockResolvedValue({
      data: [
        {
          id: "d1",
          incidentDate: "2026-02-10",
          category: "FIGHTING",
          severity: "MAJOR",
          description: "Fight in the corridor.",
          actionTaken: "PARENT_CALLED",
          guardianNotified: true,
          resolved: false,
          student: { id: "s1", fullName: "Hassan Iqbal", studentCode: "TS-2026-000001" },
          reportedByUser: { id: "u1", fullName: "Admin User" },
        },
      ],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    updateMock.mockResolvedValue({});
    const user = userEvent.setup();
    render(<DisciplinePage />);

    expect(await screen.findByText(/Hassan Iqbal/)).toBeInTheDocument();
    expect(screen.getByText("Fighting")).toBeInTheDocument();
    expect(screen.getByText("Open")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Mark resolved" }));
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith("d1", { resolved: true }));
  });
});
