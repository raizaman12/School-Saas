import { api } from "@/lib/api";
import type { Paginated } from "./types";

export interface GuardianListItem {
  id: string;
  fullName: string;
  relationship: "FATHER" | "MOTHER" | "GUARDIAN";
  phone: string;
  email: string | null;
  userId: string | null;
}

/** One student linked to this guardian — shape returned by GET /api/guardians/:id's `students` include. */
export interface GuardianLinkedStudent {
  isPrimary: boolean;
  student: { id: string; fullName: string; studentCode: string };
}

export interface GuardianDetail extends GuardianListItem {
  cnic: string | null;
  occupation: string | null;
  students: GuardianLinkedStudent[];
}

export interface UpdateGuardianInput {
  fullName?: string;
  relationship?: "FATHER" | "MOTHER" | "GUARDIAN";
  cnic?: string;
  phone?: string;
  // Editing `email` here also updates the guardian's portal LOGIN email
  // (if they have one) — see backend guardians.ts's PATCH handler.
  email?: string;
  occupation?: string;
}

export const guardiansApi = {
  list: (params: { page?: number; limit?: number; search?: string } = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== "") as [string, string][],
    ).toString();
    return api.get<Paginated<GuardianListItem>>(`/api/guardians${qs ? `?${qs}` : ""}`);
  },
  get: (id: string) => api.get<{ data: GuardianDetail }>(`/api/guardians/${id}`).then((r) => r.data),
  update: (id: string, input: UpdateGuardianInput) =>
    api.patch<{ data: GuardianListItem }>(`/api/guardians/${id}`, input).then((r) => r.data),
  /**
   * Permanently deletes the guardian and their portal login, if any —
   * SCHOOL_ADMIN only (see backend DELETE_ROLES). A 409 means they have
   * filed student leave requests on record; surface `err.message` to the
   * admin rather than a generic failure (mirrors staffApi.remove).
   */
  remove: (id: string) => api.delete<void>(`/api/guardians/${id}`),
};
