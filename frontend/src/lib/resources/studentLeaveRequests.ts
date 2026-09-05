import { api } from "@/lib/api";
import type { Paginated } from "./types";

export type StudentLeaveStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";

export interface StudentLeaveRequest {
  id: string;
  fromDate: string;
  toDate: string;
  reason: string;
  status: StudentLeaveStatus;
  reviewNote: string | null;
  reviewedAt: string | null;
  student: {
    id: string;
    fullName: string;
    studentCode: string;
    currentSection?: { id: string; name: string; schoolClass: { name: string } } | null;
  };
  requestedByUser?: { id: string; fullName: string };
  reviewedByUser: { id: string; fullName: string } | null;
}

/** PARENT-portal side: request/list/cancel leave for your own child. */
export const portalLeaveRequestsApi = {
  list: (params: { page?: number; limit?: number; status?: StudentLeaveStatus; studentId?: string } = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][],
    ).toString();
    return api.get<Paginated<StudentLeaveRequest>>(`/api/portal/leave-requests${qs ? `?${qs}` : ""}`);
  },
  create: (input: { studentId: string; fromDate: string; toDate: string; reason: string }) =>
    api.post<{ data: StudentLeaveRequest }>("/api/portal/leave-requests", input).then((r) => r.data),
  cancel: (id: string) =>
    api.patch<{ data: StudentLeaveRequest }>(`/api/portal/leave-requests/${id}/cancel`, {}).then((r) => r.data),
};

/** Staff (SCHOOL_ADMIN / TEACHER) side: view + approve/reject. */
export const studentLeaveRequestsApi = {
  list: (params: { page?: number; limit?: number; status?: StudentLeaveStatus; studentId?: string } = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][],
    ).toString();
    return api.get<Paginated<StudentLeaveRequest>>(`/api/student-leave-requests${qs ? `?${qs}` : ""}`);
  },
  approve: (id: string, reviewNote?: string) =>
    api
      .patch<{ data: StudentLeaveRequest }>(`/api/student-leave-requests/${id}/approve`, { reviewNote })
      .then((r) => r.data),
  reject: (id: string, reviewNote?: string) =>
    api
      .patch<{ data: StudentLeaveRequest }>(`/api/student-leave-requests/${id}/reject`, { reviewNote })
      .then((r) => r.data),
};
