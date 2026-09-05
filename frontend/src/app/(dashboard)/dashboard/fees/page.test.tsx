import { act } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FeesPage from "./page";

const listCategoriesMock = vi.fn();
const listStructureItemsMock = vi.fn();
const getLateFeePolicyMock = vi.fn();
const listDefaultersMock = vi.fn();
const listInvoicesMock = vi.fn();
const markPaidMock = vi.fn();
const revertToUnpaidMock = vi.fn();

vi.mock("@/lib/resources/fees", async () => {
  const actual = await vi.importActual<typeof import("@/lib/resources/fees")>("@/lib/resources/fees");
  return {
    ...actual,
    feesApi: {
      listCategories: (...args: unknown[]) => listCategoriesMock(...args),
      listStructureItems: (...args: unknown[]) => listStructureItemsMock(...args),
      getLateFeePolicy: (...args: unknown[]) => getLateFeePolicyMock(...args),
      listDefaulters: (...args: unknown[]) => listDefaultersMock(...args),
      listInvoices: (...args: unknown[]) => listInvoicesMock(...args),
      markPaid: (...args: unknown[]) => markPaidMock(...args),
      revertToUnpaid: (...args: unknown[]) => revertToUnpaidMock(...args),
    },
  };
});

vi.mock("@/lib/resources/academics", () => ({
  academicsApi: {
    listYears: () => Promise.resolve([]),
    listClasses: () => Promise.resolve([]),
    listSections: () => Promise.resolve([]),
  },
}));

// Defaults to SCHOOL_ADMIN so pre-existing behaviour (mark-paid visible,
// revert-to-unpaid hidden) isn't affected by the role-gating tests below.
let mockRole: string | undefined = "SCHOOL_ADMIN";
vi.mock("@/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u1", role: mockRole } }),
}));

function baseInvoice(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "inv1",
    invoiceNumber: "INV-2026-000001",
    status: "UNPAID",
    period: "2026-02",
    totalAmount: "5000",
    lateFineAmount: "0",
    paidAmount: "0",
    issueDate: "2026-02-01",
    dueDate: "2026-02-10",
    student: { id: "st1", fullName: "Hassan Iqbal", studentCode: "2026-000001" },
    ...overrides,
  };
}

function invoicesPage(invoices: ReturnType<typeof baseInvoice>[]) {
  return { data: invoices, meta: { page: 1, limit: 20, total: invoices.length, totalPages: 1 } };
}

async function renderPage() {
  await act(async () => {
    render(<FeesPage />);
  });
}

describe("FeesPage — Invoices list status editing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRole = "SCHOOL_ADMIN";
    listCategoriesMock.mockResolvedValue([]);
    listStructureItemsMock.mockResolvedValue([]);
    getLateFeePolicyMock.mockResolvedValue(null);
    listDefaultersMock.mockResolvedValue(invoicesPage([]));
  });

  // Real gap this covers: correcting a wrong status used to require opening
  // the invoice's own detail page first — there was no way to act on it
  // from the list where the status is actually shown.
  it("lets a payment-capable role mark an unpaid invoice paid right from the invoice list", async () => {
    listInvoicesMock.mockResolvedValue(invoicesPage([baseInvoice({ status: "UNPAID" })]));
    markPaidMock.mockResolvedValue({
      invoice: baseInvoice({ status: "PAID", paidAmount: "5000" }),
      payment: { id: "p1", amount: "5000", method: "CASH", referenceNumber: null, createdAt: "2026-02-05" },
    });
    const user = userEvent.setup();
    await renderPage();

    const row = (await screen.findByText("INV-2026-000001")).closest("tr")!;
    await user.click(within(row).getByRole("button", { name: /Edit status/ }));
    await user.click(within(row).getByRole("button", { name: "Mark fully paid" }));
    await user.click(within(row).getByRole("button", { name: "Confirm mark paid" }));

    expect(markPaidMock).toHaveBeenCalledWith("inv1");
    // The action refetches the list, which now reports PAID.
    expect(listInvoicesMock).toHaveBeenCalledTimes(2);
  });

  it("lets an Accountant revert a paid invoice back to unpaid right from the invoice list", async () => {
    mockRole = "ACCOUNTANT";
    listInvoicesMock.mockResolvedValue(invoicesPage([baseInvoice({ status: "PAID", paidAmount: "5000" })]));
    revertToUnpaidMock.mockResolvedValue({ invoice: baseInvoice({ status: "UNPAID", paidAmount: "0" }) });
    const user = userEvent.setup();
    await renderPage();

    const row = (await screen.findByText("INV-2026-000001")).closest("tr")!;
    await user.click(within(row).getByRole("button", { name: /Edit status/ }));
    await user.click(within(row).getByRole("button", { name: "Revert to unpaid" }));
    await user.click(within(row).getByRole("button", { name: "Yes, revert this" }));

    expect(revertToUnpaidMock).toHaveBeenCalledWith("inv1");
    expect(listInvoicesMock).toHaveBeenCalledTimes(2);
  });

  // Matches the backend's PAYMENT_REVERSAL_ROLES exactly — a non-Accountant
  // shouldn't even see the edit affordance on a paid invoice, since there's
  // nothing they're allowed to do with it.
  it("hides the edit-status affordance for a paid invoice from a non-Accountant role", async () => {
    mockRole = "SCHOOL_ADMIN";
    listInvoicesMock.mockResolvedValue(invoicesPage([baseInvoice({ status: "PAID", paidAmount: "5000" })]));
    await renderPage();

    const row = (await screen.findByText("INV-2026-000001")).closest("tr")!;
    expect(within(row).queryByRole("button", { name: /Edit status/ })).not.toBeInTheDocument();
  });

  // A cancelled invoice has no valid next state (can't be marked paid,
  // and revert-to-unpaid only applies to something that was PAID) — no
  // edit affordance should be offered for it at all.
  it("hides the edit-status affordance for a cancelled invoice", async () => {
    listInvoicesMock.mockResolvedValue(invoicesPage([baseInvoice({ status: "CANCELLED" })]));
    await renderPage();

    const row = (await screen.findByText("INV-2026-000001")).closest("tr")!;
    expect(within(row).queryByRole("button", { name: /Edit status/ })).not.toBeInTheDocument();
  });
});
