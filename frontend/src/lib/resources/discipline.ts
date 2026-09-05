import { api } from "@/lib/api";
import type { Paginated } from "./types";

// Mirrors backend schema.prisma's DisciplineCategory/Severity/Action enums
// — see that file's doc comment for why these are shaped around what a
// Pakistani school's own conduct register needs, not a US behavior-code
// taxonomy.
export type DisciplineCategory =
  | "UNIFORM_VIOLATION"
  | "LATE_ARRIVAL"
  | "MISSED_HOMEWORK"
  | "DISRUPTIVE_BEHAVIOR"
  | "DISRESPECT_TO_STAFF"
  | "BULLYING"
  | "FIGHTING"
  | "CHEATING"
  | "PROPERTY_DAMAGE"
  | "UNAUTHORIZED_ABSENCE"
  | "MOBILE_PHONE_VIOLATION"
  | "OTHER";

export type DisciplineSeverity = "MINOR" | "MODERATE" | "MAJOR";

export type DisciplineAction =
  | "NONE"
  | "VERBAL_WARNING"
  | "WRITTEN_WARNING"
  | "DETENTION"
  | "PARENT_CALLED"
  | "PARENT_MEETING_REQUIRED"
  | "SUSPENSION"
  | "REFERRED_TO_PRINCIPAL";

export const DISCIPLINE_CATEGORY_LABEL: Record<DisciplineCategory, string> = {
  UNIFORM_VIOLATION: "Uniform violation",
  LATE_ARRIVAL: "Late arrival",
  MISSED_HOMEWORK: "Missed homework",
  DISRUPTIVE_BEHAVIOR: "Disruptive behavior",
  DISRESPECT_TO_STAFF: "Disrespect to staff",
  BULLYING: "Bullying",
  FIGHTING: "Fighting",
  CHEATING: "Cheating",
  PROPERTY_DAMAGE: "Property damage",
  UNAUTHORIZED_ABSENCE: "Unauthorized absence",
  MOBILE_PHONE_VIOLATION: "Mobile phone violation",
  OTHER: "Other",
};

export const DISCIPLINE_ACTION_LABEL: Record<DisciplineAction, string> = {
  NONE: "No action yet",
  VERBAL_WARNING: "Verbal warning",
  WRITTEN_WARNING: "Written warning",
  DETENTION: "Detention",
  PARENT_CALLED: "Parent called",
  PARENT_MEETING_REQUIRED: "Parent meeting required",
  SUSPENSION: "Suspension",
  REFERRED_TO_PRINCIPAL: "Referred to principal",
};

export interface DisciplineRecord {
  id: string;
  incidentDate: string;
  category: DisciplineCategory;
  severity: DisciplineSeverity;
  description: string;
  actionTaken: DisciplineAction;
  actionNotes: string | null;
  guardianNotified: boolean;
  guardianNotifiedAt: string | null;
  resolved: boolean;
  resolvedAt: string | null;
  resolvedNote: string | null;
  createdAt: string;
  student: { id: string; fullName: string; studentCode: string; currentSectionId: string | null };
  reportedByUser: { id: string; fullName: string };
}

export interface CreateDisciplineRecordInput {
  studentId: string;
  incidentDate: string;
  category: DisciplineCategory;
  severity: DisciplineSeverity;
  description: string;
  actionTaken?: DisciplineAction;
  actionNotes?: string;
  guardianNotified?: boolean;
  notifyGuardianNow?: boolean;
}

export interface UpdateDisciplineRecordInput {
  category?: DisciplineCategory;
  severity?: DisciplineSeverity;
  actionTaken?: DisciplineAction;
  actionNotes?: string;
  guardianNotified?: boolean;
  resolved?: boolean;
  resolvedNote?: string;
}

export const disciplineApi = {
  list: (
    params: {
      page?: number;
      limit?: number;
      studentId?: string;
      category?: DisciplineCategory;
      severity?: DisciplineSeverity;
      resolved?: boolean;
      from?: string;
      to?: string;
    } = {},
  ) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== "") as [string, string][],
    ).toString();
    return api.get<Paginated<DisciplineRecord>>(`/api/discipline-records${qs ? `?${qs}` : ""}`);
  },
  get: (id: string) => api.get<{ data: DisciplineRecord }>(`/api/discipline-records/${id}`).then((r) => r.data),
  create: (input: CreateDisciplineRecordInput) =>
    api.post<{ data: DisciplineRecord }>("/api/discipline-records", input).then((r) => r.data),
  update: (id: string, input: UpdateDisciplineRecordInput) =>
    api.patch<{ data: DisciplineRecord }>(`/api/discipline-records/${id}`, input).then((r) => r.data),
  remove: (id: string) => api.delete<void>(`/api/discipline-records/${id}`),
};
