import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StaffProfileTabs } from "./StaffProfileTabs";

const staffMeMock = vi.fn();
const staffUpdateMeMock = vi.fn();
const updateProfileMock = vi.fn();

vi.mock("@/lib/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: { id: "u1", fullName: "Bilal Ahmed", email: "bilal@test-school.test", phone: "03001234567" },
    updateProfile: updateProfileMock,
  }),
}));

vi.mock("@/lib/resources/staff", () => ({
  staffApi: {
    me: (...args: unknown[]) => staffMeMock(...args),
    updateMe: (...args: unknown[]) => staffUpdateMeMock(...args),
  },
}));

const staffProfile = {
  id: "sp1",
  employeeCode: "EMP-001",
  designation: "Senior Teacher",
  department: "Science",
  photoUrl: null,
  cnic: "35202-1234567-1",
  dateOfBirth: "1990-05-15T00:00:00.000Z",
  gender: "MALE",
  address: "Lahore",
  emergencyContact: "Wife - 03007654321",
  user: { fullName: "Bilal Ahmed" },
};

describe("StaffProfileTabs", () => {
  beforeEach(() => {
    staffMeMock.mockReset();
    staffUpdateMeMock.mockReset();
    updateProfileMock.mockReset();
    staffMeMock.mockResolvedValue(staffProfile);
  });

  it("defaults to the About tab with the email/phone form pre-filled", async () => {
    render(<StaffProfileTabs />);
    expect(await screen.findByDisplayValue("bilal@test-school.test")).toBeInTheDocument();
    expect(screen.getByDisplayValue("03001234567")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "About" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bio Data" })).toBeInTheDocument();
  });

  it("submits email/phone changes via updateProfile", async () => {
    updateProfileMock.mockResolvedValue({});
    const user = userEvent.setup();
    render(<StaffProfileTabs />);
    await screen.findByDisplayValue("bilal@test-school.test");

    const emailInput = screen.getByLabelText(/email/i);
    await user.clear(emailInput);
    await user.type(emailInput, "bilal.new@test-school.test");
    await user.click(screen.getAllByRole("button", { name: /save/i })[0]);

    await waitFor(() =>
      expect(updateProfileMock).toHaveBeenCalledWith({ email: "bilal.new@test-school.test", phone: "03001234567" }),
    );
  });

  it("submits address/emergency contact changes via staffApi.updateMe", async () => {
    staffUpdateMeMock.mockResolvedValue(staffProfile);
    const user = userEvent.setup();
    render(<StaffProfileTabs />);
    await screen.findByDisplayValue("Lahore");

    const addressInput = screen.getByLabelText(/present address/i);
    await user.clear(addressInput);
    await user.type(addressInput, "Model Town, Lahore");
    await user.click(screen.getAllByRole("button", { name: /save/i })[1]);

    await waitFor(() =>
      expect(staffUpdateMeMock).toHaveBeenCalledWith({
        address: "Model Town, Lahore",
        emergencyContact: "Wife - 03007654321",
      }),
    );
  });

  it("shows read-only Bio Data (CNIC, DOB, gender) with no editable fields", async () => {
    render(<StaffProfileTabs />);
    fireEvent.click(await screen.findByRole("button", { name: "Bio Data" }));

    expect(await screen.findByText("35202-1234567-1")).toBeInTheDocument();
    expect(screen.getByText("Male")).toBeInTheDocument();
    expect(screen.getByText("EMP-001")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /cnic/i })).not.toBeInTheDocument();
  });
});
