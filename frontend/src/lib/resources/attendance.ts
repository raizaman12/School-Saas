import { api } from "@/lib/api";

export type AttendanceStatus = "PRESENT" | "ABSENT" | "LATE" | "LEAVE" | "HALF_DAY" | "EARLY_LEAVE";

export interface RosterEntry {
  studentId: string;
  studentCode: string;
  fullName: string;
  status: AttendanceStatus | null;
  remarks: string | null;
}

export type HolidayReason = "HOLIDAY" | "WEEKLY_OFF";

export interface RosterResult {
  holiday: { reason: HolidayReason; label: string } | null;
  roster: RosterEntry[];
}

export interface AttendanceSummaryEntry {
  studentId: string;
  studentCode: string;
  fullName: string;
  totalMarked: number;
  counts: Record<AttendanceStatus, number>;
}

export interface AttendanceRecord {
  id: string;
  date: string;
  status: AttendanceStatus;
  remarks: string | null;
}

export const attendanceApi = {
  roster: (sectionId: string, date: string) =>
    api
      .get<{ data: RosterResult }>(`/api/attendance?${new URLSearchParams({ sectionId, date })}`)
      .then((r) => r.data),

  mark: (input: {
    sectionId: string;
    // Only pass this from a specific lecture's own "quick mark" shortcut
    // (the course page) — it's what lets the backend check that lecture's
    // own timetable slot before allowing today's attendance to be saved.
    // Leave it out for the general section-wide daily Attendance page.
    sectionSubjectId?: string;
    date: string;
    records: { studentId: string; status: AttendanceStatus; remarks?: string }[];
  }) => api.post("/api/attendance", input),

  summary: (sectionId: string, from: string, to: string) =>
    api
      .get<{ data: AttendanceSummaryEntry[] }>(
        `/api/attendance/summary?${new URLSearchParams({ sectionId, from, to })}`,
      )
      .then((r) => r.data),

  studentHistory: (studentId: string, params: { from?: string; to?: string } = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][],
    ).toString();
    return api
      .get<{ data: AttendanceRecord[] }>(`/api/attendance/student/${studentId}${qs ? `?${qs}` : ""}`)
      .then((r) => r.data);
  },
};
