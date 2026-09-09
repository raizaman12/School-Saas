import { api } from "@/lib/api";
import type { Paginated } from "./types";

export type StaffRole = "SCHOOL_ADMIN" | "TEACHER" | "ACCOUNTANT" | "FRONT_DESK";
export type StaffStatus = "ACTIVE" | "ON_LEAVE" | "TERMINATED";
export type EmploymentType = "FULL_TIME" | "PART_TIME" | "CONTRACT";

interface StaffUser {
  id: string;
  // Nullable now — a non-SCHOOL_ADMIN staff member can log in with their
  // employeeCode instead (see `loginId` below); SCHOOL_ADMIN always has one.
  email: string | null;
  // Normalized (lowercase, dashes stripped) login ID, set for every
  // non-SCHOOL_ADMIN staff member regardless of whether email is also on
  // file — null only for SCHOOL_ADMIN, which stays email-only.
  loginId: string | null;
  fullName: string;
  phone: string | null;
  role: StaffRole;
  status: string;
  lastLoginAt: string | null;
}

export type Gender = "MALE" | "FEMALE" | "OTHER";

export interface StaffListItem {
  id: string;
  employeeCode: string;
  designation: string;
  department: string | null;
  employmentType: EmploymentType;
  status: StaffStatus;
  joiningDate: string;
  monthlySalary: string;
  photoUrl: string | null;
  // Bio Data (admin-managed, read-only to the staff member themselves) —
  // see updateMyStaffProfileSchema on the backend for why these aren't in
  // UpdateMyStaffProfileInput below.
  cnic: string | null;
  dateOfBirth: string | null;
  gender: Gender | null;
  // Contact Info — cnic above is Bio Data (read-only); these two ARE
  // self-editable via updateMe below (My Profile → About tab).
  address: string | null;
  emergencyContact: string | null;
  user: StaffUser;
}

export interface CreateStaffInput {
  // Required only for role "SCHOOL_ADMIN" — every other role now gets a
  // login ID (built from their own employeeCode) that works with no email
  // at all; supplying one still works too (either login is valid).
  email?: string;
  fullName: string;
  phone?: string;
  role: StaffRole;
  designation: string;
  department?: string;
  employmentType: EmploymentType;
  joiningDate: string;
  cnic?: string;
  dateOfBirth?: string;
  gender?: Gender;
  address?: string;
  emergencyContact?: string;
  monthlySalary: number;
  photoUrl?: string;
}

export interface UpdateStaffInput {
  designation?: string;
  department?: string;
  employmentType?: EmploymentType;
  status?: StaffStatus;
  leavingDate?: string;
  cnic?: string;
  dateOfBirth?: string;
  gender?: Gender;
  address?: string;
  emergencyContact?: string;
  monthlySalary?: number;
  phone?: string;
  fullName?: string;
  // Edits the staff member's portal login email — see backend
  // updateStaffSchema's doc comment.
  email?: string;
  photoUrl?: string;
}

export const staffApi = {
  list: (params: { page?: number; limit?: number; search?: string; status?: StaffStatus; department?: string } = {}) => {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== "") search.set(k, String(v));
    });
    const qs = search.toString();
    return api.get<Paginated<StaffListItem>>(`/api/staff${qs ? `?${qs}` : ""}`);
  },
  get: (id: string) => api.get<{ data: StaffListItem }>(`/api/staff/${id}`).then((r) => r.data),
  create: (input: CreateStaffInput) =>
    api.post<{ data: StaffListItem; tempPassword: string }>("/api/staff", input),
  update: (id: string, input: UpdateStaffInput) =>
    api.patch<{ data: StaffListItem }>(`/api/staff/${id}`, input).then((r) => r.data),
  /**
   * Narrow sibling of `update` — an Accountant sets pay rates as routine
   * work (backend SALARY_WRITE_ROLES: SCHOOL_ADMIN + ACCOUNTANT) but
   * shouldn't thereby also get the full-edit form's power over a
   * colleague's name/status/Bio Data (that stays WRITE_ROLES,
   * SCHOOL_ADMIN-only, via `update` above).
   */
  updateSalary: (id: string, monthlySalary: number) =>
    api.patch<{ data: StaffListItem }>(`/api/staff/${id}/salary`, { monthlySalary }).then((r) => r.data),
  /**
   * Archives the staff member (status -> TERMINATED) and disables their
   * portal login — SCHOOL_ADMIN only (see backend DELETE_ROLES). The
   * record and every relation it authored (homework, notices, discipline
   * records, ...) stay completely intact; nothing is destroyed. See
   * dashboard/previous-data for where archived staff are browsed back.
   */
  remove: (id: string) => api.delete<void>(`/api/staff/${id}`),

  /** The logged-in staff member's own profile (TEACHER/ACCOUNTANT/FRONT_DESK/SCHOOL_ADMIN) — 404 if they have none. */
  me: () => api.get<{ data: StaffListItem }>("/api/staff/me").then((r) => r.data),
  /**
   * Self-service — photo, address, and emergency contact only (My Profile
   * → About tab); see backend updateMyStaffProfileSchema's doc comment for
   * why the rest of the record (Bio Data: CNIC/DOB/gender) stays
   * admin-managed and isn't accepted here.
   */
  updateMe: (input: { photoUrl?: string; address?: string; emergencyContact?: string }) =>
    api.patch<{ data: StaffListItem }>("/api/staff/me", input).then((r) => r.data),
  /** Thin convenience wrapper over updateMe, kept for existing photo-only call sites. */
  updateMyPhoto: (photoUrl: string) =>
    api.patch<{ data: StaffListItem }>("/api/staff/me", { photoUrl }).then((r) => r.data),
};
