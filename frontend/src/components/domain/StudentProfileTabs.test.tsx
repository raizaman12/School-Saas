import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StudentProfileTabs } from "./StudentProfileTabs";

const studentMeMock = vi.fn();
const updateProfileMock = vi.fn();

vi.mock("@/lib/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: { id: "u1", fullName: "Sara Malik", email: "sara.malik@test-school.test" },
    updateProfile: updateProfileMock,
  }),
}));

vi.mock("@/lib/resources/students", () => ({
  studentsApi: { me: (...args: unknown[]) => studentMeMock(...args) },
}));

const studentMe = {
  id: "s1",
  studentCode: "TS-000001",
  fullName: "Sara Malik",
  gender: "FEMALE",
  dateOfBirth: "2013-03-10T00:00:00.000Z",
  bFormOrCnic: "35202-1234567-1",
  contactPhone: "03001112222",
  address: "DHA Phase 5, Karachi",
  emergencyContact: "Uncle Tariq - 03001234567",
  photoUrl: null,
  guardians: [
    {
      isPrimary: true,
      guardian: { id: "g1", fullName: "Malik Farooq", relationship: "FATHER", cnic: "35202-7654321-1", phone: "03001234567", email: null },
    },
  ],
  healthProfile: { bloodGroup: "O_POSITIVE" },
  user: { id: "u1", email: "sara.malik@test-school.test" },
};

describe("StudentProfileTabs", () => {
  beforeEach(() => {
    studentMeMock.mockReset();
    updateProfileMock.mockReset();
    studentMeMock.mockResolvedValue(studentMe);
  });

  it("defaults to the About tab pre-filled with contact info", async () => {
    render(<StudentProfileTabs />);
    // Address only ever gets a value once the async fetch resolves and the
    // effect-driven reset() runs — await on it so email/phone (already
    // correct at first mount) are checked only after that settles too.
    expect(await screen.findByDisplayValue("DHA Phase 5, Karachi")).toBeInTheDocument();
    expect(screen.getByDisplayValue("sara.malik@test-school.test")).toBeInTheDocument();
    expect(screen.getByDisplayValue("03001112222")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Uncle Tariq - 03001234567")).toBeInTheDocument();
  });

  it("submits all four contact fields together via updateProfile", async () => {
    updateProfileMock.mockResolvedValue({});
    const user = userEvent.setup();
    render(<StudentProfileTabs />);
    await screen.findByDisplayValue("DHA Phase 5, Karachi");

    const addressInput = screen.getByLabelText(/present address/i);
    await user.clear(addressInput);
    await user.type(addressInput, "Gulshan-e-Iqbal, Karachi");
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() =>
      expect(updateProfileMock).toHaveBeenCalledWith({
        email: "sara.malik@test-school.test",
        phone: "03001112222",
        address: "Gulshan-e-Iqbal, Karachi",
        emergencyContact: "Uncle Tariq - 03001234567",
      }),
    );
  });

  it("shows read-only Bio Data — personal detail and family detail — with no editable fields", async () => {
    render(<StudentProfileTabs />);
    fireEvent.click(await screen.findByRole("button", { name: "Bio Data" }));

    expect(await screen.findByText("Female")).toBeInTheDocument();
    expect(screen.getByText("35202-1234567-1")).toBeInTheDocument();
    expect(screen.getByText("O_POSITIVE")).toBeInTheDocument();
    expect(screen.getByText("Malik Farooq")).toBeInTheDocument();
    expect(screen.getByText("Father")).toBeInTheDocument();
    expect(screen.getByText("Primary")).toBeInTheDocument();
    expect(screen.getByText("35202-7654321-1")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("shows an empty-guardian message when the student has no guardian on record", async () => {
    studentMeMock.mockResolvedValue({ ...studentMe, guardians: [] });
    render(<StudentProfileTabs />);
    fireEvent.click(await screen.findByRole("button", { name: "Bio Data" }));
    expect(await screen.findByText("No guardian on record yet.")).toBeInTheDocument();
  });
});
