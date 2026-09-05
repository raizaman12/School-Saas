import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Topbar } from "./Topbar";

const staffMeMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: { id: "u1", fullName: "Sana Malik", email: "sana@test-school.test", role: "TEACHER" },
    tenant: { id: "t1", name: "Beaconhouse", slug: "beaconhouse" },
    logout: vi.fn(),
  }),
}));

vi.mock("@/lib/resources/staff", () => ({
  staffApi: { me: (...args: unknown[]) => staffMeMock(...args) },
}));

describe("Topbar", () => {
  beforeEach(() => {
    staffMeMock.mockReset();
    staffMeMock.mockResolvedValue({ photoUrl: "https://example.test/sana.jpg" });
  });

  it("shows the profile-photo dropdown (not standalone My Profile/Log out buttons) plus Change password", async () => {
    render(<Topbar />);

    expect(await screen.findByRole("img", { name: "Profile" })).toHaveAttribute(
      "src",
      "https://example.test/sana.jpg",
    );
    expect(screen.getByRole("link", { name: /change password/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^my profile$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^log out$/i })).not.toBeInTheDocument();
  });

  it("opens the dropdown on click to reveal My Profile linking to /dashboard/profile", async () => {
    render(<Topbar />);
    await screen.findByRole("img", { name: "Profile" });

    fireEvent.click(screen.getByRole("button", { name: /my profile/i }));
    expect(screen.getByRole("menuitem", { name: /my profile/i })).toHaveAttribute("href", "/dashboard/profile");
  });
});
