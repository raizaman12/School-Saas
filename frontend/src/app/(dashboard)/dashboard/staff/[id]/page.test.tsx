import { Suspense, act } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StaffDetailPage from "./page";

const getMock = vi.fn();
const removeMock = vi.fn();
const updateMock = vi.fn();
const updateSalaryMock = vi.fn();
const pushMock = vi.fn();
const imageUploadMock = vi.fn();

vi.mock("@/lib/resources/staff", () => ({
  staffApi: {
    get: (...args: unknown[]) => getMock(...args),
    remove: (...args: unknown[]) => removeMock(...args),
    update: (...args: unknown[]) => updateMock(...args),
    updateSalary: (...args: unknown[]) => updateSalaryMock(...args),
  },
}));

vi.mock("@/lib/resources/uploads", () => ({
  uploadsApi: { image: (...args: unknown[]) => imageUploadMock(...args) },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

let mockRole: string | undefined = "SCHOOL_ADMIN";
vi.mock("@/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "admin1", role: mockRole } }),
}));

const staff = {
  id: "s1",
  employeeCode: "EMP-000001",
  designation: "Teacher",
  department: null,
  employmentType: "FULL_TIME" as const,
  status: "ACTIVE" as const,
  joiningDate: "2026-01-15T00:00:00.000Z",
  monthlySalary: "50000",
  photoUrl: null,
  cnic: null,
  dateOfBirth: null,
  gender: null,
  address: null,
  emergencyContact: null,
  user: {
    id: "u1",
    email: "teacher@test-school.test",
    fullName: "Bilal Ahmed",
    phone: null,
    role: "TEACHER" as const,
    status: "ACTIVE",
    lastLoginAt: null,
  },
};

async function renderPage() {
  await act(async () => {
    render(
      <Suspense fallback={null}>
        <StaffDetailPage params={Promise.resolve({ id: "s1" })} />
      </Suspense>,
    );
  });
}

describe("StaffDetailPage — archive", () => {
  beforeEach(() => {
    getMock.mockReset();
    removeMock.mockReset();
    updateMock.mockReset();
    updateSalaryMock.mockReset();
    imageUploadMock.mockReset();
    pushMock.mockClear();
    mockRole = "SCHOOL_ADMIN";
  });

  it("shows an Archive button to SCHOOL_ADMIN and redirects to the staff list on confirm", async () => {
    getMock.mockResolvedValue(staff);
    removeMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    await renderPage();

    expect(await screen.findByRole("heading", { name: "Bilal Ahmed" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Archive" }));
    await user.click(screen.getByRole("button", { name: "Archive staff member" }));

    await waitFor(() => expect(removeMock).toHaveBeenCalledWith("s1"));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/dashboard/staff"));
  });

  // Archiving never cascades, so the old "blocked because they authored
  // other records" 409 no longer happens — the remaining backend refusals
  // are things like the last-admin guard, surfaced the same generic way.
  it("surfaces the backend's error message instead of a generic one", async () => {
    const { ApiError } = await import("@/lib/api");
    getMock.mockResolvedValue(staff);
    removeMock.mockRejectedValue(
      new ApiError(400, {
        code: "BAD_REQUEST",
        message: "Cannot remove the school's only remaining admin account.",
      }),
    );
    const user = userEvent.setup();
    await renderPage();

    await screen.findByRole("heading", { name: "Bilal Ahmed" });
    await user.click(screen.getByRole("button", { name: "Archive" }));
    await user.click(screen.getByRole("button", { name: "Archive staff member" }));

    expect((await screen.findAllByText(/only remaining admin account/)).length).toBeGreaterThan(0);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("hides the Archive button from a non-SCHOOL_ADMIN role", async () => {
    mockRole = "ACCOUNTANT";
    getMock.mockResolvedValue(staff);
    await renderPage();

    await screen.findByRole("heading", { name: "Bilal Ahmed" });
    expect(screen.queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
  });

  it("hides the Archive button once the staff member is already TERMINATED", async () => {
    getMock.mockResolvedValue({ ...staff, status: "TERMINATED" });
    await renderPage();

    await screen.findByRole("heading", { name: "Bilal Ahmed" });
    expect(screen.queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
  });

  // Real gap this covers: the Edit button had no role gate at all (unlike
  // Delete/reset-password above, already correctly gated) — an ACCOUNTANT
  // viewing a staff profile for payroll purposes could open the edit form
  // and change it, even though the backend's WRITE_ROLES never allowed them
  // to actually save it.
  // Exact-name match ("Edit", not /Edit/) so this stays scoped to the
  // full-record Edit button — ACCOUNTANT now correctly gets a separate
  // "Edit salary" pencil (see the "salary editor" describe block below),
  // whose accessible name would otherwise also match a loose /Edit/ regex.
  it("hides the Edit button from a non-SCHOOL_ADMIN role", async () => {
    mockRole = "ACCOUNTANT";
    getMock.mockResolvedValue(staff);
    await renderPage();
    await screen.findByRole("heading", { name: "Bilal Ahmed" });
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("shows the Edit button to SCHOOL_ADMIN", async () => {
    mockRole = "SCHOOL_ADMIN";
    getMock.mockResolvedValue(staff);
    await renderPage();
    await screen.findByRole("heading", { name: "Bilal Ahmed" });
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });
});

// Real gap this covers: ACCOUNTANT could not update a staff member's pay
// rate at all (the full Edit form — and thus its Monthly salary field —
// is SCHOOL_ADMIN-only), even though setting salaries is routine
// Accountant work in a Pakistani school office. This scoped inline editor
// (backend: PATCH /api/staff/:id/salary, SALARY_WRITE_ROLES) gives
// ACCOUNTANT just that one field, without the full-record Edit power.
describe("StaffDetailPage — salary editor", () => {
  beforeEach(() => {
    getMock.mockReset();
    updateSalaryMock.mockReset();
    mockRole = "SCHOOL_ADMIN";
  });

  it("shows the Edit salary pencil to ACCOUNTANT and saves a new value via updateSalary", async () => {
    mockRole = "ACCOUNTANT";
    getMock.mockResolvedValueOnce(staff).mockResolvedValueOnce({ ...staff, monthlySalary: "65000" });
    updateSalaryMock.mockResolvedValue({ ...staff, monthlySalary: "65000" });
    const user = userEvent.setup();
    await renderPage();

    await screen.findByRole("heading", { name: "Bilal Ahmed" });
    expect(screen.getByText("Rs 50,000")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit salary" }));
    const input = screen.getByLabelText("Monthly salary (Rs)");
    await user.clear(input);
    await user.type(input, "65000");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateSalaryMock).toHaveBeenCalledWith("s1", 65000));
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Rs 65,000")).toBeInTheDocument();
  });

  it("shows an inline error and does not close the editor when saving fails", async () => {
    mockRole = "ACCOUNTANT";
    const { ApiError } = await import("@/lib/api");
    getMock.mockResolvedValue(staff);
    updateSalaryMock.mockRejectedValue(new ApiError(400, { code: "BAD_REQUEST", message: "Invalid amount." }));
    const user = userEvent.setup();
    await renderPage();

    await screen.findByRole("heading", { name: "Bilal Ahmed" });
    await user.click(screen.getByRole("button", { name: "Edit salary" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Invalid amount.")).toBeInTheDocument();
    expect(screen.getByLabelText("Monthly salary (Rs)")).toBeInTheDocument();
  });

  // SCHOOL_ADMIN's full Edit form already covers Monthly salary, so the
  // scoped pencil would just be a redundant second way to edit the same
  // field — it's ACCOUNTANT-only.
  it("does not show the Edit salary pencil to SCHOOL_ADMIN", async () => {
    mockRole = "SCHOOL_ADMIN";
    getMock.mockResolvedValue(staff);
    await renderPage();
    await screen.findByRole("heading", { name: "Bilal Ahmed" });
    expect(screen.queryByRole("button", { name: "Edit salary" })).not.toBeInTheDocument();
  });

  it("does not show the Edit salary pencil to TEACHER", async () => {
    mockRole = "TEACHER";
    getMock.mockResolvedValue(staff);
    await renderPage();
    await screen.findByRole("heading", { name: "Bilal Ahmed" });
    expect(screen.queryByRole("button", { name: "Edit salary" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });
});

// Real bug this covers: this page never showed a photo or offered any way
// to set one at all — an admin adding a staff member with a photo (Add
// staff form) or trying to add one afterwards from here had it silently go
// nowhere, even though the backend's PATCH /:id has accepted photoUrl for
// a while. Saves immediately on upload, same as the student detail page's
// own photo control — not gated behind the separate Edit form/Save button.
describe("StaffDetailPage — photo", () => {
  beforeEach(() => {
    getMock.mockReset();
    updateMock.mockReset();
    imageUploadMock.mockReset();
    mockRole = "SCHOOL_ADMIN";
  });

  function pngFile() {
    return new File(["fake-bytes"], "photo.png", { type: "image/png" });
  }

  it("shows an initial-letter placeholder with no photo, and uploading one saves immediately and refetches", async () => {
    getMock.mockResolvedValueOnce(staff).mockResolvedValueOnce({ ...staff, photoUrl: "http://localhost:4000/uploads/t1/bilal.jpg" });
    imageUploadMock.mockResolvedValue({ url: "http://localhost:4000/uploads/t1/bilal.jpg" });
    updateMock.mockResolvedValue({ ...staff, photoUrl: "http://localhost:4000/uploads/t1/bilal.jpg" });

    const user = userEvent.setup();
    await renderPage();

    await screen.findByRole("heading", { name: "Bilal Ahmed" });
    // Fallback placeholder (first letter of the name) when there's no photo yet.
    expect(screen.getByText("B")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload photo" })).toBeInTheDocument();

    const input = screen.getByLabelText("Upload photo", { selector: "input" });
    await user.upload(input, pngFile());

    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith("s1", { photoUrl: "http://localhost:4000/uploads/t1/bilal.jpg" }),
    );
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByAltText("Bilal Ahmed")).toHaveAttribute(
      "src",
      "http://localhost:4000/uploads/t1/bilal.jpg",
    );
    // The upload button relabels once a photo exists.
    expect(screen.getByRole("button", { name: "Change photo" })).toBeInTheDocument();
  });

  it("shows a save error inline without crashing when the photo upload succeeds but saving it fails", async () => {
    const { ApiError } = await import("@/lib/api");
    getMock.mockResolvedValue(staff);
    imageUploadMock.mockResolvedValue({ url: "http://localhost:4000/uploads/t1/bilal.jpg" });
    updateMock.mockRejectedValue(new ApiError(400, { code: "BAD_REQUEST", message: "Could not save the photo." }));

    const user = userEvent.setup();
    await renderPage();

    await screen.findByRole("heading", { name: "Bilal Ahmed" });
    const input = screen.getByLabelText("Upload photo", { selector: "input" });
    await user.upload(input, pngFile());

    expect(await screen.findByText("Could not save the photo.")).toBeInTheDocument();
  });
});
