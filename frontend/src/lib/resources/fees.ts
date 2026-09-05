import { api } from "@/lib/api";
import type { Paginated } from "./types";

export type InvoiceStatus = "UNPAID" | "PARTIALLY_PAID" | "PAID" | "OVERDUE" | "CANCELLED";
export type FeeFrequency = "ONE_TIME" | "MONTHLY" | "QUARTERLY" | "ANNUAL";
export type PaymentMethod = "CASH" | "BANK_TRANSFER" | "CARD" | "ONLINE" | "CHEQUE";

export interface FeeCategory {
  id: string;
  name: string;
}

export interface FeeStructureItem {
  id: string;
  amount: string;
  frequency: FeeFrequency;
  feeCategory: { id: string; name: string };
  schoolClass: { id: string; name: string };
  academicYear: { id: string; name: string };
}

export interface InvoiceListItem {
  id: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  // Billing period label (e.g. "2026-08" for a monthly invoice) — what a
  // paid challan collapses down to showing once it's settled, alongside
  // the date, instead of its full line-item breakdown.
  period: string;
  totalAmount: string;
  lateFineAmount: string;
  paidAmount: string;
  issueDate: string;
  dueDate: string;
  student: { id: string; fullName: string; studentCode: string };
}

export interface Payment {
  id: string;
  amount: string;
  method: PaymentMethod;
  referenceNumber: string | null;
  createdAt: string;
}

export interface InvoiceDetail extends InvoiceListItem {
  lineItems: { id: string; description: string; amount: string; feeCategory?: { name: string } }[];
  payments: Payment[];
}

export interface StudentLedger {
  student: { id: string; fullName: string; studentCode: string };
  invoices: InvoiceDetail[];
  summary: { totalBilled: number; totalPaid: number; balance: number };
}

export type LateFeeType = "FIXED" | "PERCENTAGE";

export interface LateFeePolicy {
  id: string;
  graceDays: number;
  fineType: LateFeeType;
  fineValue: string;
  isActive: boolean;
}

export interface DefaulterInvoice {
  invoiceId: string;
  invoiceNumber: string;
  period: string;
  dueDate: string;
  status: InvoiceStatus;
  totalAmount: string;
  lateFineAmount: string;
  paidAmount: string;
  amountDue: number;
  student: {
    id: string;
    fullName: string;
    studentCode: string;
    currentSection: { name: string; schoolClass: { name: string } } | null;
  };
}

export const feesApi = {
  listCategories: () => api.get<{ data: FeeCategory[] }>("/api/fee-categories").then((r) => r.data),
  createCategory: (input: { name: string }) =>
    api.post<{ data: FeeCategory }>("/api/fee-categories", input).then((r) => r.data),

  listStructureItems: () =>
    api.get<{ data: FeeStructureItem[] }>("/api/fee-structure-items").then((r) => r.data),
  createStructureItem: (input: {
    academicYearId: string;
    schoolClassId: string;
    feeCategoryId: string;
    amount: number;
    frequency: FeeFrequency;
  }) => api.post<{ data: FeeStructureItem }>("/api/fee-structure-items", input).then((r) => r.data),

  listInvoices: (params: { page?: number; limit?: number; studentId?: string; status?: InvoiceStatus } = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== "") as [string, string][],
    ).toString();
    return api.get<Paginated<InvoiceListItem>>(`/api/invoices${qs ? `?${qs}` : ""}`);
  },
  getInvoice: (id: string) => api.get<{ data: InvoiceDetail }>(`/api/invoices/${id}`).then((r) => r.data),

  bulkGenerate: (input: {
    sectionId: string;
    academicYearId: string;
    period: string;
    issueDate: string;
    dueDate: string;
  }) =>
    api
      .post<{ data: { generated: number; skipped: number; invoices: InvoiceListItem[] } }>(
        "/api/invoices/bulk-generate",
        input,
      )
      .then((r) => r.data),

  recordPayment: (
    invoiceId: string,
    input: { amount: number; method: PaymentMethod; referenceNumber?: string; idempotencyKey: string },
  ) => api.post<{ data: { invoice: InvoiceDetail } }>(`/api/invoices/${invoiceId}/payments`, input).then((r) => r.data),

  // One-click full settlement — no amount to type, the server pays off
  // whatever remains. Idempotent: calling it again on an already-PAID
  // invoice just returns it unchanged with payment: null.
  markPaid: (invoiceId: string, input: { method?: PaymentMethod; referenceNumber?: string } = {}) =>
    api
      .patch<{ data: { invoice: InvoiceDetail; payment: Payment | null } }>(`/api/invoices/${invoiceId}/mark-paid`, input)
      .then((r) => r.data),

  // Undo a mistaken mark-paid — Accountant-only on the backend
  // (PAYMENT_REVERSAL_ROLES); the frontend hides the button for anyone
  // else, but the real enforcement is server-side.
  revertToUnpaid: (invoiceId: string) =>
    api.patch<{ data: { invoice: InvoiceDetail } }>(`/api/invoices/${invoiceId}/revert-to-unpaid`).then((r) => r.data),

  studentLedger: (studentId: string) =>
    api.get<{ data: StudentLedger }>(`/api/invoices/students/${studentId}/ledger`).then((r) => r.data),

  // Returns { data: null } when the tenant hasn't configured a policy yet.
  getLateFeePolicy: () => api.get<{ data: LateFeePolicy | null }>("/api/late-fee-policy").then((r) => r.data),
  saveLateFeePolicy: (input: { graceDays: number; fineType: LateFeeType; fineValue: number; isActive: boolean }) =>
    api.put<{ data: LateFeePolicy }>("/api/late-fee-policy", input).then((r) => r.data),

  listDefaulters: (
    params: { page?: number; limit?: number; academicYearId?: string; schoolClassId?: string; sectionId?: string } = {},
  ) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== "") as [string, string][],
    ).toString();
    return api.get<Paginated<DefaulterInvoice>>(`/api/invoices/defaulters${qs ? `?${qs}` : ""}`);
  },
};
