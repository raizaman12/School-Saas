import { api } from "@/lib/api";
import type { Paginated } from "./types";

// Mirrors backend schema.prisma's BloodGroup/HealthLogOutcome enums — see
// that file's doc comment for why this is a lightweight office
// quick-reference card + first-aid log rather than a clinical EHR with
// immunization-registry/insurance integration.
export type BloodGroup =
  | "A_POSITIVE"
  | "A_NEGATIVE"
  | "B_POSITIVE"
  | "B_NEGATIVE"
  | "AB_POSITIVE"
  | "AB_NEGATIVE"
  | "O_POSITIVE"
  | "O_NEGATIVE"
  | "UNKNOWN";

export type HealthLogOutcome =
  | "RETURNED_TO_CLASS"
  | "SENT_HOME"
  | "TAKEN_TO_HOSPITAL"
  | "PARENT_CALLED_TO_COLLECT";

export const BLOOD_GROUP_LABEL: Record<BloodGroup, string> = {
  A_POSITIVE: "A+",
  A_NEGATIVE: "A-",
  B_POSITIVE: "B+",
  B_NEGATIVE: "B-",
  AB_POSITIVE: "AB+",
  AB_NEGATIVE: "AB-",
  O_POSITIVE: "O+",
  O_NEGATIVE: "O-",
  UNKNOWN: "Unknown",
};

export const HEALTH_LOG_OUTCOME_LABEL: Record<HealthLogOutcome, string> = {
  RETURNED_TO_CLASS: "Returned to class",
  SENT_HOME: "Sent home",
  TAKEN_TO_HOSPITAL: "Taken to hospital",
  PARENT_CALLED_TO_COLLECT: "Parent called to collect",
};

export interface HealthProfile {
  id: string;
  bloodGroup: BloodGroup | null;
  allergies: string | null;
  chronicConditions: string | null;
  currentMedications: string | null;
  emergencyMedicalNotes: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  doctorName: string | null;
  doctorPhone: string | null;
  updatedAt: string;
  student?: { id: string; fullName: string; studentCode: string; currentSectionId: string | null };
  updatedByUser?: { id: string; fullName: string };
}

export interface UpsertHealthProfileInput {
  bloodGroup?: BloodGroup;
  allergies?: string;
  chronicConditions?: string;
  currentMedications?: string;
  emergencyMedicalNotes?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  doctorName?: string;
  doctorPhone?: string;
}

export interface HealthLogEntry {
  id: string;
  visitDate: string;
  complaint: string;
  actionTaken: string;
  outcome: HealthLogOutcome;
  guardianNotified: boolean;
  guardianNotifiedAt: string | null;
  createdAt: string;
  student: { id: string; fullName: string; studentCode: string; currentSectionId: string | null };
  loggedByUser: { id: string; fullName: string };
}

export interface CreateHealthLogEntryInput {
  studentId: string;
  visitDate: string;
  complaint: string;
  actionTaken: string;
  outcome?: HealthLogOutcome;
  guardianNotified?: boolean;
  notifyGuardianNow?: boolean;
}

export interface UpdateHealthLogEntryInput {
  visitDate?: string;
  complaint?: string;
  actionTaken?: string;
  outcome?: HealthLogOutcome;
  guardianNotified?: boolean;
}

export const healthApi = {
  getProfile: (studentId: string) =>
    api.get<{ data: HealthProfile | null }>(`/api/health/profiles/${studentId}`).then((r) => r.data),
  saveProfile: (studentId: string, input: UpsertHealthProfileInput) =>
    api.put<{ data: HealthProfile }>(`/api/health/profiles/${studentId}`, input).then((r) => r.data),

  listLogEntries: (
    params: {
      page?: number;
      limit?: number;
      studentId?: string;
      outcome?: HealthLogOutcome;
      from?: string;
      to?: string;
    } = {},
  ) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== "") as [string, string][],
    ).toString();
    return api.get<Paginated<HealthLogEntry>>(`/api/health/log-entries${qs ? `?${qs}` : ""}`);
  },
  getLogEntry: (id: string) =>
    api.get<{ data: HealthLogEntry }>(`/api/health/log-entries/${id}`).then((r) => r.data),
  createLogEntry: (input: CreateHealthLogEntryInput) =>
    api.post<{ data: HealthLogEntry }>("/api/health/log-entries", input).then((r) => r.data),
  updateLogEntry: (id: string, input: UpdateHealthLogEntryInput) =>
    api.patch<{ data: HealthLogEntry }>(`/api/health/log-entries/${id}`, input).then((r) => r.data),
  removeLogEntry: (id: string) => api.delete<void>(`/api/health/log-entries/${id}`),
};
