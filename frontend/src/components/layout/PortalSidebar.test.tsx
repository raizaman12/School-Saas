import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PortalSidebar } from "./PortalSidebar";

vi.mock("next/navigation", () => ({
  usePathname: () => "/portal",
}));

vi.mock("@/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u1", role: "PARENT" } }),
}));

vi.mock("@/lib/resources/portal", () => ({
  portalApi: { me: () => Promise.resolve({ role: "PARENT", children: [] }) },
}));

// Same fix, same reasoning as Sidebar.test.tsx — the student/parent portal
// had the identical bug on its own rail.
describe("PortalSidebar", () => {
  it("is pinned to the viewport via sticky positioning, not part of the page's own scroll flow", () => {
    render(<PortalSidebar />);
    const aside = screen.getByRole("navigation", { name: "Portal navigation" }).closest("aside");
    expect(aside).not.toBeNull();
    expect(aside).toHaveClass("sticky", "top-0", "h-screen");
  });
});
