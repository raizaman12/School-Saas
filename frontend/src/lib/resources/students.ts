import { api, uploadFile } from "@/lib/api";
import type { Paginated } from "./types";

// ARCHIVED is the "an admin removed this record" soft-delete state — set only
// via studentsApi.remove() (DELETE /:id), never selectable from the normal
// status-edit dropdown. See dashboard/previous-data for where archived
// students are browsed back.
export type StudentStatus = "ACTIVE" | "INACTIVE" | "GRADUATED" | "TRANSFERRED_OUT" | "EXPELLED" | "ARCHIVED";
export type Gender = "MALE" | "FEMALE" | "OTHER";

export interface StudentListItem {
  id: string;
  studentCode: string;
  fullName: string;
  status: StudentStatus;
  currentSection: { id: string; name: string; schoolClass: { name: string } } | null;
  // The student's portal-login account — every admission gets one now
  // (see CreateStudentInput.email's doc comment); null only for a student
  // who predates that and has no login yet. email is nullable — an
  // ID-only login (loginId) has none; either can be used to log in.
  user: { id: string; email: string | null; loginId: string | null } | null;
}

export interface GuardianLink {
  isPrimary: boolean;
  guardian: {
    id: string;
    fullName: string;
    relationship: string;
    phone: string;
    email: string | null;
    // The guardian's portal-login user id, if a PARENT login exists —
    // null if this guardian was added without one.
    userId: string | null;
  };
}

export interface Enrollment {
  id: string;
  status: string;
  enrolledAt: string;
  section: { name: string };
  academicYear: { name: string };
}

export interface StudentDetail extends StudentListItem {
  gender: Gender;
  dateOfBirth: string;
  admissionDate: string;
  bFormOrCnic: string | null;
  contactPhone: string | null;
  address: string | null;
  emergencyContact: string | null;
  city: string | null;
  rollNumber: string | null;
  photoUrl: string | null;
  guardians: GuardianLink[];
  enrollments: Enrollment[];
}

/** Family-detail guardian shape for GET /api/students/me — includes cnic (the admin roster's GuardianLink deliberately omits it). */
export interface StudentMeGuardianLink {
  isPrimary: boolean;
  guardian: {
    id: string;
    fullName: string;
    relationship: string;
    cnic: string | null;
    phone: string;
    email: string | null;
  };
}

/**
 * Shape of GET /api/students/me — the student portal's own "My Profile" →
 * Bio Data tab (personal detail + family detail via guardians). Narrower
 * than StudentDetail (no enrollments/admin-only fields) since it's built
 * from a different backend query — see sis/students.ts's GET /me.
 */
export interface StudentMe {
  id: string;
  studentCode: string;
  rollNumber: string | null;
  fullName: string;
  gender: Gender;
  dateOfBirth: string;
  bFormOrCnic: string | null;
  contactPhone: string | null;
  address: string | null;
  emergencyContact: string | null;
  city: string | null;
  photoUrl: string | null;
  status: StudentStatus;
  currentSection: { id: string; name: string; schoolClass: { name: string } } | null;
  guardians: StudentMeGuardianLink[];
  healthProfile: { bloodGroup: string | null } | null;
  user: { id: string; email: string | null; loginId: string | null } | null;
}

export interface CreateStudentInput {
  fullName: string;
  gender: Gender;
  dateOfBirth: string;
  admissionDate?: string;
  bFormOrCnic?: string;
  contactPhone?: string;
  address?: string;
  emergencyContact?: string;
  city?: string;
  rollNumber?: string;
  sectionId?: string;
  academicYearId?: string;
  // Optional — the student has no email column of their own. Every
  // admission now auto-provisions a STUDENT portal login regardless (an
  // ID-based one when this is omitted — see backend sis/students.ts);
  // supplying an email also wires it up as an alternate login and emails
  // the credentials to it.
  email?: string;
  // Upload the file first via uploadsApi.image() and pass the returned URL
  // here — see ImageUploadButton, used the same way on the edit page.
  photoUrl?: string;
}

/** Returned once, right after creation — never retrievable again. Guardians stay email-only, so this is always a real email for them. */
export interface PortalLogin {
  email: string;
  tempPassword: string;
}

/** Returned once, right after a student admission — never retrievable again. email is null for an ID-only login (see CreateStudentInput.email's doc comment). */
export interface StudentPortalLogin {
  email: string | null;
  loginId: string;
  tempPassword: string;
}

export interface BulkImportRowResult {
  row: number;
  status: "created" | "error";
  studentCode?: string;
  fullName?: string;
  error?: string;
}

export interface BulkImportResult {
  totalRows: number;
  created: number;
  failed: number;
  results: BulkImportRowResult[];
}

export const studentsApi = {
  list: (params: {
    page?: number;
    limit?: number;
    search?: string;
    sectionId?: string;
    // A single status, or several combined into one query (e.g. Previous
    // Data's "Left" filter = INACTIVE + GRADUATED + EXPELLED) — the
    // backend accepts a comma-separated list (see sis/validation.ts).
    status?: StudentStatus | StudentStatus[];
  }) => {
    const { status, ...rest } = params;
    const qs = new URLSearchParams(
      Object.entries(rest).filter(([, v]) => v !== undefined && v !== "") as [string, string][],
    );
    if (status && (Array.isArray(status) ? status.length > 0 : true)) {
      qs.set("status", Array.isArray(status) ? status.join(",") : status);
    }
    const qsString = qs.toString();
    return api.get<Paginated<StudentListItem>>(`/api/students${qsString ? `?${qsString}` : ""}`);
  },
  get: (id: string) => api.get<{ data: StudentDetail }>(`/api/students/${id}`).then((r) => r.data),
  create: (input: CreateStudentInput) =>
    api.post<{ data: StudentDetail; portalLogin: StudentPortalLogin }>("/api/students", input),
  update: (id: string, input: Partial<CreateStudentInput & { status: StudentStatus; photoUrl: string }>) =>
    api.patch<{ data: StudentDetail }>(`/api/students/${id}`, input).then((r) => r.data),
  /**
   * Archives the student (status -> ARCHIVED) and disables their portal
   * login — the record and every relation (fees, attendance, marks,
   * health, ...) stay completely intact; nothing is destroyed. See
   * dashboard/previous-data for where archived students are browsed back.
   */
  remove: (id: string) => api.delete<void>(`/api/students/${id}`),
  /** The logged-in student's own bio-data + family detail — 403 for any other role. */
  me: () => api.get<{ data: StudentMe }>("/api/students/me").then((r) => r.data),
  enroll: (id: string, input: { sectionId: string; academicYearId: string }) =>
    api.post(`/api/students/${id}/enroll`, input),
  bulkImport: (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return uploadFile<{ data: BulkImportResult }>("/api/students/bulk-import", formData).then((r) => r.data);
  },

  createGuardian: (input: {
    fullName: string;
    relationship: "FATHER" | "MOTHER" | "GUARDIAN";
    phone: string;
    email?: string;
    cnic?: string;
    occupation?: string;
    studentId?: string;
    isPrimary?: boolean;
  }) => api.post<{ data: unknown; portalLogin?: PortalLogin }>("/api/guardians", input),
};
