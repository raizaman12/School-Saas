import { api } from "@/lib/api";
import type { Paginated } from "./types";

export type PayrollStatus = "PENDING" | "PAID";

export interface PayrollRecord {
  id: string;
  month: string;
  basicSalary: string;
  allowances: string;
  deductions: string;
  netSalary: string;
  status: PayrollStatus;
  paidAt: string | null;
  staffProfile: {
    id: string;
    employeeCode: string;
    designation: string;
    user: { fullName: string };
  };
}

export interface GeneratePayrollInput {
  staffProfileId: string;
  month: string;
  allowances?: number;
  deductions?: number;
}

export const payrollApi = {
  list: (params: { page?: number; limit?: number; month?: string; status?: PayrollStatus; staffProfileId?: string } = {}) => {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== "") search.set(k, String(v));
    });
    const qs = search.toString();
    return api.get<Paginated<PayrollRecord>>(`/api/staff/payroll${qs ? `?${qs}` : ""}`);
  },
  generate: (input: GeneratePayrollInput) =>
    api.post<{ data: PayrollRecord }>("/api/staff/payroll/generate", input).then((r) => r.data),
  // One month, every active staff member — records that already exist for
  // that month are skipped, not duplicated.
  bulkGenerate: (input: { month: string }) =>
    api
      .post<{ data: { generated: number; skipped: number } }>("/api/staff/payroll/bulk-generate", input)
      .then((r) => r.data),
  markPaid: (id: string) => api.patch<{ data: PayrollRecord }>(`/api/staff/payroll/${id}/mark-paid`).then((r) => r.data),
};
