import { api } from "@/lib/api";
import type { Paginated } from "./types";

export type LeaveType = "SICK" | "CASUAL" | "ANNUAL" | "UNPAID" | "OTHER";
export type LeaveStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";

export interface LeaveRequest {
  id: string;
  leaveType: LeaveType;
  fromDate: string;
  toDate: string;
  reason: string;
  status: LeaveStatus;
  reviewNote: string | null;
  reviewedAt: string | null;
  staffProfile: { id: string; employeeCode: string; designation: string; user: { fullName: string } };
  reviewedByUser: { id: string; fullName: string } | null;
}

export const leaveRequestsApi = {
  // SCHOOL_ADMIN sees every staff member's requests; anyone else sees only
  // their own — the backend resolves that scope automatically.
  list: (params: { page?: number; limit?: number; status?: LeaveStatus } = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][],
    ).toString();
    return api.get<Paginated<LeaveRequest>>(`/api/staff/leave-requests${qs ? `?${qs}` : ""}`);
  },
  create: (input: { leaveType: LeaveType; fromDate: string; toDate: string; reason: string }) =>
    api.post<{ data: LeaveRequest }>("/api/staff/leave-requests", input).then((r) => r.data),
  cancel: (id: string) =>
    api.patch<{ data: LeaveRequest }>(`/api/staff/leave-requests/${id}/cancel`, {}).then((r) => r.data),
  approve: (id: string, reviewNote?: string) =>
    api
      .patch<{ data: LeaveRequest }>(`/api/staff/leave-requests/${id}/approve`, { reviewNote })
      .then((r) => r.data),
  reject: (id: string, reviewNote?: string) =>
    api
      .patch<{ data: LeaveRequest }>(`/api/staff/leave-requests/${id}/reject`, { reviewNote })
      .then((r) => r.data),
};
