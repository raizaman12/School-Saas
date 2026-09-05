import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NoticesPage from "./page";

const listMock = vi.fn().mockResolvedValue({ data: [], meta: { page: 1, limit: 20, total: 0, totalPages: 1 } });
const createMock = vi.fn().mockResolvedValue({ id: "n1" });
const studentsListMock = vi.fn().mockResolvedValue({
  data: [{ id: "s1", studentCode: "2026-000001", fullName: "Hassan Iqbal" }],
  meta: { page: 1, limit: 10, total: 1, totalPages: 1 },
});

vi.mock("@/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ user: { role: "SCHOOL_ADMIN" } }),
}));

vi.mock("@/lib/resources/notices", async () => {
  const actual = await vi.importActual<typeof import("@/lib/resources/notices")>("@/lib/resources/notices");
  return {
    ...actual,
    noticesApi: {
      list: (...args: unknown[]) => listMock(...args),
      create: (...args: unknown[]) => createMock(...args),
      update: vi.fn(),
      remove: vi.fn(),
    },
  };
});

vi.mock("@/lib/resources/students", () => ({
  studentsApi: { list: (...args: unknown[]) => studentsListMock(...args) },
}));

vi.mock("@/lib/resources/guardians", () => ({
  guardiansApi: { list: vi.fn().mockResolvedValue({ data: [], meta: { page: 1, limit: 10, total: 0, totalPages: 1 } }) },
}));

vi.mock("@/lib/resources/staff", () => ({
  staffApi: { list: vi.fn().mockResolvedValue({ data: [], meta: { page: 1, limit: 10, total: 0, totalPages: 1 } }) },
}));

describe("NoticesPage — INDIVIDUAL audience", () => {
  beforeEach(() => {
    listMock.mockClear();
    createMock.mockClear();
    studentsListMock.mockClear();
  });

  it("publishes an INDIVIDUAL notice with a searched-and-selected student recipient", async () => {
    const user = userEvent.setup();
    render(<NoticesPage />);

    await user.click(screen.getByRole("button", { name: "Publish notice" }));
    await user.type(screen.getByLabelText(/Title/), "Fee reminder");
    await user.type(screen.getByLabelText(/Message/), "Please clear the outstanding balance.");
    await user.click(screen.getByLabelText("Individual (choose people)"));

    await waitFor(() => expect(screen.getByRole("button", { name: "Students" })).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText(/Hassan Iqbal/)).toBeInTheDocument());
    await user.click(screen.getByText(/Hassan Iqbal/));

    await user.click(screen.getByRole("button", { name: "Publish" }));

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Fee reminder",
        audiences: ["INDIVIDUAL"],
        recipientStudentIds: ["s1"],
        recipientGuardianIds: [],
        recipientStaffUserIds: [],
      }),
    );
  });

  it("blocks publishing an INDIVIDUAL notice with no recipient chosen", async () => {
    const user = userEvent.setup();
    render(<NoticesPage />);

    await user.click(screen.getByRole("button", { name: "Publish notice" }));
    await user.type(screen.getByLabelText(/Title/), "Fee reminder");
    await user.type(screen.getByLabelText(/Message/), "Please clear the outstanding balance.");
    await user.click(screen.getByLabelText("Individual (choose people)"));
    await user.click(screen.getByRole("button", { name: "Publish" }));

    expect(await screen.findByText(/Choose at least one/)).toBeInTheDocument();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("combines multiple broad audiences plus a tone in one notice", async () => {
    const user = userEvent.setup();
    render(<NoticesPage />);

    await user.click(screen.getByRole("button", { name: "Publish notice" }));
    await user.type(screen.getByLabelText(/Title/), "School closed Monday");
    await user.type(screen.getByLabelText(/Message/), "No classes on Monday due to a public holiday.");
    await user.click(screen.getByLabelText("All guardians"));
    await user.click(screen.getByLabelText("All students"));
    await user.selectOptions(screen.getByLabelText(/Tone/), "HOLIDAY");

    await user.click(screen.getByRole("button", { name: "Publish" }));

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "School closed Monday",
        audiences: ["ALL_GUARDIANS", "ALL_STUDENTS"],
        tone: "HOLIDAY",
      }),
    );
  });
});
