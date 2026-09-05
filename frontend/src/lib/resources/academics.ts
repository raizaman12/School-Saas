import { api } from "@/lib/api";

export interface AcademicYear {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
}

export interface SchoolClass {
  id: string;
  name: string;
  order: number;
}

export interface Section {
  id: string;
  name: string;
  roomNumber: string | null;
  capacity: number | null;
  schoolClass: { id: string; name: string; order: number };
  academicYear: { id: string; name: string; isActive: boolean };
  classTeacher: { id: string; fullName: string; email: string } | null;
  _count: { students: number };
}

export interface SectionSubject {
  id: string;
  subject: { id: string; name: string; code: string | null };
  teacher: { id: string; fullName: string; email: string } | null;
  // true = an elective/subject-combination subject — only the students in
  // its elective roster (see electiveStudentsApi below) actually take it,
  // rather than every student in the section. See schema.prisma's
  // StudentElectiveEnrollment doc comment for the Pakistan-adaptation
  // reasoning (a scoped-down alternative to PowerScheduler).
  isElective: boolean;
}

/** One "course I teach" card on the teacher dashboard — a section-subject assignment plus its weekly timetable slots. */
export interface MySectionSubject {
  id: string;
  subject: { id: string; name: string };
  section: { id: string; name: string; schoolClass: { id: string; name: string } };
  timetableSlots: {
    id: string;
    dayOfWeek: DayOfWeek;
    startTime: string;
    endTime: string;
    roomNumber: string | null;
  }[];
}

/** One row of a section-subject's elective roster — a section student plus whether they're currently enrolled in this particular elective. */
export interface ElectiveStudentRow {
  id: string;
  fullName: string;
  studentCode: string;
  enrolled: boolean;
}

export interface Subject {
  id: string;
  name: string;
  code: string | null;
}

export type DayOfWeek =
  | "MONDAY"
  | "TUESDAY"
  | "WEDNESDAY"
  | "THURSDAY"
  | "FRIDAY"
  | "SATURDAY"
  | "SUNDAY";

export interface TimetableSlot {
  id: string;
  dayOfWeek: DayOfWeek;
  // "HH:MM:SS" (or similar time-of-day string) as returned by the API —
  // display-only, always rendered via formatSlotTime() below rather than
  // parsed as a full date.
  startTime: string;
  endTime: string;
  roomNumber: string | null;
  sectionSubject: {
    id: string;
    subject: { id: string; name: string; code: string | null };
    teacher: { id: string; fullName: string } | null;
    section: { id: string; name: string; schoolClass: { name: string } };
  };
}

/** "1970-01-01T08:00:00.000Z" (or a bare "08:00:00") -> "08:00". */
export function formatSlotTime(value: string): string {
  const match = value.match(/(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : value;
}

export const academicsApi = {
  listYears: () => api.get<{ data: AcademicYear[] }>("/api/academic-years").then((r) => r.data),
  createYear: (input: { name: string; startDate: string; endDate: string; isActive?: boolean }) =>
    api.post<{ data: AcademicYear }>("/api/academic-years", input).then((r) => r.data),

  listClasses: () => api.get<{ data: SchoolClass[] }>("/api/classes").then((r) => r.data),
  createClass: (input: { name: string; order: number }) =>
    api.post<{ data: SchoolClass }>("/api/classes", input).then((r) => r.data),

  listSections: (params: { academicYearId?: string; schoolClassId?: string } = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][],
    ).toString();
    return api.get<{ data: Section[] }>(`/api/sections${qs ? `?${qs}` : ""}`).then((r) => r.data);
  },
  createSection: (input: {
    schoolClassId: string;
    academicYearId: string;
    name: string;
    classTeacherId?: string;
    roomNumber?: string;
    capacity?: number;
  }) => api.post<{ data: Section }>("/api/sections", input).then((r) => r.data),

  listSubjects: () => api.get<{ data: Subject[] }>("/api/subjects").then((r) => r.data),
  createSubject: (input: { name: string; code?: string }) =>
    api.post<{ data: Subject }>("/api/subjects", input).then((r) => r.data),

  listSectionSubjects: (sectionId: string) =>
    api.get<{ data: SectionSubject[] }>(`/api/sections/${sectionId}/subjects`).then((r) => r.data),
  /** The logged-in TEACHER's own subject-teacher assignments (each course they teach) — powers the teacher dashboard's course cards. */
  mySectionSubjects: () =>
    api.get<{ data: MySectionSubject[] }>("/api/section-subjects/me").then((r) => r.data),
  assignSectionSubject: (sectionId: string, input: { subjectId: string; teacherId?: string; isElective?: boolean }) =>
    api.post<{ data: SectionSubject }>(`/api/sections/${sectionId}/subjects`, input).then((r) => r.data),
  updateSectionSubject: (
    sectionSubjectId: string,
    input: { teacherId?: string | null; isElective?: boolean },
  ) => api.patch<{ data: SectionSubject }>(`/api/section-subjects/${sectionSubjectId}`, input).then((r) => r.data),
  removeSectionSubject: (sectionSubjectId: string) =>
    api.delete<void>(`/api/section-subjects/${sectionSubjectId}`),

  listElectiveStudents: (sectionSubjectId: string) =>
    api
      .get<{ data: ElectiveStudentRow[] }>(`/api/section-subjects/${sectionSubjectId}/elective-students`)
      .then((r) => r.data),
  setElectiveStudents: (sectionSubjectId: string, studentIds: string[]) =>
    api.put<void>(`/api/section-subjects/${sectionSubjectId}/elective-students`, { studentIds }),

  listTimetable: (sectionId: string) =>
    api.get<{ data: TimetableSlot[] }>(`/api/timetable?sectionId=${sectionId}`).then((r) => r.data),
  myTimetable: () => api.get<{ data: TimetableSlot[] }>("/api/timetable/me").then((r) => r.data),
  createTimetableSlot: (input: {
    sectionSubjectId: string;
    dayOfWeek: DayOfWeek;
    startTime: string;
    endTime: string;
    roomNumber?: string;
  }) => api.post<{ data: TimetableSlot }>("/api/timetable", input).then((r) => r.data),
  updateTimetableSlot: (
    slotId: string,
    input: Partial<{
      sectionSubjectId: string;
      dayOfWeek: DayOfWeek;
      startTime: string;
      endTime: string;
      roomNumber: string | null;
    }>,
  ) => api.patch<{ data: TimetableSlot }>(`/api/timetable/${slotId}`, input).then((r) => r.data),
  removeTimetableSlot: (slotId: string) => api.delete<void>(`/api/timetable/${slotId}`),

  /**
   * Year-end "move to next class" — bulk-promotes the given (or, if
   * omitted, every currently-ACTIVE) student in `sourceSectionId` into
   * `targetSectionId`/`targetAcademicYearId` in one call. Students left
   * out of `studentIds` are held back (repeaters) in their current
   * section. A student leaving the school entirely should get a transfer
   * certificate instead (see the student detail page), not be excluded
   * here.
   */
  promoteSection: (
    sourceSectionId: string,
    input: { targetSectionId: string; targetAcademicYearId: string; studentIds?: string[] },
  ) =>
    api
      .post<{ data: { promotedCount: number; students: { id: string }[] } }>(
        `/api/sections/${sourceSectionId}/promote`,
        input,
      )
      .then((r) => r.data),
};
