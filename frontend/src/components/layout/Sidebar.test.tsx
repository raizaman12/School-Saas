import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Sidebar } from "./Sidebar";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
}));

// Real bug this covers: the sidebar used to just be another item in the
// page's own flex flow, so scrolling down a long page (a big table, a long
// form) scrolled the whole nav away with it. `sticky top-0 h-screen` pins
// it to the viewport instead — asserted directly on the className since
// there's no other user-observable signal of "does this scroll with the
// page" available to a jsdom test.
describe("Sidebar", () => {
  it("is pinned to the viewport via sticky positioning, not part of the page's own scroll flow", () => {
    render(<Sidebar role="SCHOOL_ADMIN" />);
    const aside = screen.getByRole("navigation", { name: "Primary" }).closest("aside");
    expect(aside).not.toBeNull();
    expect(aside).toHaveClass("sticky", "top-0", "h-screen");
  });
});
