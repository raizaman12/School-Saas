import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LoginPage from "./page";
import { ApiError } from "@/lib/api";

const loginMock = vi.fn().mockResolvedValue({ role: "SCHOOL_ADMIN" });
const resolveSchoolMock = vi.fn();
const pushMock = vi.fn();

vi.mock("@/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ login: loginMock }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/resources/tenant", () => ({
  tenantApi: { resolveSchool: (slug: string) => resolveSchoolMock(slug) },
}));

const singleTenant = {
  kind: "tenant" as const,
  tenant: {
    id: "t-solo",
    name: "Solo School",
    slug: "solo-school",
    status: "ACTIVE",
    themeId: "navy-blue",
    branchName: null,
    groupName: null,
    groupSlug: null,
  },
};

const groupResolved = {
  kind: "group" as const,
  group: {
    id: "g-1",
    name: "Alpha Schools",
    slug: "alpha-schools",
    branches: [
      { slug: "alpha-schools-dha-campus", branchName: "DHA Campus", city: "Karachi" },
      { slug: "alpha-schools-gulberg-campus", branchName: "Gulberg Campus", city: "Lahore" },
    ],
  },
};

const dhaBranchTenant = {
  kind: "tenant" as const,
  tenant: {
    id: "t-dha",
    name: "Alpha Schools — DHA Campus",
    slug: "alpha-schools-dha-campus",
    status: "ACTIVE",
    themeId: "navy-blue",
    branchName: "DHA Campus",
    groupName: "Alpha Schools",
    groupSlug: "alpha-schools",
  },
};

describe("LoginPage", () => {
  beforeEach(() => {
    loginMock.mockClear();
    resolveSchoolMock.mockReset();
    pushMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("resolves a direct single-school slug straight to the credentials form and logs in", async () => {
    resolveSchoolMock.mockResolvedValue(singleTenant);
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.type(screen.getByLabelText(/School URL/), "solo-school");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(screen.getByText("Solo School")).toBeInTheDocument());
    expect(resolveSchoolMock).toHaveBeenCalledWith("solo-school");

    await user.type(screen.getByLabelText(/Email or Login ID/), "admin@solo.test");
    await user.type(screen.getByLabelText(/^Password/), "Passw0rd123");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    expect(loginMock).toHaveBeenCalledWith({
      slug: "solo-school",
      email: "admin@solo.test",
      password: "Passw0rd123",
    });
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/dashboard"));
  });

  it("resolves a group's shared slug to a branch picker, then to that branch's own credentials form", async () => {
    resolveSchoolMock.mockImplementation((slug: string) =>
      Promise.resolve(slug === "alpha-schools" ? groupResolved : dhaBranchTenant),
    );
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.type(screen.getByLabelText(/School URL/), "alpha-schools");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(screen.getByText("Choose your branch")).toBeInTheDocument());
    expect(screen.getByText("DHA Campus")).toBeInTheDocument();
    expect(screen.getByText("Gulberg Campus")).toBeInTheDocument();

    await user.click(screen.getByText("DHA Campus"));

    await waitFor(() => expect(resolveSchoolMock).toHaveBeenLastCalledWith("alpha-schools-dha-campus"));
    await waitFor(() => expect(screen.getByText("Alpha Schools — DHA Campus")).toBeInTheDocument());

    await user.type(screen.getByLabelText(/Email or Login ID/), "admin@dha.test");
    await user.type(screen.getByLabelText(/^Password/), "Passw0rd123");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    // The final credentials POST uses the picked branch's own real slug —
    // never the group's shared slug.
    expect(loginMock).toHaveBeenCalledWith({
      slug: "alpha-schools-dha-campus",
      email: "admin@dha.test",
      password: "Passw0rd123",
    });
  });

  it("shows an inline error for an unknown school URL and stays on the slug step", async () => {
    resolveSchoolMock.mockRejectedValue(new ApiError(404, { message: "School not found", code: "NOT_FOUND" }));
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.type(screen.getByLabelText(/School URL/), "does-not-exist");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(screen.getByLabelText(/School URL/)).toBeInTheDocument());
    expect(screen.queryByLabelText(/Email or Login ID/)).not.toBeInTheDocument();
  });

  it("an auto-detected subdomain resolving to a group lands straight on the branch picker", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_DOMAIN", "yourschoolsaas.com");
    Object.defineProperty(window, "location", {
      value: { ...window.location, host: "alpha-schools.yourschoolsaas.com" },
      writable: true,
    });
    resolveSchoolMock.mockResolvedValue(groupResolved);

    render(<LoginPage />);

    await waitFor(() => expect(screen.getByText("Choose your branch")).toBeInTheDocument());
    expect(resolveSchoolMock).toHaveBeenCalledWith("alpha-schools");
    expect(screen.getByText("DHA Campus")).toBeInTheDocument();
  });
});
