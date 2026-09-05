import { Suspense, act } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InvoiceDetailPage from "./page";

const getInvoiceMock = vi.fn();
const markPaidMock = vi.fn();
const recordPaymentMock = vi.fn();
const revertToUnpaidMock = vi.fn();

vi.mock("@/lib/resources/fees", async () => {
  const actual = await vi.importActual<typeof import("@/lib/resources/fees")>("@/lib/resources/fees");
  return {
    ...actual,
    feesApi: {
      getInvoice: (...args: unknown[]) => getInvoiceMock(...args),
      markPaid: (...args: unknown[]) => markPaidMock(...args),
      recordPayment: (...args: unknown[]) => recordPaymentMock(...args),
      revertToUnpaid: (...args: unknown[]) => revertToUnpaidMock(...args),
    },
  };
});

// Only Accountant sees the "Revert to unpaid" option (see
// PAYMENT_REVERSAL_ROLES on the backend) — defaults to SCHOOL_ADMIN so the
// existing mark-paid tests aren't affected by it.
let mockRole: string | undefined = "SCHOOL_ADMIN";
vi.mock("@/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u1", role: mockRole } }),
}));

async function renderPage() {
  await act(async () => {
    render(
      <Suspense fallback={null}>
        <InvoiceDetailPage params={Promise.resolve({ id: "inv1" })} />
      </Suspense>,
    );
  });
}

function baseInvoice(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "inv1",
    invoiceNumber: "INV-2026-000001",
    status: "UNPAID",
    totalAmount: "5000",
    lateFineAmount: "0",
    paidAmount: "0",
    issueDate: "2026-02-01",
    dueDate: "2026-02-10",
    student: { id: "st1", fullName: "Hassan Iqbal", studentCode: "2026-000001" },
    lineItems: [{ id: "li1", description: "Tuition Fee", amount: "5000" }],
    payments: [],
    ...overrides,
  };
}

describe("InvoiceDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRole = "SCHOOL_ADMIN";
  });

  // Real gap this covers: before this, settling an invoice meant reading
  // the remaining balance off the screen and typing that exact figure into
  // the payment form — a one-click "mark fully paid" didn't exist at all.
  it('marks an invoice fully paid with one click via "Mark fully paid"', async () => {
    getInvoiceMock.mockResolvedValue(baseInvoice());
    markPaidMock.mockResolvedValue({
      invoice: baseInvoice({ status: "PAID", paidAmount: "5000" }),
      payment: { id: "p1", amount: "5000", method: "CASH", referenceNumber: null, createdAt: "2026-02-05" },
    });
    const user = userEvent.setup();
    await renderPage();

    expect(await screen.findByText("INV-2026-000001")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Mark fully paid" }));
    await user.click(screen.getByRole("button", { name: "Confirm mark paid" }));

    expect(markPaidMock).toHaveBeenCalledWith("inv1");
    expect(await screen.findByText(/Marked fully paid/)).toBeInTheDocument();
    expect(screen.getByText("PAID")).toBeInTheDocument();
    // Once paid, there's nothing left to pay — both the mark-paid action
    // and the manual payment form should be gone.
    expect(screen.queryByRole("button", { name: "Mark fully paid" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Record payment" })).not.toBeInTheDocument();
  });

  it("does not show a mark-paid option for an invoice that's already fully paid", async () => {
    getInvoiceMock.mockResolvedValue(baseInvoice({ status: "PAID", paidAmount: "5000" }));
    await renderPage();

    expect(await screen.findByText("INV-2026-000001")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark fully paid" })).not.toBeInTheDocument();
  });

  it("still allows recording a specific partial amount alongside the mark-paid shortcut", async () => {
    getInvoiceMock.mockResolvedValue(baseInvoice());
    await renderPage();

    expect(await screen.findByRole("button", { name: "Mark fully paid" })).toBeInTheDocument();
    expect(screen.getByText("Or record a specific (e.g. partial) amount")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record payment" })).toBeInTheDocument();
  });

  // Real gap this covers: once an Accountant fat-fingers "Mark fully paid"
  // on the wrong invoice, there was no way back short of a database fix.
  it("lets an Accountant revert a paid invoice back to unpaid", async () => {
    mockRole = "ACCOUNTANT";
    getInvoiceMock.mockResolvedValue(baseInvoice({ status: "PAID", paidAmount: "5000" }));
    revertToUnpaidMock.mockResolvedValue({ invoice: baseInvoice({ status: "UNPAID", paidAmount: "0" }) });
    const user = userEvent.setup();
    await renderPage();

    expect(await screen.findByText("PAID")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Revert to unpaid" }));
    await user.click(screen.getByRole("button", { name: "Yes, revert this" }));

    expect(revertToUnpaidMock).toHaveBeenCalledWith("inv1");
    expect(await screen.findByText("UNPAID")).toBeInTheDocument();
    // Reverting brought the balance back, which un-hides the payment forms.
    expect(screen.getByRole("button", { name: "Mark fully paid" })).toBeInTheDocument();
  });

  it("hides the revert-to-unpaid option from roles other than Accountant", async () => {
    mockRole = "SCHOOL_ADMIN";
    getInvoiceMock.mockResolvedValue(baseInvoice({ status: "PAID", paidAmount: "5000" }));
    await renderPage();

    expect(await screen.findByText("PAID")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Revert to unpaid" })).not.toBeInTheDocument();
  });
});
