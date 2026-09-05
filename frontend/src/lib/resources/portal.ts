import { api } from "@/lib/api";
import type { AttendanceRecord, AttendanceStatus, HolidayReason } from "./attendance";
import type { InvoiceDetail } from "./fees";
import type { Notice } from "./notices";
import type { Paginated } from "./types";
import type { DisciplineRecord } from "./discipline";
import type { SupportNeed } from "./supportNeeds";
import type { HealthProfile, HealthLogEntry } from "./health";
// Same shape as the staff side's TimetableSlot (GET /api/timetable, a
// TEACHER's own GET /api/timetable/me) — see portal.ts's GET
// .../timetable doc comment on the backend for why it's returned
// identically. Reusing the type (not just the shape) is what lets
// WeeklyTimetableGrid render both the teacher dashboard and this portal.
// (Imported normally, not just re-exported, so it's also usable below —
// `export type {...} from` alone doesn't bring a name into this module's
// own scope.)
import type { TimetableSlot as PortalTimetableSlot } from "./academics";
export type { PortalTimetableSlot };

export interface PortalStudentSummary {
  id: string;
  studentCode: string;
  fullName: string;
  status: string;
  photoUrl: string | null;
  currentSection: { id: string; name: string; schoolClass: { name: string } } | null;
}

export type PortalMe =
  | { role: "STUDENT"; student: PortalStudentSummary }
  | {
      role: "PARENT";
      guardian: { id: string; fullName: string; phone: string; email: string | null };
      children: (PortalStudentSummary & { isPrimary: boolean })[];
    };

export interface PortalAttendance {
  records: AttendanceRecord[];
  summary: { totalMarked: number; counts: Record<AttendanceStatus, number> };
  today: {
    date: string;
    isNonWorkingDay: boolean;
    reason: HolidayReason | null;
    label: string | null;
    status: AttendanceStatus | null;
  };
}

export interface PortalLedger {
  invoices: InvoiceDetail[];
  summary: { totalBilled: number; totalPaid: number; balance: number };
}

export interface PortalExam {
  id: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
}

/** One paper on the student/parent portal's exam datesheet — only ever includes subjects the admin has actually scheduled a date for. */
export interface PortalDatesheetEntry {
  examSubjectId: string;
  subject: string;
  examDate: string;
  startTime: string | null;
  maxMarks: number;
}

export interface PortalReportCardSubject {
  subject: string;
  maxMarks: number;
  passingMarks: number;
  marksObtained: number | null;
  percentage: number | null;
  grade: string | null;
  passed: boolean | null;
}

export interface PortalReportCard {
  exam: { id: string; name: string; academicYear: string };
  student: { id: string; studentCode: string; fullName: string; section: string | null };
  subjects: PortalReportCardSubject[];
  summary: {
    totalObtained: number;
    totalMax: number;
    percentage: number | null;
    grade: string | null;
    subjectsGraded: number;
    subjectsTotal: number;
    /** Class position among ranked students in this section for this exam — null if not currently ranked. */
    rank: number | null;
    totalRanked: number;
  };
}

export interface PortalToday {
  date: string;
  isNonWorkingDay: boolean;
  reason: HolidayReason | null;
  label: string | null;
}

/** One "course" card on the student/parent portal dashboard — a subject taught to the student's current section. */
export interface PortalCourse {
  id: string;
  subject: { id: string; name: string };
  teacher: { id: string; fullName: string } | null;
  section: { id: string; name: string; schoolClass: { name: string } };
}

export interface PortalCourseAnnouncement {
  id: string;
  title: string;
  body: string;
  tone: string;
  isPinned: boolean;
  publishedAt: string;
  publishedByUser: { id: string; fullName: string };
}

export interface PortalCourseMaterial {
  id: string;
  title: string;
  fileUrl: string;
  createdAt: string;
  uploadedByUser: { id: string; fullName: string };
}

export interface PortalCourseHomework {
  id: string;
  title: string;
  description: string | null;
  dueDate: string;
  attachmentUrl: string | null;
  assignedByUser: { id: string; fullName: string };
}

export interface PortalCourseGrade {
  exam: { id: string; name: string; startDate: string | null; endDate: string | null };
  maxMarks: number;
  passingMarks: number;
  marksObtained: number | null;
  remarks: string | null;
}

export const portalApi = {
  me: () => api.get<{ data: PortalMe }>("/api/portal/me").then((r) => r.data),

  /** School-wide "is there class today" — shown on the portal landing page. */
  today: () => api.get<{ data: PortalToday }>("/api/portal/today").then((r) => r.data),

  student: (studentId: string) =>
    api.get<{ data: PortalStudentSummary }>(`/api/portal/students/${studentId}`).then((r) => r.data),

  attendance: (studentId: string) =>
    api.get<{ data: PortalAttendance }>(`/api/portal/students/${studentId}/attendance`).then((r) => r.data),

  // By default a fully-paid invoice is left out of the list (summary
  // totals still count it) — pass includePaid: true for the full history.
  fees: (studentId: string, params: { includePaid?: boolean } = {}) =>
    api
      .get<{ data: PortalLedger }>(
        `/api/portal/students/${studentId}/fees${params.includePaid ? "?includePaid=true" : ""}`,
      )
      .then((r) => r.data),

  exams: (studentId: string) =>
    api.get<{ data: PortalExam[] }>(`/api/portal/students/${studentId}/exams`).then((r) => r.data),

  reportCard: (studentId: string, examId: string) =>
    api
      .get<{ data: PortalReportCard }>(`/api/portal/students/${studentId}/exams/${examId}/report-card`)
      .then((r) => r.data),

  examDatesheet: (studentId: string, examId: string) =>
    api
      .get<{ data: PortalDatesheetEntry[] }>(`/api/portal/students/${studentId}/exams/${examId}/datesheet`)
      .then((r) => r.data),

  disciplineRecords: (studentId: string) =>
    api.get<{ data: DisciplineRecord[] }>(`/api/portal/students/${studentId}/discipline-records`).then((r) => r.data),

  supportNeeds: (studentId: string) =>
    api.get<{ data: SupportNeed[] }>(`/api/portal/students/${studentId}/support-needs`).then((r) => r.data),

  healthProfile: (studentId: string) =>
    api.get<{ data: HealthProfile | null }>(`/api/portal/students/${studentId}/health-profile`).then((r) => r.data),

  healthLog: (studentId: string) =>
    api.get<{ data: HealthLogEntry[] }>(`/api/portal/students/${studentId}/health-log`).then((r) => r.data),

  notices: (params: { page?: number; limit?: number } = {}) => {
    const search = new URLSearchParams();
    if (params.page !== undefined) search.set("page", String(params.page));
    if (params.limit !== undefined) search.set("limit", String(params.limit));
    const qs = search.toString();
    return api.get<Paginated<Notice>>(`/api/portal/notices${qs ? `?${qs}` : ""}`);
  },

  // ── Course cards — dashboard + per-course tabs ──────────────────────
  courses: (studentId: string) =>
    api.get<{ data: PortalCourse[] }>(`/api/portal/students/${studentId}/courses`).then((r) => r.data),

  /** The student's full weekly timetable — see WeeklyTimetableGrid. */
  timetable: (studentId: string) =>
    api.get<{ data: PortalTimetableSlot[] }>(`/api/portal/students/${studentId}/timetable`).then((r) => r.data),

  courseAnnouncements: (studentId: string, sectionSubjectId: string) =>
    api
      .get<{ data: PortalCourseAnnouncement[] }>(
        `/api/portal/students/${studentId}/courses/${sectionSubjectId}/announcements`,
      )
      .then((r) => r.data),

  courseMaterials: (studentId: string, sectionSubjectId: string) =>
    api
      .get<{ data: PortalCourseMaterial[] }>(`/api/portal/students/${studentId}/courses/${sectionSubjectId}/materials`)
      .then((r) => r.data),

  courseHomework: (studentId: string, sectionSubjectId: string) =>
    api
      .get<{ data: PortalCourseHomework[] }>(`/api/portal/students/${studentId}/courses/${sectionSubjectId}/homework`)
      .then((r) => r.data),

  courseGrades: (studentId: string, sectionSubjectId: string) =>
    api
      .get<{ data: PortalCourseGrade[] }>(`/api/portal/students/${studentId}/courses/${sectionSubjectId}/grades`)
      .then((r) => r.data),
};
