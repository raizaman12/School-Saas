import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import PortalNoticesPage from "./page";

const noticesMock = vi.fn().mockResolvedValue({
  data: [
    {
      id: "n1",
      title: "Sports day",
      body: "Sports day is on Friday.",
      audiences: ["ALL_STUDENTS"],
      tone: "EVENT",
      isPinned: true,
      publishedAt: "2026-08-01T00:00:00.000Z",
      section: null,
      publishedByUser: { id: "u1", fullName: "Principal Ali" },
      recipients: [],
    },
  ],
  meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
});

vi.mock("@/lib/resources/portal", () => ({
  portalApi: { notices: (...args: unknown[]) => noticesMock(...args) },
}));

describe("PortalNoticesPage", () => {
  it("renders notices addressed to the logged-in student/parent", async () => {
    render(<PortalNoticesPage />);

    await waitFor(() => expect(screen.getByText("Sports day")).toBeInTheDocument());
    expect(screen.getByText("Sports day is on Friday.")).toBeInTheDocument();
    expect(screen.getByText(/Principal Ali/)).toBeInTheDocument();
  });
});
