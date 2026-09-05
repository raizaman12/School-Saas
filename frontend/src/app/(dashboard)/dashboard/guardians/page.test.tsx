import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import GuardiansPage from "./page";

const listMock = vi.fn();

vi.mock("@/lib/resources/guardians", () => ({
  guardiansApi: {
    list: (...args: unknown[]) => listMock(...args),
  },
}));

describe("GuardiansPage", () => {
  beforeEach(() => {
    listMock.mockClear();
  });

  it("lists guardians with a link to their detail page and their portal-login status", async () => {
    listMock.mockResolvedValue({
      data: [
        { id: "g1", fullName: "Tariq Mehmood", relationship: "FATHER", phone: "03001234567", email: "tariq@test.com", userId: "u1" },
        { id: "g2", fullName: "Sana Malik", relationship: "MOTHER", phone: "03007654321", email: null, userId: null },
      ],
      meta: { page: 1, limit: 20, total: 2, totalPages: 1 },
    });

    render(<GuardiansPage />);

    expect(await screen.findByRole("link", { name: "Tariq Mehmood" })).toHaveAttribute(
      "href",
      "/dashboard/guardians/g1",
    );
    expect(screen.getByText("Father")).toBeInTheDocument();
    expect(screen.getByText("Mother")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument(); // g1 has a portal login
    expect(screen.getByText("None")).toBeInTheDocument(); // g2 does not
  });

  it("shows an empty state when there are no guardians", async () => {
    listMock.mockResolvedValue({ data: [], meta: { page: 1, limit: 20, total: 0, totalPages: 1 } });
    render(<GuardiansPage />);
    expect(await screen.findByText("No guardians found.")).toBeInTheDocument();
  });
});
