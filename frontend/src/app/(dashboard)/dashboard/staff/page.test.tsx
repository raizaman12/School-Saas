import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import StaffPage from "./page";

const listMock = vi.fn().mockResolvedValue({
  data: [],
  meta: { page: 1, limit: 20, total: 0, totalPages: 1 },
});

vi.mock("@/lib/resources/staff", () => ({
  staffApi: { list: (...args: unknown[]) => listMock(...args) },
}));

let mockRole: string | undefined = "SCHOOL_ADMIN";
vi.mock("@/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u1", role: mockRole } }),
}));

describe("StaffPage — role gating", () => {
  beforeEach(() => {
    listMock.mockClear();
  });

  // Real gap this covers: the "Add staff" button had no role gate at all —
  // an ACCOUNTANT viewing the staff list (needed for payroll work) could
  // click through to the create form, even though the backend's WRITE_ROLES
  // (staff/staff.ts) never allowed them to actually save it.
  it("shows Add staff to SCHOOL_ADMIN but hides it from ACCOUNTANT", async () => {
    mockRole = "SCHOOL_ADMIN";
    const { unmount } = render(<StaffPage />);
    expect(await screen.findByRole("link", { name: /Add staff/ })).toBeInTheDocument();
    unmount();

    mockRole = "ACCOUNTANT";
    render(<StaffPage />);
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    expect(screen.queryByRole("link", { name: /Add staff/ })).not.toBeInTheDocument();
  });
});
