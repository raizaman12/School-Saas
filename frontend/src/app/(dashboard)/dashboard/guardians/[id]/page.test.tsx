import { Suspense, act } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GuardianDetailPage from "./page";

const getMock = vi.fn();
const updateMock = vi.fn();
const removeMock = vi.fn();
const pushMock = vi.fn();

vi.mock("@/lib/resources/guardians", () => ({
  guardiansApi: {
    get: (...args: unknown[]) => getMock(...args),
    update: (...args: unknown[]) => updateMock(...args),
    remove: (...args: unknown[]) => removeMock(...args),
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

let mockRole: string | undefined = "SCHOOL_ADMIN";
vi.mock("@/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "admin1", role: mockRole } }),
}));

const guardian = {
  id: "g1",
  fullName: "Tariq Mehmood",
  relationship: "FATHER" as const,
  phone: "03001234567",
  email: "tariq@test.com",
  userId: "u1",
  cnic: "35202-1111111-1",
  occupation: "Businessman",
  students: [
    { isPrimary: true, student: { id: "st1", fullName: "Ahmed Tariq", studentCode: "2026-000001" } },
  ],
};

async function renderPage() {
  await act(async () => {
    render(
      <Suspense fallback={null}>
        <GuardianDetailPage params={Promise.resolve({ id: "g1" })} />
      </Suspense>,
    );
  });
}

describe("GuardianDetailPage", () => {
  beforeEach(() => {
    getMock.mockReset();
    updateMock.mockReset();
    removeMock.mockReset();
    pushMock.mockClear();
    mockRole = "SCHOOL_ADMIN";
  });

  it("shows the guardian's profile and linked students", async () => {
    getMock.mockResolvedValue(guardian);
    await renderPage();

    expect(await screen.findByRole("heading", { name: "Tariq Mehmood" })).toBeInTheDocument();
    expect(screen.getByText("Businessman")).toBeInTheDocument();
    expect(screen.getByText("Ahmed Tariq")).toBeInTheDocument();
    expect(screen.getByText("2026-000001")).toBeInTheDocument();
  });

  it("lets SCHOOL_ADMIN edit contact info", async () => {
    getMock.mockResolvedValue(guardian);
    updateMock.mockResolvedValue({ ...guardian, phone: "03009999999" });
    const user = userEvent.setup();
    await renderPage();

    await screen.findByRole("heading", { name: "Tariq Mehmood" });
    await user.click(screen.getByRole("button", { name: /Edit/ }));

    const phoneInput = screen.getByLabelText(/^Phone/);
    await user.clear(phoneInput);
    await user.type(phoneInput, "03009999999");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith("g1", expect.objectContaining({ phone: "03009999999" })),
    );
  });

  it("deletes the guardian and redirects to the list on confirm", async () => {
    getMock.mockResolvedValue(guardian);
    removeMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    await renderPage();

    await screen.findByRole("heading", { name: "Tariq Mehmood" });
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Delete permanently" }));

    await waitFor(() => expect(removeMock).toHaveBeenCalledWith("g1"));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/dashboard/guardians"));
  });

  it("surfaces the backend's 409 leave-request-blocker message instead of a generic error", async () => {
    const { ApiError } = await import("@/lib/api");
    getMock.mockResolvedValue(guardian);
    removeMock.mockRejectedValue(
      new ApiError(409, {
        code: "CONFLICT",
        message: "This guardian has filed 2 student leave request(s) on record and cannot be permanently deleted",
      }),
    );
    const user = userEvent.setup();
    await renderPage();

    await screen.findByRole("heading", { name: "Tariq Mehmood" });
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Delete permanently" }));

    // Shown twice — once in ConfirmButton's own inline panel, once in the
    // page-level deleteError Alert (mirrors the student detail page's
    // onDelete, which rethrows so both stay in sync).
    expect((await screen.findAllByText(/cannot be permanently deleted/)).length).toBeGreaterThan(0);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("hides Edit and Delete for a TEACHER (read-only access)", async () => {
    mockRole = "TEACHER";
    getMock.mockResolvedValue(guardian);
    await renderPage();

    await screen.findByRole("heading", { name: "Tariq Mehmood" });
    expect(screen.queryByRole("button", { name: /Edit/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });
});
