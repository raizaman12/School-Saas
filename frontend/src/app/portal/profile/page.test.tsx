import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import PortalProfilePage from "./page";

let mockUser: { role: string; email: string; phone: string | null } = {
  role: "STUDENT",
  email: "sara@test-school.test",
  phone: null,
};

vi.mock("@/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ user: mockUser, updateProfile: vi.fn() }),
}));

vi.mock("@/lib/resources/students", () => ({
  studentsApi: { me: () => new Promise(() => {}) }, // never resolves — we only assert which shell renders
}));

vi.mock("@/lib/resources/staff", () => ({
  staffApi: { me: () => Promise.reject(new Error("404")) },
}));

describe("PortalProfilePage", () => {
  it("renders the tabbed About/Bio Data profile for a STUDENT", () => {
    mockUser = { role: "STUDENT", email: "sara@test-school.test", phone: null };
    render(<PortalProfilePage />);
    expect(screen.getByRole("button", { name: "About" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bio Data" })).toBeInTheDocument();
  });

  it("renders the plain contact-info form for a PARENT (no Bio Data tab)", () => {
    mockUser = { role: "PARENT", email: "tariq@test-school.test", phone: "03001234567" };
    render(<PortalProfilePage />);
    expect(screen.queryByRole("button", { name: "Bio Data" })).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("tariq@test-school.test")).toBeInTheDocument();
  });
});
