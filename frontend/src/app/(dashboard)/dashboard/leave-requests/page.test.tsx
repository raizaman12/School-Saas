import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LeaveRequestsPage from "./page";

const listMock = vi.fn().mockResolvedValue({
  data: [
    {
      id: "lr1",
      leaveType: "SICK",
      fromDate: "2026-08-20",
      toDate: "2026-08-21",
      reason: "Flu",
      status: "PENDING",
      reviewNote: null,
      reviewedAt: null,
      staffProfile: { id: "sp1", employeeCode: "EMP-001", designation: "Teacher", user: { fullName: "Ayesha Malik" } },
      reviewedByUser: null,
    },
  ],
  meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
});
const createMock = vi.fn().mockResolvedValue({ id: "lr2" });
const approveMock = vi.fn().mockResolvedValue({ id: "lr1" });
const cancelMock = vi.fn().mockResolvedValue({ id: "lr1" });

vi.mock("@/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ user: { role: "SCHOOL_ADMIN" } }),
}));

vi.mock("@/lib/resources/leaveRequests", async () => {
  const actual = await vi.importActual<typeof import("@/lib/resources/leaveRequests")>(
    "@/lib/resources/leaveRequests",
  );
  return {
    ...actual,
    leaveRequestsApi: {
      list: (...args: unknown[]) => listMock(...args),
      create: (...args: unknown[]) => createMock(...args),
      approve: (...args: unknown[]) => approveMock(...args),
      reject: vi.fn(),
      cancel: (...args: unknown[]) => cancelMock(...args),
    },
  };
});

describe("LeaveRequestsPage", () => {
  beforeEach(() => {
    listMock.mockClear();
    createMock.mockClear();
    approveMock.mockClear();
    cancelMock.mockClear();
  });

  it("lists leave requests and lets a SCHOOL_ADMIN approve a pending one", async () => {
    const user = userEvent.setup();
    render(<LeaveRequestsPage />);

    await waitFor(() => expect(screen.getByText("Ayesha Malik")).toBeInTheDocument());
    expect(screen.getByText("Flu")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(approveMock).toHaveBeenCalledWith("lr1"));
  });

  it("submits a new leave request", async () => {
    const user = userEvent.setup();
    render(<LeaveRequestsPage />);

    await user.click(screen.getByRole("button", { name: "Request leave" }));
    await user.type(screen.getByLabelText(/From/), "2026-09-01");
    await user.type(screen.getByLabelText(/^To/), "2026-09-02");
    await user.type(screen.getByLabelText(/Reason/), "Family event");
    await user.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ leaveType: "CASUAL", fromDate: "2026-09-01", toDate: "2026-09-02", reason: "Family event" }),
    );
  });
});
