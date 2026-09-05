import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SignupPage from "./page";

const signupMock = vi.fn().mockResolvedValue(undefined);
const signupMultiBranchMock = vi.fn().mockResolvedValue({
  schoolGroup: { id: "group-1", name: "Alpha Schools", slug: "alpha-schools" },
  branches: [
    {
      tenant: { id: "t-1", name: "Alpha Schools — DHA Campus", slug: "alpha-schools-dha-campus", branchName: "DHA Campus" },
      user: { id: "u-1", email: "admin@dha.test", fullName: "DHA Admin" },
    },
    {
      tenant: { id: "t-2", name: "Alpha Schools — Gulberg Campus", slug: "alpha-schools-gulberg-campus", branchName: "Gulberg Campus" },
      user: { id: "u-2", email: "admin@gulberg.test", fullName: "Gulberg Admin" },
    },
  ],
});
const pushMock = vi.fn();
const themePresetsMock = vi.fn().mockResolvedValue([
  { id: "navy-blue", label: "Navy Blue", primaryHex: "#1e3a8a" },
  { id: "bottle-green", label: "Bottle Green", primaryHex: "#065f46" },
  { id: "maroon", label: "Maroon", primaryHex: "#7f1d1d" },
]);

vi.mock("@/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ signup: signupMock, signupMultiBranch: signupMultiBranchMock }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/lib/resources/tenant", () => ({
  tenantApi: { themePresets: () => themePresetsMock() },
}));

async function continueThroughThemeStep(user: ReturnType<typeof userEvent.setup>) {
  // Step 2: theme selection — wait for the swatch grid to load, then move on.
  await waitFor(() => expect(screen.getByRole("button", { name: "Bottle Green" })).toBeInTheDocument());
  await user.click(screen.getByRole("button", { name: "Continue" }));
}

// Step 3: One Branch / Multiple Branches. "One branch" is already selected
// by default, so continuing through this step with no interaction is the
// single-school path — the same path every signup took before this step
// existed.
async function continueThroughModeStep(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() => expect(screen.getByRole("button", { name: /One branch/ })).toBeInTheDocument());
  await user.click(screen.getByRole("button", { name: "Continue" }));
}

describe("SignupPage", () => {
  beforeEach(() => {
    signupMock.mockClear();
    signupMultiBranchMock.mockClear();
    pushMock.mockClear();
    themePresetsMock.mockClear();
  });

  it("carries the plan and theme chosen in earlier steps through to the submitted signup payload", async () => {
    const user = userEvent.setup();
    render(<SignupPage />);

    // Step 1: plan selection — pick Standard instead of the default Trial.
    await user.click(screen.getByRole("button", { name: /Standard/ }));
    await user.click(screen.getByRole("button", { name: "Continue" }));

    // Step 2: theme selection — pick Bottle Green instead of the default Navy Blue.
    await waitFor(() => expect(screen.getByRole("button", { name: "Bottle Green" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Bottle Green" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));

    // Step 3: one branch vs multiple branches — stay on the default "One branch".
    await continueThroughModeStep(user);

    // Step 4: school/admin details.
    await user.type(screen.getByLabelText(/School name/), "Alpha School");
    await user.type(screen.getByLabelText(/School URL/), "alpha-school");
    await user.type(screen.getByLabelText(/Your full name/), "Ali Admin");
    await user.type(screen.getByLabelText(/^Email/), "admin@alpha.test");
    await user.type(screen.getByLabelText(/^Password/), "Passw0rd123");
    await user.click(screen.getByRole("button", { name: "Create school account" }));

    expect(signupMock).toHaveBeenCalledTimes(1);
    expect(signupMock).toHaveBeenCalledWith(
      expect.objectContaining({
        schoolName: "Alpha School",
        slug: "alpha-school",
        plan: "STANDARD",
        themeId: "bottle-green",
      }),
    );
  });

  it("defaults to the TRIAL plan and navy-blue theme when the user doesn't change the selection", async () => {
    const user = userEvent.setup();
    render(<SignupPage />);

    await user.click(screen.getByRole("button", { name: "Continue" }));
    await continueThroughThemeStep(user);
    await continueThroughModeStep(user);

    await user.type(screen.getByLabelText(/School name/), "Beta School");
    await user.type(screen.getByLabelText(/School URL/), "beta-school");
    await user.type(screen.getByLabelText(/Your full name/), "Beta Admin");
    await user.type(screen.getByLabelText(/^Email/), "admin@beta.test");
    await user.type(screen.getByLabelText(/^Password/), "Passw0rd123");
    await user.click(screen.getByRole("button", { name: "Create school account" }));

    expect(signupMock).toHaveBeenCalledWith(expect.objectContaining({ plan: "TRIAL", themeId: "navy-blue" }));
  });

  it("choosing Multiple Branches skips straight to the group-details step, never calling the single-school signup", async () => {
    const user = userEvent.setup();
    render(<SignupPage />);

    await user.click(screen.getByRole("button", { name: "Continue" }));
    await continueThroughThemeStep(user);

    await waitFor(() => expect(screen.getByRole("button", { name: /Multiple branches/ })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Multiple branches/ }));
    await user.click(screen.getByRole("button", { name: "Continue" }));

    // Now on the group-details sub-step, not the single-school DetailsStep.
    expect(screen.queryByLabelText(/Your full name/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/School group name/)).toBeInTheDocument();
    expect(signupMock).not.toHaveBeenCalled();
  });

  it("registers a multi-branch school group end to end and shows each branch's login URL", async () => {
    const user = userEvent.setup();
    render(<SignupPage />);

    await user.click(screen.getByRole("button", { name: "Continue" }));
    await continueThroughThemeStep(user);

    await waitFor(() => expect(screen.getByRole("button", { name: /Multiple branches/ })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Multiple branches/ }));
    await user.click(screen.getByRole("button", { name: "Continue" }));

    // Group-details sub-step.
    await user.type(screen.getByLabelText(/School group name/), "Alpha Schools");
    await user.type(screen.getByLabelText(/Shared login URL/), "alpha-schools");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    // Branches sub-step — 2 branch rows exist by default.
    await waitFor(() => expect(screen.getAllByLabelText(/Branch admin's email/)).toHaveLength(2));
    const branchNameInputs = screen.getAllByLabelText(/^Branch name/);
    const cityInputs = screen.getAllByLabelText(/^City/);
    const adminNameInputs = screen.getAllByLabelText(/Branch admin's full name/);
    const adminEmailInputs = screen.getAllByLabelText(/Branch admin's email/);
    const adminPasswordInputs = screen.getAllByLabelText(/Branch admin's password/);
    expect(branchNameInputs).toHaveLength(2);

    await user.type(branchNameInputs[0], "DHA Campus");
    await user.type(cityInputs[0], "Karachi");
    await user.type(adminNameInputs[0], "DHA Admin");
    await user.type(adminEmailInputs[0], "admin@dha.test");
    await user.type(adminPasswordInputs[0], "Passw0rd123");

    await user.type(branchNameInputs[1], "Gulberg Campus");
    await user.type(cityInputs[1], "Lahore");
    await user.type(adminNameInputs[1], "Gulberg Admin");
    await user.type(adminEmailInputs[1], "admin@gulberg.test");
    await user.type(adminPasswordInputs[1], "Passw0rd123");

    await user.click(screen.getByRole("button", { name: "Register school group" }));

    expect(signupMultiBranchMock).toHaveBeenCalledTimes(1);
    expect(signupMultiBranchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        schoolName: "Alpha Schools",
        slug: "alpha-schools",
        plan: "TRIAL",
        themeId: "navy-blue",
        branches: [
          expect.objectContaining({ branchName: "DHA Campus", city: "Karachi", adminEmail: "admin@dha.test" }),
          expect.objectContaining({ branchName: "Gulberg Campus", city: "Lahore", adminEmail: "admin@gulberg.test" }),
        ],
      }),
    );

    // Success screen lists each branch's own login URL — no redirect to
    // /dashboard, since there's no single admin this signup logged in as.
    await waitFor(() => expect(screen.getByText("alpha-schools-dha-campus")).toBeInTheDocument());
    expect(screen.getByText("alpha-schools-gulberg-campus")).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("lets the user add a third branch row", async () => {
    const user = userEvent.setup();
    render(<SignupPage />);

    await user.click(screen.getByRole("button", { name: "Continue" }));
    await continueThroughThemeStep(user);
    await waitFor(() => expect(screen.getByRole("button", { name: /Multiple branches/ })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Multiple branches/ }));
    await user.click(screen.getByRole("button", { name: "Continue" }));

    await user.type(screen.getByLabelText(/School group name/), "Alpha Schools");
    await user.type(screen.getByLabelText(/Shared login URL/), "alpha-schools");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(screen.getAllByLabelText(/^Branch name/)).toHaveLength(2));
    await user.click(screen.getByRole("button", { name: "Add another branch" }));

    expect(screen.getAllByLabelText(/^Branch name/)).toHaveLength(3);
  });
});
