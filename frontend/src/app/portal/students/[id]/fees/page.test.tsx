import { Suspense, act } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import PortalStudentFeesPage from "./page";

const studentMock = vi.fn();
const feesMock = vi.fn();

vi.mock("@/lib/resources/portal", () => ({
  portalApi: {
    student: (...args: unknown[]) => studentMock(...args),
    fees: (...args: unknown[]) => feesMock(...args),
  },
}));

async function renderPage() {
  await act(async () => {
    render(
      <Suspense fallback={null}>
        <PortalStudentFeesPage params={Promise.resolve({ id: "st1" })} />
      </Suspense>,
    );
  });
}

function mockStudent() {
  studentMock.mockResolvedValue({
    id: "st1",
    studentCode: "2026-000001",
    fullName: "Hassan Iqbal",
    status: "ACTIVE",
    photoUrl: null,
    currentSection: { id: "sec1", name: "A", schoolClass: { name: "Class 5" } },
  });
}

describe("PortalStudentFeesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the billed/paid/balance summary and an outstanding invoice row", async () => {
    mockStudent();
    feesMock.mockResolvedValue({
      invoices: [
        {
          id: "inv1",
          invoiceNumber: "INV-001",
          status: "UNPAID",
          period: "2026-08",
          issueDate: "2026-08-01",
          totalAmount: "2500",
        },
      ],
      summary: { totalBilled: 8000, totalPaid: 5000, balance: 3000 },
    });

    await renderPage();

    expect(await screen.findByText("Rs 8,000")).toBeInTheDocument();
    expect(screen.getByText("Rs 5,000")).toBeInTheDocument();
    expect(screen.getByText("Rs 2,500")).toBeInTheDocument();
    expect(screen.getByText("INV-001")).toBeInTheDocument();
    // The full ledger (not just what's outstanding) always loads now — a
    // paid challan collapses to a summary line instead of needing a toggle.
    expect(feesMock).toHaveBeenCalledWith("st1", { includePaid: true });
  });

  it("shows a red balance when the student owes money", async () => {
    mockStudent();
    feesMock.mockResolvedValue({
      invoices: [],
      summary: { totalBilled: 5000, totalPaid: 2000, balance: 3000 },
    });

    await renderPage();

    const balance = await screen.findByText("Rs 3,000");
    expect(balance).toHaveClass("text-red-600");
  });

  // Real gap this covers: a fully-paid invoice used to either clutter the
  // list forever (looking exactly like something still owed) or vanish
  // behind a toggle a parent had to know to click. Now it always shows, but
  // collapsed to one line — just the billing period, the date, and "Paid".
  it("collapses a paid invoice to a single period + date line instead of a full row", async () => {
    mockStudent();
    feesMock.mockResolvedValue({
      invoices: [
        {
          id: "inv1",
          invoiceNumber: "INV-002",
          status: "PAID",
          period: "2026-03",
          issueDate: "2026-03-01",
          totalAmount: "3000",
        },
      ],
      summary: { totalBilled: 3000, totalPaid: 3000, balance: 0 },
    });

    await renderPage();

    expect(await screen.findByText("2026-03 · 3/1/2026")).toBeInTheDocument();
    expect(screen.getByText("Paid")).toBeInTheDocument();
    // Collapsed means collapsed — the full invoice-number/table row for a
    // paid challan shouldn't also be sitting there.
    expect(screen.queryByText("INV-002")).not.toBeInTheDocument();
    expect(screen.getByText("Nothing currently due — all paid up.")).toBeInTheDocument();
  });

  it('shows "all paid up" instead of an empty table when nothing is outstanding', async () => {
    mockStudent();
    feesMock.mockResolvedValue({
      invoices: [],
      summary: { totalBilled: 5000, totalPaid: 5000, balance: 0 },
    });

    await renderPage();

    expect(await screen.findByText("Nothing currently due — all paid up.")).toBeInTheDocument();
  });
});
