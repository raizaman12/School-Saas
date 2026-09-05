import { z } from 'zod';

export const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected date in YYYY-MM-DD format')
  .transform((v) => new Date(`${v}T00:00:00.000Z`));

// Same as dateOnlySchema, but additionally rejects a date after today (UTC
// day boundary — attendance is a same-day/past-day fact, marking it for a
// day that hasn't happened yet is always a data-entry mistake, not a
// legitimate use case). `.refine()` runs at parse (request) time, so
// "today" is evaluated fresh per request, not baked in at module load.
const notFutureDateSchema = dateOnlySchema.refine(
  (date) => {
    const todayUtc = new Date();
    todayUtc.setUTCHours(0, 0, 0, 0);
    return date.getTime() <= todayUtc.getTime();
  },
  { message: 'Attendance cannot be marked for a future date' },
);

export const attendanceStatusSchema = z.enum(['PRESENT', 'ABSENT', 'LATE', 'LEAVE', 'HALF_DAY', 'EARLY_LEAVE']);

export const markAttendanceSchema = z.object({
  sectionId: z.string().uuid(),
  // Optional — only sent by the "quick mark" shortcut on a teacher's own
  // course page (see frontend's ManageCoursePage/AttendanceTab), which is
  // scoped to one specific class/lecture rather than the whole section's
  // generic daily attendance. When present, the route checks it against
  // that lecture's own timetable slot for today and rejects marking before
  // the lecture has actually started — see attendance.ts's
  // assertLectureHasStarted. Left out entirely by the general Attendance
  // page (dashboard/attendance), which marks a whole section's daily
  // attendance with no single lecture to anchor a "started yet?" check to,
  // so that flow is completely unaffected by this.
  sectionSubjectId: z.string().uuid().optional(),
  date: notFutureDateSchema,
  records: z
    .array(
      z.object({
        studentId: z.string().uuid(),
        status: attendanceStatusSchema,
        remarks: z.string().max(255).optional(),
      }),
    )
    .min(1)
    .max(300),
});
export type MarkAttendanceInput = z.infer<typeof markAttendanceSchema>;

export const rosterQuerySchema = z.object({
  sectionId: z.string().uuid(),
  date: dateOnlySchema,
});

export const studentHistoryQuerySchema = z.object({
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
});

export const summaryQuerySchema = z.object({
  sectionId: z.string().uuid(),
  from: dateOnlySchema,
  to: dateOnlySchema,
});

export const createHolidaySchema = z
  .object({
    name: z.string().min(2).max(150),
    startDate: dateOnlySchema,
    endDate: dateOnlySchema,
  })
  .refine((v) => v.endDate.getTime() >= v.startDate.getTime(), {
    message: 'endDate must be on or after startDate',
    path: ['endDate'],
  });
export type CreateHolidayInput = z.infer<typeof createHolidaySchema>;

export const listHolidaysQuerySchema = z.object({
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
});

export const updateWeeklyOffDaysSchema = z.object({
  // 0=Sunday .. 6=Saturday (JS/ISO Date.getUTCDay() convention).
  weeklyOffDays: z.array(z.number().int().min(0).max(6)).max(7),
});
export type UpdateWeeklyOffDaysInput = z.infer<typeof updateWeeklyOffDaysSchema>;
