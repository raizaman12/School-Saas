import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NewStaffPage from "./page";

const createMock = vi.fn();
const imageUploadMock = vi.fn();

vi.mock("@/lib/resources/staff", () => ({
  staffApi: { create: (...args: unknown[]) => createMock(...args) },
}));

vi.mock("@/lib/resources/uploads", () => ({
  uploadsApi: { image: (...args: unknown[]) => imageUploadMock(...args) },
}));

function pngFile() {
  return new File(["fake-bytes"], "photo.png", { type: "image/png" });
}

async function fillRequiredFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/Full name/), "Bilal Ahmed");
  await user.type(screen.getByLabelText(/Email/), "bilal@test-school.test");
  await user.type(screen.getByLabelText(/Designation/), "Senior Teacher");
  await user.type(screen.getByLabelText(/Joining date/), "2026-01-15");
  await user.type(screen.getByLabelText(/Monthly salary/), "60000");
}

describe("NewStaffPage", () => {
  beforeEach(() => {
    createMock.mockReset();
    imageUploadMock.mockReset();
  });

  it("creates a staff member with no photo (baseline — the new photo field is optional and doesn't block submission)", async () => {
    createMock.mockResolvedValue({
      data: { id: "s1", user: { fullName: "Bilal Ahmed" } },
      tempPassword: "Temp-abc123",
    });
    const user = userEvent.setup();
    render(<NewStaffPage />);

    expect(screen.getByRole("button", { name: "Upload photo (optional)" })).toBeInTheDocument();
    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: "Save staff" }));

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ fullName: "Bilal Ahmed", email: "bilal@test-school.test", photoUrl: undefined }),
    );
    expect(await screen.findByText(/has been added/)).toBeInTheDocument();
  });

  // Real bug this covers: the Add Staff form had no photo field at all, so
  // even though an admin might reasonably expect to set one while adding a
  // teacher, there was nowhere on this page to do it, and createStaffSchema
  // on the backend had no photoUrl to receive if there had been.
  it("lets an admin attach a photo while adding a staff member, and includes it in the create payload", async () => {
    imageUploadMock.mockResolvedValue({ url: "http://localhost:4000/uploads/t1/bilal.jpg" });
    createMock.mockResolvedValue({
      data: { id: "s1", user: { fullName: "Bilal Ahmed" } },
      tempPassword: "Temp-abc123",
    });
    const user = userEvent.setup();
    render(<NewStaffPage />);

    const input = screen.getByLabelText("Upload photo (optional)", { selector: "input" });
    await user.upload(input, pngFile());
    expect(await screen.findByRole("button", { name: "Change photo" })).toBeInTheDocument();

    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: "Save staff" }));

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ photoUrl: "http://localhost:4000/uploads/t1/bilal.jpg" }),
    );
  });

  // Login-by-ID (see backend createStaffSchema's doc comment): a TEACHER
  // (default role) needs no email at all — they log in with their own
  // staff ID instead.
  it("admits a TEACHER with no email, and shows the generated login ID afterward", async () => {
    createMock.mockResolvedValue({
      data: { id: "s1", employeeCode: "TS-EMP-000001", user: { fullName: "Bilal Ahmed", email: null, loginId: "tsemp000001" } },
      tempPassword: "Temp-abc123",
    });
    const user = userEvent.setup();
    render(<NewStaffPage />);

    await user.type(screen.getByLabelText(/Full name/), "Bilal Ahmed");
    await user.type(screen.getByLabelText(/Designation/), "Senior Teacher");
    await user.type(screen.getByLabelText(/Joining date/), "2026-01-15");
    await user.type(screen.getByLabelText(/Monthly salary/), "60000");
    await user.click(screen.getByRole("button", { name: "Save staff" }));

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ email: undefined }));
    expect(await screen.findByText("Login ID")).toBeInTheDocument();
    expect(screen.getByText("TS-EMP-000001")).toBeInTheDocument();
  });

  it("still requires an email when the role is School Admin", async () => {
    const user = userEvent.setup();
    render(<NewStaffPage />);

    await user.type(screen.getByLabelText(/Full name/), "Second Admin");
    await user.selectOptions(screen.getByLabelText(/Role/), "SCHOOL_ADMIN");
    await user.type(screen.getByLabelText(/Designation/), "Admin");
    await user.type(screen.getByLabelText(/Joining date/), "2026-01-15");
    await user.type(screen.getByLabelText(/Monthly salary/), "60000");
    await user.click(screen.getByRole("button", { name: "Save staff" }));

    expect(await screen.findByText(/email is required/i)).toBeInTheDocument();
    expect(createMock).not.toHaveBeenCalled();
  });
});
