import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import PortalLayout from "./layout";

const studentMeMock = vi.fn();
let mockUser: { id: string; fullName: string; email: string; role: string } = {
  id: "u1",
  fullName: "Sara Malik",
  email: "sara@test-school.test",
  role: "STUDENT",
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/portal",
}));

vi.mock("@/lib/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: mockUser,
    tenant: { id: "t1", name: "Beaconhouse", slug: "beaconhouse" },
    isLoading: false,
    logout: vi.fn(),
  }),
}));

vi.mock("@/lib/resources/students", () => ({
  studentsApi: { me: (...args: unknown[]) => studentMeMock(...args) },
}));

vi.mock("@/lib/resources/portal", () => ({
  portalApi: { me: vi.fn().mockResolvedValue(null) },
}));

describe("PortalLayout", () => {
  beforeEach(() => {
    studentMeMock.mockReset();
  });

  it("shows the student's own photo in the profile dropdown, linking to /portal/profile", async () => {
    mockUser = { id: "u1", fullName: "Sara Malik", email: "sara@test-school.test", role: "STUDENT" };
    studentMeMock.mockResolvedValue({ photoUrl: "https://example.test/sara.jpg" });

    render(
      <PortalLayout>
        <div>page content</div>
      </PortalLayout>,
    );

    expect(await screen.findByRole("img", { name: "Profile" })).toHaveAttribute(
      "src",
      "https://example.test/sara.jpg",
    );
    fireEvent.click(screen.getByRole("button", { name: /my profile/i }));
    expect(screen.getByRole("menuitem", { name: /my profile/i })).toHaveAttribute("href", "/portal/profile");
    // The header itself still exposes only the dropdown, not a second
    // redundant button/link next to it — the sidebar's own "My profile"
    // entry (added alongside the ProfileMenu dropdown, not instead of it)
    // is a separate, intentional nav item and is not part of this check.
    const header = screen.getByRole("banner");
    expect(within(header).queryByRole("link", { name: /^my profile$/i })).not.toBeInTheDocument();
  });

  it("falls back to the initial-letter avatar for a PARENT (no photo source)", async () => {
    mockUser = { id: "u2", fullName: "Tariq Khan", email: "tariq@test-school.test", role: "PARENT" };

    render(
      <PortalLayout>
        <div>page content</div>
      </PortalLayout>,
    );

    expect(await screen.findByText("T")).toBeInTheDocument();
    expect(studentMeMock).not.toHaveBeenCalled();
  });

  it("shows a persistent side menu with a Leave requests link for a PARENT", async () => {
    mockUser = { id: "u2", fullName: "Tariq Khan", email: "tariq@test-school.test", role: "PARENT" };

    render(
      <PortalLayout>
        <div>page content</div>
      </PortalLayout>,
    );

    const nav = await screen.findByRole("navigation", { name: "Portal navigation" });
    expect(within(nav).getByRole("link", { name: /Notice Board/ })).toHaveAttribute("href", "/portal/notices");
    expect(within(nav).getByRole("link", { name: /Leave requests/ })).toHaveAttribute("href", "/portal/leave-requests");
    expect(within(nav).getByRole("link", { name: /Overview/ })).toHaveAttribute("href", "/portal");
  });

  it("hides the Leave requests link for a STUDENT and opens the mobile drawer from the header menu button", async () => {
    mockUser = { id: "u1", fullName: "Sara Malik", email: "sara@test-school.test", role: "STUDENT" };
    studentMeMock.mockResolvedValue({ photoUrl: null });

    render(
      <PortalLayout>
        <div>page content</div>
      </PortalLayout>,
    );

    const nav = await screen.findByRole("navigation", { name: "Portal navigation" });
    expect(within(nav).queryByRole("link", { name: /Leave requests/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
    expect(screen.getByRole("dialog", { name: "Navigation menu" })).toBeInTheDocument();
  });
});
