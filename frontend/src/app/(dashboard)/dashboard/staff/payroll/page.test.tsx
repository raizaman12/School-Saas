import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PayrollPage from "./page";

// Up to three "Month"-ish labels can be on screen at once: the single-staff
// form's "Month" (once it's open), BulkGenerateSection's "Month", and the
// page's own "Month filter". Required fields render a trailing " *" inside
// the <label> (see Input.tsx), which makes their accessible label text
// "Month *" rather than "Month" — an exact-match getAllByLabelText("Month")
// silently excludes that field entirely. Match "Month" or "Month *" only
// (anchored both ends) so "Month filter" is never picked up by mistake.
function requiredMonthInput() {
  return screen.getAllByLabelText(/^Month\s*\*?$/).find((el) => el.hasAttribute("required")) as HTMLElement;
}
function optionalMonthInput() {
  return screen.getAllByLabelText(/^Month\s*\*?$/).find((el) => !el.hasAttribute("required")) as HTMLElement;
}

const listMock = vi.fn();
const bulkGenerateMock = vi.fn();
const generateMock = vi.fn();
const markPaidMock = vi.fn();
const staffListMock = vi.fn();

vi.mock("@/lib/resources/payroll", () => ({
  payrollApi: {
    list: (...args: unknown[]) => listMock(...args),
    bulkGenerate: (...args: unknown[]) => bulkGenerateMock(...args),
    generate: (...args: unknown[]) => generateMock(...args),
    markPaid: (...args: unknown[]) => markPaidMock(...args),
  },
}));

vi.mock("@/lib/resources/staff", () => ({
  staffApi: { list: (...args: unknown[]) => staffListMock(...args) },
}));

describe("PayrollPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    staffListMock.mockResolvedValue({ data: [], meta: { page: 1, limit: 100, total: 0, totalPages: 1 } });
    listMock.mockResolvedValue({ data: [], meta: { page: 1, limit: 20, total: 0, totalPages: 1 } });
  });

  // Real gap this covers: generating payroll only ever took one
  // staffProfileId at a time — an admin had to repeat the form once per
  // employee before anyone could even be marked paid for the month.
  it('generates payroll for every active staff member via "Generate for all staff"', async () => {
    bulkGenerateMock.mockResolvedValue({ generated: 12, skipped: 2 });
    const user = userEvent.setup();
    render(<PayrollPage />);

    await waitFor(() => expect(listMock).toHaveBeenCalled());

    await user.type(optionalMonthInput(), "2026-03");
    await user.click(screen.getByRole("button", { name: "Generate for all staff" }));

    await waitFor(() => expect(bulkGenerateMock).toHaveBeenCalledWith({ month: "2026-03" }));
    expect(
      await screen.findByText("Generated payroll for 12 staff member(s), skipped 2 (already generated for this month)."),
    ).toBeInTheDocument();
    // The list should refresh after a bulk generate, same as the
    // single-staff generate form already does.
    expect(listMock).toHaveBeenCalledTimes(2);
  });

  it("still supports generating payroll for one staff member at a time", async () => {
    // staffProfileId is validated as z.string().uuid() on submit — a
    // non-UUID id like "s1" fails that check silently (the form just
    // re-shows "Select a staff member" and never calls generate()), so the
    // mock id here has to actually look like a UUID.
    const staffId = "11111111-1111-4111-8111-111111111111";
    staffListMock.mockResolvedValue({
      data: [{ id: staffId, user: { fullName: "Bilal Ahmed" }, employeeCode: "EDU-EMP-000001" }],
      meta: { page: 1, limit: 100, total: 1, totalPages: 1 },
    });
    generateMock.mockResolvedValue({ id: "pr1" });
    const user = userEvent.setup();
    render(<PayrollPage />);

    await user.click(screen.getByRole("button", { name: "Generate payroll" }));
    await screen.findByRole("option", { name: /Bilal Ahmed/ }); // wait for staffApi.list() to resolve
    await user.selectOptions(screen.getByLabelText(/Staff member/), staffId);
    await user.type(requiredMonthInput(), "2026-03");
    await user.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() =>
      expect(generateMock).toHaveBeenCalledWith(
        expect.objectContaining({ staffProfileId: staffId, month: "2026-03" }),
      ),
    );
  });

  it("lets an admin mark a pending payroll record as paid", async () => {
    listMock.mockResolvedValue({
      data: [
        {
          id: "pr1",
          month: "2026-03",
          netSalary: "60000",
          status: "PENDING",
          staffProfile: { employeeCode: "EDU-EMP-000001", user: { fullName: "Bilal Ahmed" } },
        },
      ],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    markPaidMock.mockResolvedValue({});
    const user = userEvent.setup();
    render(<PayrollPage />);

    await user.click(await screen.findByRole("button", { name: "Mark paid" }));
    await user.click(screen.getByRole("button", { name: "Confirm mark paid" }));

    expect(markPaidMock).toHaveBeenCalledWith("pr1");
  });
});
