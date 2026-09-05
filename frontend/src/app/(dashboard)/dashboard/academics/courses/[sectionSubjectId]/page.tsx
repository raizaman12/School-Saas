"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  ArrowLeft,
  Megaphone,
  FolderOpen,
  ClipboardList,
  Pin,
  Download,
  Plus,
  CalendarCheck,
  GraduationCap,
  Save,
  Check,
  CalendarOff,
  PencilLine,
  CheckCircle2,
  RotateCcw,
} from "lucide-react";
import { useAsync } from "@/lib/hooks/useAsync";
import { academicsApi, type MySectionSubject, type DayOfWeek } from "@/lib/resources/academics";
import { noticesApi, type NoticeTone } from "@/lib/resources/notices";
import { courseMaterialsApi } from "@/lib/resources/courseMaterials";
import { homeworkApi } from "@/lib/resources/homework";
import { attendanceApi, type AttendanceStatus, type RosterResult } from "@/lib/resources/attendance";
import { examsApi, type ExamForSectionSubject } from "@/lib/resources/exams";
import { classTestsApi, type ClassTest } from "@/lib/resources/classTests";
import { DocumentUploadButton } from "@/components/domain/DocumentUploadButton";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  Badge,
  Alert,
  Spinner,
  Button,
  Input,
  Textarea,
  Select,
  Card,
  CardContent,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
  EmptyState,
  ConfirmButton,
} from "@/components/ui";

type TabKey = "announcements" | "materials" | "assessment" | "attendance" | "grades";

const TABS: { key: TabKey; label: string; icon: typeof Megaphone }[] = [
  { key: "announcements", label: "Announcements", icon: Megaphone },
  { key: "materials", label: "Course Material", icon: FolderOpen },
  { key: "assessment", label: "Assessment", icon: ClipboardList },
  { key: "attendance", label: "Attendance", icon: CalendarCheck },
  { key: "grades", label: "Grades", icon: GraduationCap },
];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// Mirrors the backend's JS_DAY_TO_DAY_OF_WEEK in attendance.ts — kept in
// sync there deliberately so this preview never disagrees with what the
// server will actually accept.
const JS_DAY_TO_DAY_OF_WEEK: DayOfWeek[] = [
  "SUNDAY",
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
];

// `slot.startTime` comes back as an ISO string whose date part is a
// meaningless placeholder (Prisma's @db.Time round-trip — see the
// backend's minutesSinceMidnightUtc doc comment) — only the UTC
// hours/minutes are the real value. Reading it with getUTCHours/Minutes
// (not the local-time getHours/Minutes) here is what keeps this preview
// agreeing with the backend's own check, which does the same.
function minutesSinceMidnightUtc(iso: string): number {
  const d = new Date(iso);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

function formatSlotTime(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

// Mirrors the backend's PAKISTAN_UTC_OFFSET_MINUTES/
// minutesSinceMidnightPakistanNow in attendance.ts — kept in sync there
// deliberately. `slot.startTime`/`endTime` are the literal HH:MM an admin
// typed (always meant as Pakistan wall-clock time), while `now`'s UTC
// getters are real UTC regardless of the visitor's own device timezone —
// without this shift, the Save button would drift out of step with what
// the server actually enforces by a full 5 hours.
const PAKISTAN_UTC_OFFSET_MINUTES = 5 * 60;
function minutesSinceMidnightPakistanNow(d: Date): number {
  return (d.getUTCHours() * 60 + d.getUTCMinutes() + PAKISTAN_UTC_OFFSET_MINUTES) % (24 * 60);
}

// Mirrors the backend's LOCK_BEFORE_LECTURE_END_MINUTES in attendance.ts —
// kept in sync there deliberately, same reasoning as JS_DAY_TO_DAY_OF_WEEK
// above.
const LOCK_BEFORE_LECTURE_END_MINUTES = 5;

type LectureWindowStatus =
  | { kind: "no-slot-today" }
  | { kind: "not-started"; startTime: string; minutesUntil: number }
  | { kind: "open"; endTime: string; minutesUntilLock: number }
  | { kind: "locked"; endTime: string };

/**
 * Where this class's Save button stands against today's own timetable.
 * Mirrors the backend's assertLectureAttendanceWindowOpen so the UI
 * locks/unlocks (and hides entirely) in step with what the server would
 * actually accept:
 *  - "no-slot-today": this subject isn't on the timetable at all today —
 *    the marking grid doesn't even render, since there's no lecture to
 *    mark attendance for. Used to be treated as "nothing to enforce" and
 *    left wide open; a subject's attendance should only ever be markable
 *    from this shortcut on a day (and during the time) it's actually
 *    scheduled.
 *  - "not-started": before the slot's startTime — the original bug this
 *    fixes (a teacher hitting Save minutes before their lecture started).
 *  - "open": from startTime up to `endTime - LOCK_BEFORE_LECTURE_END_MINUTES`.
 *  - "locked": from that cutoff onward — the second half of the user's
 *    report: a teacher reopening and rewriting attendance long after the
 *    lecture was over. Locking here is only this course-page shortcut;
 *    admin/front-desk can still fix the day's record from the general
 *    Attendance page.
 * With more than one slot today (a double period), the slot that governs
 * is whichever one "now" actually falls into — an already-locked earlier
 * slot doesn't hide a later slot that hasn't started yet.
 */
function lectureWindowStatusToday(timetableSlots: MySectionSubject["timetableSlots"]): LectureWindowStatus {
  const now = new Date();
  const today = JS_DAY_TO_DAY_OF_WEEK[now.getUTCDay()];
  const nowMinutes = minutesSinceMidnightPakistanNow(now);

  const todaysSlots = timetableSlots
    .filter((s) => s.dayOfWeek === today)
    .sort((a, b) => minutesSinceMidnightUtc(a.startTime) - minutesSinceMidnightUtc(b.startTime));
  if (todaysSlots.length === 0) return { kind: "no-slot-today" };

  for (const slot of todaysSlots) {
    const startMinutes = minutesSinceMidnightUtc(slot.startTime);
    const endMinutes = minutesSinceMidnightUtc(slot.endTime);
    const lockMinutes = endMinutes - LOCK_BEFORE_LECTURE_END_MINUTES;

    if (nowMinutes < startMinutes) {
      return { kind: "not-started", startTime: slot.startTime, minutesUntil: startMinutes - nowMinutes };
    }
    if (nowMinutes < lockMinutes) {
      return { kind: "open", endTime: slot.endTime, minutesUntilLock: lockMinutes - nowMinutes };
    }
    // This slot's window is already locked — a later slot today might
    // still be upcoming, so keep looking before falling back to "locked".
  }
  return { kind: "locked", endTime: todaysSlots[todaysSlots.length - 1].endTime };
}

const ATTENDANCE_STATUS_OPTIONS: { value: AttendanceStatus; label: string; tone: string }[] = [
  { value: "PRESENT", label: "P", tone: "bg-emerald-100 text-emerald-800 border-emerald-300" },
  { value: "ABSENT", label: "A", tone: "bg-red-100 text-red-800 border-red-300" },
  { value: "LATE", label: "L", tone: "bg-amber-100 text-amber-800 border-amber-300" },
  { value: "LEAVE", label: "Lv", tone: "bg-primary-100 text-primary-800 border-primary-300" },
  { value: "HALF_DAY", label: "HD", tone: "bg-slate-200 text-slate-800 border-slate-400" },
  { value: "EARLY_LEAVE", label: "EL", tone: "bg-fuchsia-100 text-fuchsia-800 border-fuchsia-300" },
];

/**
 * A shortcut onto the same attendance-marking flow as the full Attendance
 * page (dashboard/attendance), pre-scoped to this course's own section so a
 * teacher doesn't have to re-pick class/section/date — see the user's
 * original ask: mark attendance for "whichever kids study this subject, in
 * the class I'm signed to teach" right from the subject page.
 */
function AttendanceTab({
  sectionId,
  sectionSubjectId,
  timetableSlots,
}: {
  sectionId: string;
  sectionSubjectId: string;
  timetableSlots: MySectionSubject["timetableSlots"];
}) {
  const [date, setDate] = useState(todayIso());
  const [roster, setRoster] = useState<Record<string, AttendanceStatus | null>>({});
  const [rosterOrder, setRosterOrder] = useState<{ studentId: string; studentCode: string; fullName: string }[]>([]);
  const [holiday, setHoliday] = useState<RosterResult["holiday"]>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  // Re-checked every 15s purely so the "starts in N minutes" banner below
  // counts down and the Save button re-enables itself the moment the
  // lecture's start time passes, without the teacher needing to refresh.
  const [, forceTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 15_000);
    return () => clearInterval(id);
  }, []);

  const lectureWindow = date === todayIso() ? lectureWindowStatusToday(timetableSlots) : null;

  useEffect(() => {
    setIsLoading(true);
    setError(null);
    setSavedAt(null);
    attendanceApi
      .roster(sectionId, date)
      .then(({ holiday, roster: entries }) => {
        setHoliday(holiday);
        setRosterOrder(entries.map((e) => ({ studentId: e.studentId, studentCode: e.studentCode, fullName: e.fullName })));
        setRoster(Object.fromEntries(entries.map((e) => [e.studentId, e.status])));
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load roster."))
      .finally(() => setIsLoading(false));
  }, [sectionId, date]);

  const setStatus = (studentId: string, status: AttendanceStatus) => {
    setRoster((prev) => ({ ...prev, [studentId]: status }));
  };

  const markAllPresent = () => {
    setRoster((prev) => {
      const next = { ...prev };
      for (const s of rosterOrder) next[s.studentId] = "PRESENT";
      return next;
    });
  };

  const handleSave = async () => {
    const records = rosterOrder
      .filter((s) => roster[s.studentId])
      .map((s) => ({ studentId: s.studentId, status: roster[s.studentId]! }));
    if (records.length === 0) return;

    setIsSaving(true);
    setError(null);
    try {
      await attendanceApi.mark({ sectionId, sectionSubjectId, date, records });
      setSavedAt(new Date());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save attendance.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-slate-500">Marks attendance for every student in this class — not just this subject&apos;s own roster.</p>
        <Input label="Date" type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} className="sm:w-44" />
      </div>

      {error && <Alert tone="danger">{error}</Alert>}
      {savedAt && (
        <Alert tone="success">
          <span className="inline-flex items-center gap-1.5">
            <Check className="size-4" aria-hidden="true" /> Attendance saved for {date}.
          </span>
        </Alert>
      )}

      {isLoading && <Spinner label="Loading roster" />}

      {!isLoading && holiday && (
        <Alert tone="warning" title="No class on this date">
          <span className="inline-flex items-center gap-1.5">
            <CalendarOff className="size-4" aria-hidden="true" />
            {holiday.reason === "WEEKLY_OFF" ? `Weekly off — ${holiday.label}` : holiday.label}. Attendance cannot be
            marked for this date.
          </span>
        </Alert>
      )}

      {!isLoading && !holiday && lectureWindow?.kind === "no-slot-today" && (
        <Alert tone="warning" title="Not on today's timetable">
          <span className="inline-flex items-center gap-1.5">
            <CalendarOff className="size-4" aria-hidden="true" />
            This subject has no lecture scheduled for today — attendance can only be marked here on a day (and
            during the time) it actually runs. Ask an admin to correct the timetable if this looks wrong.
          </span>
        </Alert>
      )}

      {!isLoading && !holiday && lectureWindow?.kind === "not-started" && (
        <Alert tone="warning" title="This lecture hasn't started yet">
          <span className="inline-flex items-center gap-1.5">
            <CalendarOff className="size-4" aria-hidden="true" />
            Scheduled for {formatSlotTime(lectureWindow.startTime)} today — starts in {lectureWindow.minutesUntil}{" "}
            {lectureWindow.minutesUntil === 1 ? "minute" : "minutes"}. You can mark statuses now, but Save unlocks
            once the lecture starts.
          </span>
        </Alert>
      )}

      {!isLoading && !holiday && lectureWindow?.kind === "locked" && (
        <Alert tone="warning" title="Attendance is locked for this lecture">
          <span className="inline-flex items-center gap-1.5">
            <CalendarOff className="size-4" aria-hidden="true" />
            This lecture&apos;s attendance window closed {LOCK_BEFORE_LECTURE_END_MINUTES} minutes before its{" "}
            {formatSlotTime(lectureWindow.endTime)} end time. Ask your school admin or front desk to correct
            today&apos;s attendance from the main Attendance page if needed.
          </span>
        </Alert>
      )}

      {!isLoading && !holiday && lectureWindow?.kind !== "no-slot-today" && rosterOrder.length > 0 && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 px-4 py-2 text-sm text-slate-600">
            <div className="flex flex-wrap gap-4">
              {ATTENDANCE_STATUS_OPTIONS.map((opt) => (
                <span key={opt.value}>
                  {opt.label}:{" "}
                  <span className="font-semibold text-slate-900">
                    {Object.values(roster).filter((v) => v === opt.value).length}
                  </span>
                </span>
              ))}
            </div>
            <Button variant="ghost" size="sm" onClick={markAllPresent}>
              Mark all present
            </Button>
          </div>

          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Student</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Mark</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rosterOrder.map((s) => (
                  <tr key={s.studentId} className="hover:bg-slate-50/60">
                    <td className="px-4 py-2">
                      <div className="font-medium text-slate-900">{s.fullName}</div>
                      <div className="text-xs text-slate-400">{s.studentCode}</div>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex gap-2" role="group" aria-label={`Attendance status for ${s.fullName}`}>
                        {ATTENDANCE_STATUS_OPTIONS.map((opt) => {
                          const isSelected = roster[s.studentId] === opt.value;
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              aria-pressed={isSelected}
                              onClick={() => setStatus(s.studentId, opt.value)}
                              className={cn(
                                "focus-ring flex size-10 items-center justify-center rounded-md border text-xs font-semibold transition-colors",
                                isSelected ? opt.tone : "border-slate-200 bg-white text-slate-400 hover:bg-slate-50",
                              )}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end">
            <Button
              onClick={handleSave}
              isLoading={isSaving}
              disabled={lectureWindow?.kind === "not-started" || lectureWindow?.kind === "locked"}
            >
              <Save className="size-4" aria-hidden="true" />
              {lectureWindow?.kind === "not-started"
                ? `Unlocks at ${formatSlotTime(lectureWindow.startTime)}`
                : lectureWindow?.kind === "locked"
                  ? "Locked"
                  : "Save attendance"}
            </Button>
          </div>
        </>
      )}

      {!isLoading && !holiday && rosterOrder.length === 0 && <EmptyState message="No active students in this section." />}
    </div>
  );
}

const classTestSchema = z
  .object({
    name: z.string().min(1, "Required").max(100),
    maxMarks: z.coerce.number().int().min(1, "Required").max(1000),
    passingMarks: z.coerce.number().int().min(0).max(1000),
  })
  .refine((v) => v.passingMarks <= v.maxMarks, {
    message: "Passing marks cannot exceed max marks",
    path: ["passingMarks"],
  });
type ClassTestFormValues = z.infer<typeof classTestSchema>;

/**
 * The self-serve "+ New class test" flow — a teacher creating their own
 * quick in-class test (quiz, class test, etc.) directly from this page,
 * with no admin involvement. Deliberately separate from the formal Exams
 * section above: these never appear on a report card or affect class
 * ranking (see the backend's classTests.ts doc comment) — only their own
 * marks-entry roster, reached via "Enter marks" below, and the student/
 * parent portal show them.
 */
function ClassTestsSection({ sectionSubjectId }: { sectionSubjectId: string }) {
  const { data: rows, isLoading, error, refetch } = useAsync(
    () => classTestsApi.forSectionSubject(sectionSubjectId),
    [sectionSubjectId],
  );
  const [open, setOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof classTestSchema>, unknown, ClassTestFormValues>({
    resolver: zodResolver(classTestSchema),
  });

  const onSubmit = async (values: ClassTestFormValues) => {
    setFormError(null);
    try {
      await classTestsApi.create({ sectionSubjectId, ...values });
      reset();
      setOpen(false);
      refetch();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not create this class test.");
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900">Class tests</h2>
        <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
          <Plus className="size-4" aria-hidden="true" />
          New class test
        </Button>
      </div>

      {open && (
        <form
          onSubmit={handleSubmit(onSubmit)}
          noValidate
          className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4"
        >
          {formError && <Alert tone="danger">{formError}</Alert>}
          <Input label="Name" placeholder="e.g. Chapter 3 quiz" required error={errors.name?.message} {...register("name")} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input label="Max marks" type="number" min={1} required error={errors.maxMarks?.message} {...register("maxMarks")} />
            <Input label="Passing marks" type="number" min={0} required error={errors.passingMarks?.message} {...register("passingMarks")} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" isLoading={isSubmitting}>
              Create
            </Button>
          </div>
        </form>
      )}

      {isLoading && <Spinner label="Loading class tests" />}
      {error && <Alert tone="danger">Failed to load class tests: {error.message}</Alert>}

      {rows && rows.length === 0 && (
        <EmptyState message="No class tests yet — create one above to enter marks for the whole class." />
      )}

      {rows?.map((row: ClassTest) => (
        <Card key={row.id}>
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-medium text-slate-900">{row.name}</h3>
              <p className="text-xs text-slate-500">
                Max marks: {row.maxMarks} · Passing: {row.passingMarks} · {row.marksEnteredCount} marked
              </p>
            </div>
            <Link href={`/dashboard/academics/courses/${sectionSubjectId}/class-tests/${row.id}`}>
              <Button size="sm" variant="outline">
                <PencilLine className="size-4" aria-hidden="true" />
                Enter marks
              </Button>
            </Link>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/**
 * "Make grades" shortcut — every exam this subject has been added to, with
 * a direct link into the existing marks-entry page (no need to go through
 * the exam list first) plus a Submit/Unsubmit toggle so the admin's
 * submission-status view knows this teacher is done. The self-serve Class
 * Tests section below is a fully separate feature (see ClassTestsSection's
 * doc comment) — kept on the same tab since a teacher naturally looks for
 * "enter marks" in one place, not split across two tabs.
 */
function GradesTab({ sectionSubjectId }: { sectionSubjectId: string }) {
  const { data: rows, isLoading, error, refetch } = useAsync(
    () => examsApi.examsForSectionSubject(sectionSubjectId),
    [sectionSubjectId],
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const toggleSubmit = async (row: ExamForSectionSubject) => {
    setActionError(null);
    setBusyId(row.id);
    try {
      if (row.marksSubmittedAt) {
        await examsApi.unsubmitMarks(row.id);
      } else {
        await examsApi.submitMarks(row.id);
      }
      refetch();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not update submission status.");
    } finally {
      setBusyId(null);
    }
  };

  const isOverdue = (deadline: string | null) => deadline !== null && deadline < todayIso();

  return (
    <div className="flex flex-col gap-6">
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-slate-900">Exams</h2>
      {isLoading && <Spinner label="Loading exams" />}
      {error && <Alert tone="danger">Failed to load exams: {error.message}</Alert>}
      {actionError && <Alert tone="danger">{actionError}</Alert>}

      {rows && rows.length === 0 && (
        <EmptyState message="No exams have been added for this subject yet. Ask your admin to add it under Exams." />
      )}

      {rows?.map((row) => (
        <Card key={row.id}>
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-medium text-slate-900">{row.exam.name}</h3>
                {row.marksSubmittedAt ? (
                  <Badge tone="success">
                    <span className="inline-flex items-center gap-1">
                      <CheckCircle2 className="size-3.5" aria-hidden="true" /> Submitted
                    </span>
                  </Badge>
                ) : (
                  <Badge tone="default">Not submitted</Badge>
                )}
              </div>
              <p className="text-xs text-slate-500">
                Max marks: {row.maxMarks} · Passing: {row.passingMarks}
                {row.exam.resultsDeadline && (
                  <>
                    {" · "}
                    <span className={isOverdue(row.exam.resultsDeadline) ? "font-medium text-red-600" : ""}>
                      Deadline {new Date(row.exam.resultsDeadline).toLocaleDateString()}
                      {isOverdue(row.exam.resultsDeadline) ? " (overdue)" : ""}
                    </span>
                  </>
                )}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link href={`/dashboard/exams/${row.exam.id}/marks/${row.id}`}>
                <Button size="sm" variant="outline">
                  <PencilLine className="size-4" aria-hidden="true" />
                  Make grades
                </Button>
              </Link>
              <Button
                size="sm"
                variant={row.marksSubmittedAt ? "ghost" : "primary"}
                isLoading={busyId === row.id}
                onClick={() => toggleSubmit(row)}
              >
                {row.marksSubmittedAt ? (
                  <>
                    <RotateCcw className="size-4" aria-hidden="true" />
                    Reopen
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="size-4" aria-hidden="true" />
                    Submit
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>

    <ClassTestsSection sectionSubjectId={sectionSubjectId} />
    </div>
  );
}

const TONE_BADGE: Record<NoticeTone, "default" | "info" | "danger" | "success" | "warning"> = {
  GENERAL: "default",
  IMPORTANT: "info",
  URGENT: "danger",
  EVENT: "success",
  HOLIDAY: "warning",
};

const noticeSchema = z.object({
  title: z.string().min(2, "Required").max(200),
  body: z.string().min(2, "Required").max(5000),
  tone: z.enum(["GENERAL", "IMPORTANT", "URGENT", "EVENT", "HOLIDAY"]),
  isPinned: z.boolean().optional(),
});
type NoticeFormValues = z.infer<typeof noticeSchema>;

const materialSchema = z.object({ title: z.string().min(2, "Required").max(200) });
type MaterialFormValues = z.infer<typeof materialSchema>;

const homeworkSchema = z.object({
  title: z.string().min(2, "Required").max(200),
  description: z.string().max(2000).optional(),
  dueDate: z.string().min(1, "Required"),
});
type HomeworkFormValues = z.infer<typeof homeworkSchema>;

function AnnouncementsTab({ sectionId }: { sectionId: string }) {
  const [open, setOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const { data, isLoading, refetch } = useAsync(() => noticesApi.list({ sectionId, limit: 20 }), [sectionId]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<NoticeFormValues>({ resolver: zodResolver(noticeSchema), defaultValues: { tone: "GENERAL" } });

  const onSubmit = async (values: NoticeFormValues) => {
    setFormError(null);
    try {
      await noticesApi.create({ ...values, audiences: ["SECTION"], sectionId });
      reset({ tone: "GENERAL" });
      setOpen(false);
      refetch();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not publish announcement.");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setOpen((v) => !v)}>
          <Plus className="size-4" aria-hidden="true" />
          Post announcement
        </Button>
      </div>

      {open && (
        <form
          onSubmit={handleSubmit(onSubmit)}
          noValidate
          className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4"
        >
          {formError && <Alert tone="danger">{formError}</Alert>}
          <Input label="Title" required error={errors.title?.message} {...register("title")} />
          <Textarea label="Message" required error={errors.body?.message} {...register("body")} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Select label="Tone" required {...register("tone")}>
              <option value="GENERAL">General</option>
              <option value="IMPORTANT">Important</option>
              <option value="URGENT">Urgent</option>
              <option value="EVENT">Event</option>
              <option value="HOLIDAY">Holiday</option>
            </Select>
            <label className="mt-6 flex items-center gap-2 py-2 text-sm text-slate-700">
              <input type="checkbox" className="size-4 rounded border-slate-300" {...register("isPinned")} />
              Pin to top
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" isLoading={isSubmitting}>
              Publish
            </Button>
          </div>
        </form>
      )}

      {isLoading && <Spinner label="Loading announcements" />}
      {data && data.data.length === 0 && <EmptyState message="No announcements posted for this course yet." />}
      {data?.data.map((notice) => (
        <Card key={notice.id}>
          <CardContent className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                {notice.isPinned && <Pin className="size-3.5 text-primary-600" aria-hidden="true" />}
                <h3 className="font-medium text-slate-900">{notice.title}</h3>
              </div>
              <Badge tone={TONE_BADGE[notice.tone]}>{notice.tone}</Badge>
            </div>
            <p className="text-sm text-slate-700">{notice.body}</p>
            <p className="text-xs text-slate-500">{new Date(notice.publishedAt).toLocaleDateString()}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function MaterialsTab({ sectionSubjectId }: { sectionSubjectId: string }) {
  const [open, setOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<{ url: string; originalName: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const { data, isLoading, refetch } = useAsync(() => courseMaterialsApi.list(sectionSubjectId), [sectionSubjectId]);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<MaterialFormValues>({ resolver: zodResolver(materialSchema) });

  const onSubmit = async (values: MaterialFormValues) => {
    setFormError(null);
    if (!pendingFile) {
      setFormError("Choose a file to upload.");
      return;
    }
    try {
      await courseMaterialsApi.create({ sectionSubjectId, title: values.title, fileUrl: pendingFile.url });
      reset();
      setPendingFile(null);
      setOpen(false);
      refetch();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not share this file.");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setOpen((v) => !v)}>
          <Plus className="size-4" aria-hidden="true" />
          Share material
        </Button>
      </div>

      {open && (
        <form
          onSubmit={handleSubmit(onSubmit)}
          noValidate
          className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4"
        >
          {formError && <Alert tone="danger">{formError}</Alert>}
          <DocumentUploadButton
            label={pendingFile ? `Change file (${pendingFile.originalName})` : "Choose file"}
            onUploaded={(result) => {
              setPendingFile(result);
              setValue("title", result.originalName.replace(/\.[^.]+$/, ""));
            }}
          />
          <Input label="Title" required error={errors.title?.message} {...register("title")} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" isLoading={isSubmitting}>
              Share
            </Button>
          </div>
        </form>
      )}

      {isLoading && <Spinner label="Loading course material" />}
      {data && data.length === 0 && <EmptyState message="No course material shared yet." />}
      {data && data.length > 0 && (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Title</TableHeaderCell>
              <TableHeaderCell>Date</TableHeaderCell>
              <TableHeaderCell></TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {data.map((m) => (
              <TableRow key={m.id}>
                <TableCell>{m.title}</TableCell>
                <TableCell>{new Date(m.createdAt).toLocaleDateString()}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <a
                      href={m.fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-primary-600 hover:underline"
                    >
                      <Download className="size-4" aria-hidden="true" />
                      Download
                    </a>
                    <ConfirmButton
                      triggerLabel="Delete"
                      confirmLabel="Confirm delete"
                      title="Remove this file?"
                      description={`"${m.title}" will no longer be visible to students.`}
                      onConfirm={() => courseMaterialsApi.remove(m.id).then(refetch)}
                    />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function AssessmentTab({ sectionId, subjectId }: { sectionId: string; subjectId: string }) {
  const [open, setOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<{ url: string; originalName: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const { data, isLoading, refetch } = useAsync(() => homeworkApi.list({ sectionId, limit: 100 }), [sectionId]);
  const items = (data?.data ?? []).filter((h) => h.subject.id === subjectId);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<HomeworkFormValues>({ resolver: zodResolver(homeworkSchema) });

  const onSubmit = async (values: HomeworkFormValues) => {
    setFormError(null);
    try {
      await homeworkApi.create({
        sectionId,
        subjectId,
        title: values.title,
        description: values.description || undefined,
        dueDate: values.dueDate,
        attachmentUrl: pendingFile?.url,
      });
      reset();
      setPendingFile(null);
      setOpen(false);
      refetch();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not assign this homework.");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setOpen((v) => !v)}>
          <Plus className="size-4" aria-hidden="true" />
          Assign homework
        </Button>
      </div>

      {open && (
        <form
          onSubmit={handleSubmit(onSubmit)}
          noValidate
          className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4"
        >
          {formError && <Alert tone="danger">{formError}</Alert>}
          <Input label="Title" required error={errors.title?.message} {...register("title")} />
          <Textarea label="Description" error={errors.description?.message} {...register("description")} />
          <Input label="Due date" type="date" required error={errors.dueDate?.message} {...register("dueDate")} />
          <DocumentUploadButton
            label={pendingFile ? `Change attachment (${pendingFile.originalName})` : "Attach a file (optional)"}
            onUploaded={setPendingFile}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" isLoading={isSubmitting}>
              Assign
            </Button>
          </div>
        </form>
      )}

      {isLoading && <Spinner label="Loading assessments" />}
      {!isLoading && items.length === 0 && <EmptyState message="No assignments given yet." />}
      {items.map((hw) => (
        <Card key={hw.id}>
          <CardContent className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-medium text-slate-900">{hw.title}</h3>
              <div className="flex items-center gap-2">
                <Badge tone="warning">Due {new Date(hw.dueDate).toLocaleDateString()}</Badge>
                <ConfirmButton
                  triggerLabel="Delete"
                  confirmLabel="Confirm delete"
                  title="Remove this assignment?"
                  description={`"${hw.title}" will no longer be visible to students.`}
                  onConfirm={() => homeworkApi.remove(hw.id).then(refetch)}
                />
              </div>
            </div>
            {hw.description && <p className="text-sm text-slate-700">{hw.description}</p>}
            {hw.attachmentUrl && (
              <a
                href={hw.attachmentUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex w-fit items-center gap-1 text-sm text-primary-600 hover:underline"
              >
                <Download className="size-4" aria-hidden="true" />
                Attachment
              </a>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function ManageCoursePage({ params }: { params: Promise<{ sectionSubjectId: string }> }) {
  const { sectionSubjectId } = use(params);
  const [tab, setTab] = useState<TabKey>("announcements");

  const { data: courses, isLoading, error } = useAsync(() => academicsApi.mySectionSubjects(), []);
  const course = courses?.find((c) => c.id === sectionSubjectId) ?? null;

  if (isLoading) return <Spinner label="Loading course" />;
  if (error) return <Alert tone="danger">Failed to load course: {error.message}</Alert>;
  if (!course) return <Alert tone="danger">Course not found, or you are not the assigned teacher for it.</Alert>;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link
          href="/dashboard"
          className="mb-2 inline-flex items-center gap-1 text-sm text-primary-600 hover:underline"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to my courses
        </Link>
        <h1 className="text-page-title font-semibold text-slate-900">{course.subject.name}</h1>
        <p className="text-sm text-slate-500">
          {course.section.schoolClass.name} - {course.section.name}
        </p>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === key
                ? "border-primary-600 text-primary-600"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            <Icon className="size-4" aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      {tab === "announcements" && <AnnouncementsTab sectionId={course.section.id} />}
      {tab === "materials" && <MaterialsTab sectionSubjectId={course.id} />}
      {tab === "assessment" && <AssessmentTab sectionId={course.section.id} subjectId={course.subject.id} />}
      {tab === "attendance" && (
        <AttendanceTab sectionId={course.section.id} sectionSubjectId={course.id} timetableSlots={course.timetableSlots} />
      )}
      {tab === "grades" && <GradesTab sectionSubjectId={course.id} />}
    </div>
  );
}
