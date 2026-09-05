import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ProfileMenu } from "./ProfileMenu";

const logoutMock = vi.fn();
const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/lib/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: { fullName: "Sana Malik", email: "sana@test-school.test" },
    logout: logoutMock,
  }),
}));

describe("ProfileMenu", () => {
  beforeEach(() => {
    logoutMock.mockReset();
    pushMock.mockReset();
  });

  it("shows an initial-letter avatar when no photo is supplied, and the menu is closed by default", () => {
    render(<ProfileMenu photoUrl={null} profileHref="/dashboard/profile" />);
    expect(screen.getByText("S")).toBeInTheDocument();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("renders the photo when one is supplied", () => {
    render(<ProfileMenu photoUrl="https://example.test/sana.jpg" profileHref="/dashboard/profile" />);
    const img = screen.getByRole("img", { name: "Profile" });
    expect(img).toHaveAttribute("src", "https://example.test/sana.jpg");
  });

  it("opens on click to reveal exactly My Profile and Log out", () => {
    render(<ProfileMenu photoUrl={null} profileHref="/dashboard/profile" />);
    fireEvent.click(screen.getByRole("button", { name: /my profile/i }));

    const menu = screen.getByRole("menu");
    expect(menu).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /my profile/i })).toHaveAttribute("href", "/dashboard/profile");
    expect(screen.getByRole("menuitem", { name: /log out/i })).toBeInTheDocument();
  });

  it("logs out and redirects to /login when Log out is clicked", async () => {
    logoutMock.mockResolvedValue(undefined);
    render(<ProfileMenu photoUrl={null} profileHref="/portal/profile" />);
    fireEvent.click(screen.getByRole("button", { name: /my profile/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /log out/i }));

    await waitFor(() => expect(logoutMock).toHaveBeenCalled());
    expect(pushMock).toHaveBeenCalledWith("/login");
  });

  it("closes when clicking outside the menu", () => {
    render(
      <div>
        <ProfileMenu photoUrl={null} profileHref="/dashboard/profile" />
        <button type="button">outside</button>
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: /my profile/i }));
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByText("outside"));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
