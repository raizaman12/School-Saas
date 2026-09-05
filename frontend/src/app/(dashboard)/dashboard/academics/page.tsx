"use client";

import { Fragment, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, ArrowRightCircle, CalendarClock, Pencil } from "lucide-react";
import { useAsync } from "@/lib/hooks/useAsync";
import { useAuth } from "@/lib/auth/AuthProvider";
import {
  academicsApi,
  formatSlotTime,
  type Section,
  type AcademicYear,
  type SectionSubject,
  type TimetableSlot,
  type DayOfWeek,
} from "@/lib/resources/academics";
import { studentsApi, type StudentListItem } from "@/lib/resources/students";
import { staffApi } from "@/lib/resources/staff";
import { ApiError } from "@/lib/api";
import {
  Button,
  Input,
  Select,
  Badge,
  Alert,
  Spinner,
  Card,
  CardHeader,
  CardTitle,
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

const DAYS_OF_WEEK: DayOfWeek[] = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
];
const DAY_LABELS: Record<DayOfWeek, string> = {
  MONDAY: "Monday",
  TUESDAY: "Tuesday",
  WEDNESDAY: "Wednesday",
  THURSDAY: "Thursday",
  FRIDAY: "Friday",
  SATURDAY: "Saturday",
  SUNDAY: "Sunday",
};

const yearSchema = z
  .object({
    name: z.string().min(4, "e.g. 2025-2026").max(20),
    startDate: z.string().min(1, "Required"),
    endDate: z.string().min(1, "Required"),
    isActive: z.boolean().optional(),
  })
  .refine((v) => v.endDate > v.startDate, { message: "Must be after start date", path: ["endDate"] });
type YearFormValues = z.infer<typeof yearSchema>;

function YearsSection() {
  const { data: years, isLoading, refetch } = useAsync(() => academicsApi.listYears(), []);
  const [open, setOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<YearFormValues>({ resolver: zodResolver(yearSchema) });

  const onSubmit = async (values: YearFormValues) => {
    setFormError(null);
    try {
      await academicsApi.createYear(values);
      reset();
      setOpen(false);
      refetch();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not save academic year.");
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Academic years</CardTitle>
        <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
          <Plus className="size-4" aria-hidden="true" />
          Add year
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {open && (
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="rounded-lg border border-slate-200 p-4">
            {formError && (
              <Alert tone="danger" className="mb-3">
                {formError}
              </Alert>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Input label="Name" placeholder="2026-2027" required error={errors.name?.message} {...register("name")} />
              <Input label="Start date" type="date" required error={errors.startDate?.message} {...register("startDate")} />
              <Input label="End date" type="date" required error={errors.endDate?.message} {...register("endDate")} />
            </div>
            <label className="mt-3 flex items-center gap-2 py-2 text-sm text-slate-700">
              <input type="checkbox" className="size-4 rounded border-slate-300" {...register("isActive")} />
              Set as the active year
            </label>
            <div className="mt-3 flex justify-end">
              <Button type="submit" size="sm" isLoading={isSubmitting}>
                Save
              </Button>
            </div>
          </form>
        )}

        {isLoading ? (
          <Spinner label="Loading academic years" />
        ) : !years || years.length === 0 ? (
          <EmptyState message="No academic years yet." />
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>Start</TableHeaderCell>
                <TableHeaderCell>End</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {years.map((y) => (
                <TableRow key={y.id}>
                  <TableCell>{y.name}</TableCell>
                  <TableCell>{new Date(y.startDate).toLocaleDateString()}</TableCell>
                  <TableCell>{new Date(y.endDate).toLocaleDateString()}</TableCell>
                  <TableCell>{y.isActive && <Badge tone="success">Active</Badge>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

const classSchema = z.object({
  name: z.string().min(1, "Required").max(50),
  order: z.coerce.number().int().min(0).max(100),
});
type ClassFormValues = z.infer<typeof classSchema>;

function ClassesSection() {
  const { data: classes, isLoading, refetch } = useAsync(() => academicsApi.listClasses(), []);
  const [open, setOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof classSchema>, unknown, ClassFormValues>({ resolver: zodResolver(classSchema) });

  const onSubmit = async (values: ClassFormValues) => {
    setFormError(null);
    try {
      await academicsApi.createClass(values);
      reset();
      setOpen(false);
      refetch();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not save class.");
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Classes</CardTitle>
        <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
          <Plus className="size-4" aria-hidden="true" />
          Add class
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {open && (
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="rounded-lg border border-slate-200 p-4">
            {formError && (
              <Alert tone="danger" className="mb-3">
                {formError}
              </Alert>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input label="Name" placeholder="Class 5" required error={errors.name?.message} {...register("name")} />
              <Input
                label="Sort order"
                type="number"
                hint="Used to order Nursery < KG < Class 1 < …"
                required
                error={errors.order?.message}
                {...register("order")}
              />
            </div>
            <div className="mt-3 flex justify-end">
              <Button type="submit" size="sm" isLoading={isSubmitting}>
                Save
              </Button>
            </div>
          </form>
        )}

        {isLoading ? (
          <Spinner label="Loading classes" />
        ) : !classes || classes.length === 0 ? (
          <EmptyState message="No classes yet." />
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>Order</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {classes.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>{c.name}</TableCell>
                  <TableCell>{c.order}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

const subjectSchema = z.object({
  name: z.string().min(1, "Required").max(100),
  code: z.string().max(20).optional(),
});
type SubjectFormValues = z.infer<typeof subjectSchema>;

function SubjectsSection() {
  const { data: subjects, isLoading, refetch } = useAsync(() => academicsApi.listSubjects(), []);
  const [open, setOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<SubjectFormValues>({ resolver: zodResolver(subjectSchema) });

  const onSubmit = async (values: SubjectFormValues) => {
    setFormError(null);
    try {
      await academicsApi.createSubject(values);
      reset();
      setOpen(false);
      refetch();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not save subject.");
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Subjects</CardTitle>
        <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
          <Plus className="size-4" aria-hidden="true" />
          Add subject
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {open && (
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="rounded-lg border border-slate-200 p-4">
            {formError && (
              <Alert tone="danger" className="mb-3">
                {formError}
              </Alert>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input label="Name" placeholder="Mathematics" required error={errors.name?.message} {...register("name")} />
              <Input label="Code" placeholder="MATH" hint="Optional, e.g. for report cards" {...register("code")} />
            </div>
            <div className="mt-3 flex justify-end">
              <Button type="submit" size="sm" isLoading={isSubmitting}>
                Save
              </Button>
            </div>
          </form>
        )}

        {isLoading ? (
          <Spinner label="Loading subjects" />
        ) : !subjects || subjects.length === 0 ? (
          <EmptyState message="No subjects yet." />
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>Code</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {subjects.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>{s.name}</TableCell>
                  <TableCell>{s.code ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

const sectionSchema = z.object({
  schoolClassId: z.string().uuid("Select a class"),
  academicYearId: z.string().uuid("Select a year"),
  name: z.string().min(1, "Required").max(20),
  roomNumber: z.string().max(30).optional(),
  capacity: z.coerce.number().int().min(1).max(200).optional(),
});
type SectionFormValues = z.infer<typeof sectionSchema>;

/**
 * Year-end "move to next class" panel for a single section. Lets the admin
 * pick a target year + target section and choose which currently-ACTIVE
 * students move — anyone left unchecked is held back as a repeater in their
 * current section, they are NOT marked as leaving. A student leaving the
 * school entirely should get a transfer certificate from their own profile
 * page instead (see the "Undo this transfer" flow there).
 */
function PromoteSectionPanel({
  section,
  sections,
  years,
  onDone,
}: {
  section: Section;
  sections: Section[];
  years: AcademicYear[];
  onDone: () => void;
}) {
  const { data: activeStudentsPage, isLoading: studentsLoading } = useAsync(
    () => studentsApi.list({ sectionId: section.id, status: "ACTIVE", limit: 500 }),
    [section.id],
  );
  const activeStudents: StudentListItem[] = activeStudentsPage?.data ?? [];

  const [targetYearId, setTargetYearId] = useState("");
  const [targetSectionId, setTargetSectionId] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string> | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ promotedCount: number } | null>(null);

  // Default to "everyone selected" once the roster has loaded.
  const checkedIds = selectedIds ?? new Set(activeStudents.map((s) => s.id));

  const targetSectionOptions = useMemo(
    () => sections.filter((s) => s.academicYear.id === targetYearId && s.id !== section.id),
    [sections, targetYearId, section.id],
  );

  const toggleStudent = (id: string) => {
    const next = new Set(checkedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const onSubmit = async () => {
    setError(null);
    if (!targetYearId || !targetSectionId) {
      setError("Select a target academic year and section.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await academicsApi.promoteSection(section.id, {
        targetSectionId,
        targetAcademicYearId: targetYearId,
        studentIds: Array.from(checkedIds),
      });
      setResult({ promotedCount: res.promotedCount });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not promote students.");
    } finally {
      setSubmitting(false);
    }
  };

  if (result) {
    return (
      <div className="rounded-lg border border-slate-200 p-4">
        <Alert tone="success">
          Promoted {result.promotedCount} student{result.promotedCount === 1 ? "" : "s"} to the new section.
        </Alert>
        <div className="mt-3 flex justify-end">
          <Button size="sm" variant="outline" onClick={onDone}>
            Close
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 p-4">
      {error && (
        <Alert tone="danger" className="mb-3">
          {error}
        </Alert>
      )}
      <p className="mb-3 text-sm text-slate-600">
        Moves the checked students from <strong>{section.schoolClass.name} {section.name}</strong> into a
        section in the target year. Students left unchecked stay in their current section as repeaters — they
        are not marked as leaving. If a student is leaving the school entirely, issue a transfer certificate
        from their own profile page instead.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Select
          label="Target academic year"
          required
          value={targetYearId}
          onChange={(e) => {
            setTargetYearId(e.target.value);
            setTargetSectionId("");
          }}
        >
          <option value="">Select year</option>
          {years.map((y) => (
            <option key={y.id} value={y.id}>
              {y.name}
            </option>
          ))}
        </Select>
        <Select
          label="Target section"
          required
          value={targetSectionId}
          onChange={(e) => setTargetSectionId(e.target.value)}
          disabled={!targetYearId}
        >
          <option value="">{targetYearId ? "Select section" : "Select a year first"}</option>
          {targetSectionOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.schoolClass.name} {s.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="mt-4">
        <p className="mb-2 text-sm font-medium text-slate-700">Students to promote</p>
        {studentsLoading ? (
          <Spinner label="Loading students" />
        ) : activeStudents.length === 0 ? (
          <EmptyState message="No active students in this section." />
        ) : (
          <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200">
            <ul className="divide-y divide-slate-100">
              {activeStudents.map((s) => (
                <li key={s.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 rounded border-slate-300"
                    checked={checkedIds.has(s.id)}
                    onChange={() => toggleStudent(s.id)}
                    id={`promote-student-${s.id}`}
                  />
                  <label htmlFor={`promote-student-${s.id}`} className="flex-1 cursor-pointer">
                    {s.fullName} <span className="text-slate-400">({s.studentCode})</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="mt-1 text-xs text-slate-500">{checkedIds.size} of {activeStudents.length} selected</p>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          isLoading={submitting}
          disabled={activeStudents.length === 0}
          onClick={onSubmit}
        >
          Promote {checkedIds.size} student{checkedIds.size === 1 ? "" : "s"}
        </Button>
      </div>
    </div>
  );
}

const assignSubjectSchema = z.object({
  subjectId: z.string().uuid("Select a subject"),
  teacherId: z.string().uuid().optional().or(z.literal("")),
  isElective: z.boolean().optional(),
});
type AssignSubjectFormValues = z.infer<typeof assignSubjectSchema>;

const slotSchema = z
  .object({
    sectionSubjectId: z.string().uuid("Select a subject"),
    dayOfWeek: z.enum(DAYS_OF_WEEK as [DayOfWeek, ...DayOfWeek[]], { message: "Select a day" }),
    startTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Required"),
    endTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Required"),
    roomNumber: z.string().max(30).optional(),
  })
  .refine((v) => v.endTime > v.startTime, { message: "Must be after start time", path: ["endTime"] });
type SlotFormValues = z.infer<typeof slotSchema>;

/**
 * Which section students are actually enrolled in one elective subject —
 * a plain checkbox roster, not a scheduler. See StudentElectiveEnrollment's
 * doc comment in schema.prisma for why this is the whole feature: no
 * conflict-solving, just "who's taking this one".
 */
function ElectiveRosterPanel({ sectionSubject, onDone }: { sectionSubject: SectionSubject; onDone: () => void }) {
  const {
    data: rows,
    isLoading,
    refetch,
  } = useAsync(() => academicsApi.listElectiveStudents(sectionSubject.id), [sectionSubject.id]);
  const [checked, setChecked] = useState<Set<string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  if (checked === null && rows) {
    setChecked(new Set(rows.filter((r) => r.enrolled).map((r) => r.id)));
  }

  const onSave = async () => {
    if (!checked) return;
    setError(null);
    setIsSaving(true);
    try {
      await academicsApi.setElectiveStudents(sectionSubject.id, [...checked]);
      refetch();
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save this elective's roster.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="text-sm font-medium text-slate-800">
        Who takes {sectionSubject.subject.name}? Only checked students get marks entry / report-card rows for it.
      </p>
      {error && <Alert tone="danger">{error}</Alert>}
      {isLoading || !rows ? (
        <Spinner label="Loading section roster" />
      ) : rows.length === 0 ? (
        <EmptyState message="No active students in this section yet." />
      ) : (
        <div className="flex flex-col gap-1.5">
          {rows.map((r) => (
            <label key={r.id} className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="rounded border-slate-300"
                checked={checked?.has(r.id) ?? false}
                onChange={(e) => {
                  const next = new Set(checked);
                  if (e.target.checked) next.add(r.id);
                  else next.delete(r.id);
                  setChecked(next);
                }}
              />
              {r.fullName} <span className="text-xs text-slate-400">({r.studentCode})</span>
            </label>
          ))}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button type="button" size="sm" isLoading={isSaving} onClick={onSave}>
          Save roster
        </Button>
      </div>
    </div>
  );
}

/**
 * Per-section admin panel: assign subjects+teachers to the section, then
 * build its weekly timetable out of those assignments. Opened inline below
 * the section's row in SectionsSection's table (same convention as
 * PromoteSectionPanel).
 */
function SectionTimetablePanel({ section, onDone }: { section: Section; onDone: () => void }) {
  const {
    data: sectionSubjects,
    isLoading: ssLoading,
    refetch: refetchSectionSubjects,
  } = useAsync(() => academicsApi.listSectionSubjects(section.id), [section.id]);
  const { data: subjects } = useAsync(() => academicsApi.listSubjects(), []);
  const { data: teachersPage } = useAsync(() => staffApi.list({ limit: 100, status: "ACTIVE" }), []);
  const teachers = (teachersPage?.data ?? []).filter((t) => t.user.role === "TEACHER");

  const {
    data: slots,
    isLoading: slotsLoading,
    refetch: refetchSlots,
  } = useAsync(() => academicsApi.listTimetable(section.id), [section.id]);

  const [assignError, setAssignError] = useState<string | null>(null);
  const {
    register: registerAssign,
    handleSubmit: handleAssignSubmit,
    reset: resetAssign,
    formState: { errors: assignErrors, isSubmitting: assignSubmitting },
  } = useForm<AssignSubjectFormValues>({ resolver: zodResolver(assignSubjectSchema) });

  const onAssign = async (values: AssignSubjectFormValues) => {
    setAssignError(null);
    try {
      await academicsApi.assignSectionSubject(section.id, {
        subjectId: values.subjectId,
        teacherId: values.teacherId || undefined,
        isElective: values.isElective,
      });
      resetAssign();
      refetchSectionSubjects();
    } catch (err) {
      setAssignError(err instanceof ApiError ? err.message : "Could not assign subject.");
    }
  };

  const onRemoveAssignment = async (sectionSubjectId: string) => {
    await academicsApi.removeSectionSubject(sectionSubjectId);
    refetchSectionSubjects();
    refetchSlots();
  };

  const [managingElectiveId, setManagingElectiveId] = useState<string | null>(null);

  const [slotFormOpen, setSlotFormOpen] = useState(false);
  const [slotError, setSlotError] = useState<string | null>(null);
  const [editingSlotId, setEditingSlotId] = useState<string | null>(null);
  const {
    register: registerSlot,
    handleSubmit: handleSlotSubmit,
    reset: resetSlot,
    formState: { errors: slotErrors, isSubmitting: slotSubmitting },
  } = useForm<SlotFormValues>({ resolver: zodResolver(slotSchema) });

  const onCreateSlot = async (values: SlotFormValues) => {
    setSlotError(null);
    try {
      if (editingSlotId) {
        await academicsApi.updateTimetableSlot(editingSlotId, values);
      } else {
        await academicsApi.createTimetableSlot(values);
      }
      resetSlot();
      setSlotFormOpen(false);
      setEditingSlotId(null);
      refetchSlots();
    } catch (err) {
      setSlotError(err instanceof ApiError ? err.message : "Could not save this timetable slot.");
    }
  };

  const startEditSlot = (slot: TimetableSlot) => {
    setEditingSlotId(slot.id);
    setSlotFormOpen(true);
    setSlotError(null);
    resetSlot({
      sectionSubjectId: slot.sectionSubject.id,
      dayOfWeek: slot.dayOfWeek,
      startTime: formatSlotTime(slot.startTime),
      endTime: formatSlotTime(slot.endTime),
      roomNumber: slot.roomNumber ?? undefined,
    });
  };

  const onDeleteSlot = async (slotId: string) => {
    await academicsApi.removeTimetableSlot(slotId);
    refetchSlots();
  };

  const sortedSlots = [...(slots ?? [])].sort((a, b) => {
    const dayDiff = DAYS_OF_WEEK.indexOf(a.dayOfWeek) - DAYS_OF_WEEK.indexOf(b.dayOfWeek);
    return dayDiff !== 0 ? dayDiff : a.startTime.localeCompare(b.startTime);
  });

  return (
    <div className="flex flex-col gap-6 rounded-lg border border-slate-200 p-4">
      <div>
        <p className="mb-3 text-sm font-semibold text-slate-800">
          Subjects & teachers — {section.schoolClass.name} {section.name}
        </p>
        {assignError && (
          <Alert tone="danger" className="mb-3">
            {assignError}
          </Alert>
        )}
        {ssLoading ? (
          <Spinner label="Loading subjects" />
        ) : !sectionSubjects || sectionSubjects.length === 0 ? (
          <EmptyState message="No subjects assigned to this section yet." />
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Subject</TableHeaderCell>
                <TableHeaderCell>Teacher</TableHeaderCell>
                <TableHeaderCell>Type</TableHeaderCell>
                <TableHeaderCell>Actions</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sectionSubjects.map((ss: SectionSubject) => (
                <Fragment key={ss.id}>
                  <TableRow>
                    <TableCell>{ss.subject.name}</TableCell>
                    <TableCell>{ss.teacher?.fullName ?? "—"}</TableCell>
                    <TableCell>
                      {ss.isElective ? <Badge tone="info">Elective</Badge> : <Badge>Core</Badge>}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        {ss.isElective && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setManagingElectiveId(managingElectiveId === ss.id ? null : ss.id)}
                          >
                            Manage students
                          </Button>
                        )}
                        <ConfirmButton
                          triggerLabel="Remove"
                          confirmLabel="Remove"
                          title="Remove this subject from the section?"
                          description="Any timetable slots for this subject in this section will stop showing on the teacher's timetable."
                          onConfirm={() => onRemoveAssignment(ss.id)}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                  {managingElectiveId === ss.id && (
                    <TableRow>
                      <TableCell colSpan={4}>
                        <ElectiveRosterPanel sectionSubject={ss} onDone={() => setManagingElectiveId(null)} />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        )}

        <form
          onSubmit={handleAssignSubmit(onAssign)}
          noValidate
          className="mt-3 flex flex-col gap-3"
          data-testid="assign-subject-form"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <Select label="Subject" required error={assignErrors.subjectId?.message} {...registerAssign("subjectId")}>
              <option value="">Select subject</option>
              {(subjects ?? []).map((sub) => (
                <option key={sub.id} value={sub.id}>
                  {sub.name}
                </option>
              ))}
            </Select>
            <Select label="Teacher (optional)" {...registerAssign("teacherId")}>
              <option value="">Unassigned</option>
              {teachers.map((t) => (
                <option key={t.user.id} value={t.user.id}>
                  {t.user.fullName}
                </option>
              ))}
            </Select>
            <Button type="submit" size="sm" isLoading={assignSubmitting}>
              Assign
            </Button>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" className="rounded border-slate-300" {...registerAssign("isElective")} />
            Elective — only some students in the section take this (O/A-Level subject combinations). Assign the
            student roster afterwards from the table above.
          </label>
        </form>
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-800">Weekly timetable</p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setEditingSlotId(null);
              setSlotError(null);
              resetSlot({ sectionSubjectId: "", dayOfWeek: undefined, startTime: "", endTime: "", roomNumber: "" });
              setSlotFormOpen((v) => !v);
            }}
          >
            <Plus className="size-4" aria-hidden="true" />
            Add period
          </Button>
        </div>

        {slotFormOpen && (
          <form
            onSubmit={handleSlotSubmit(onCreateSlot)}
            noValidate
            className="mb-3 rounded-lg border border-slate-200 p-4"
          >
            {slotError && (
              <Alert tone="danger" className="mb-3">
                {slotError}
              </Alert>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Select
                label="Subject"
                required
                error={slotErrors.sectionSubjectId?.message}
                {...registerSlot("sectionSubjectId")}
              >
                <option value="">Select subject</option>
                {(sectionSubjects ?? []).map((ss: SectionSubject) => (
                  <option key={ss.id} value={ss.id}>
                    {ss.subject.name}
                    {ss.teacher ? ` — ${ss.teacher.fullName}` : ""}
                  </option>
                ))}
              </Select>
              <Select label="Day" required error={slotErrors.dayOfWeek?.message} {...registerSlot("dayOfWeek")}>
                <option value="">Select day</option>
                {DAYS_OF_WEEK.map((d) => (
                  <option key={d} value={d}>
                    {DAY_LABELS[d]}
                  </option>
                ))}
              </Select>
              <Input
                label="Start time"
                type="time"
                required
                error={slotErrors.startTime?.message}
                {...registerSlot("startTime")}
              />
              <Input
                label="End time"
                type="time"
                required
                error={slotErrors.endTime?.message}
                {...registerSlot("endTime")}
              />
              <Input label="Room number" {...registerSlot("roomNumber")} />
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setSlotFormOpen(false);
                  setEditingSlotId(null);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" isLoading={slotSubmitting}>
                {editingSlotId ? "Save changes" : "Add period"}
              </Button>
            </div>
          </form>
        )}

        {slotsLoading ? (
          <Spinner label="Loading timetable" />
        ) : sortedSlots.length === 0 ? (
          <EmptyState message="No timetable slots yet." />
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Day</TableHeaderCell>
                <TableHeaderCell>Time</TableHeaderCell>
                <TableHeaderCell>Subject</TableHeaderCell>
                <TableHeaderCell>Teacher</TableHeaderCell>
                <TableHeaderCell>Room</TableHeaderCell>
                <TableHeaderCell>Actions</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sortedSlots.map((slot) => (
                <TableRow key={slot.id}>
                  <TableCell>{DAY_LABELS[slot.dayOfWeek]}</TableCell>
                  <TableCell>
                    {formatSlotTime(slot.startTime)}–{formatSlotTime(slot.endTime)}
                  </TableCell>
                  <TableCell>{slot.sectionSubject.subject.name}</TableCell>
                  <TableCell>{slot.sectionSubject.teacher?.fullName ?? "—"}</TableCell>
                  <TableCell>{slot.roomNumber ?? "—"}</TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => startEditSlot(slot)}>
                        <Pencil className="size-4" aria-hidden="true" />
                      </Button>
                      <ConfirmButton
                        triggerLabel="Delete"
                        confirmLabel="Delete"
                        title="Delete this period?"
                        description="This removes it from the section's and teacher's timetable."
                        onConfirm={() => onDeleteSlot(slot.id)}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={onDone}>
          Close
        </Button>
      </div>
    </div>
  );
}

function SectionsSection() {
  const { data: sections, isLoading, refetch } = useAsync(() => academicsApi.listSections(), []);
  const { data: years } = useAsync(() => academicsApi.listYears(), []);
  const { data: classes } = useAsync(() => academicsApi.listClasses(), []);
  const [open, setOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [openPanel, setOpenPanel] = useState<{ sectionId: string; kind: "promote" | "timetable" } | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof sectionSchema>, unknown, SectionFormValues>({ resolver: zodResolver(sectionSchema) });

  const togglePanel = (sectionId: string, kind: "promote" | "timetable") =>
    setOpenPanel((cur) => (cur?.sectionId === sectionId && cur.kind === kind ? null : { sectionId, kind }));

  const onSubmit = async (values: SectionFormValues) => {
    setFormError(null);
    try {
      await academicsApi.createSection(values);
      reset();
      setOpen(false);
      refetch();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not save section.");
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Sections</CardTitle>
        <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
          <Plus className="size-4" aria-hidden="true" />
          Add section
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {open && (
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="rounded-lg border border-slate-200 p-4">
            {formError && (
              <Alert tone="danger" className="mb-3">
                {formError}
              </Alert>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Select label="Academic year" required error={errors.academicYearId?.message} {...register("academicYearId")}>
                <option value="">Select year</option>
                {(years ?? []).map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.name}
                  </option>
                ))}
              </Select>
              <Select label="Class" required error={errors.schoolClassId?.message} {...register("schoolClassId")}>
                <option value="">Select class</option>
                {(classes ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
              <Input label="Section name" placeholder="A" required error={errors.name?.message} {...register("name")} />
              <Input label="Room number" {...register("roomNumber")} />
              <Input label="Capacity" type="number" {...register("capacity")} />
            </div>
            <div className="mt-3 flex justify-end">
              <Button type="submit" size="sm" isLoading={isSubmitting}>
                Save
              </Button>
            </div>
          </form>
        )}

        {isLoading ? (
          <Spinner label="Loading sections" />
        ) : !sections || sections.length === 0 ? (
          <EmptyState message="No sections yet." />
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Class</TableHeaderCell>
                <TableHeaderCell>Section</TableHeaderCell>
                <TableHeaderCell>Year</TableHeaderCell>
                <TableHeaderCell>Class teacher</TableHeaderCell>
                <TableHeaderCell>Students</TableHeaderCell>
                <TableHeaderCell>Actions</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sections.map((s) => (
                <Fragment key={s.id}>
                  <TableRow>
                    <TableCell>{s.schoolClass.name}</TableCell>
                    <TableCell>{s.name}</TableCell>
                    <TableCell>{s.academicYear.name}</TableCell>
                    <TableCell>{s.classTeacher?.fullName ?? "—"}</TableCell>
                    <TableCell>{s._count.students}</TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => togglePanel(s.id, "timetable")}>
                          <CalendarClock className="size-4" aria-hidden="true" />
                          Timetable
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => togglePanel(s.id, "promote")}>
                          <ArrowRightCircle className="size-4" aria-hidden="true" />
                          Promote
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                  {openPanel?.sectionId === s.id && openPanel.kind === "promote" && (
                    <TableRow>
                      <TableCell colSpan={6} className="bg-slate-50/60">
                        <PromoteSectionPanel
                          section={s}
                          sections={sections}
                          years={years ?? []}
                          onDone={() => {
                            setOpenPanel(null);
                            refetch();
                          }}
                        />
                      </TableCell>
                    </TableRow>
                  )}
                  {openPanel?.sectionId === s.id && openPanel.kind === "timetable" && (
                    <TableRow>
                      <TableCell colSpan={6} className="bg-slate-50/60">
                        <SectionTimetablePanel section={s} onDone={() => setOpenPanel(null)} />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * A TEACHER's own weekly timetable across every section they teach —
 * whether as class teacher or as a subject teacher (see lib/teacherScope.ts
 * on the backend). Read-only: teachers can't edit their own timetable, only
 * SCHOOL_ADMIN can (see SectionTimetablePanel above).
 */
function MyClassesView() {
  const { data: slots, isLoading } = useAsync(() => academicsApi.myTimetable(), []);

  const bySection = useMemo(() => {
    const map = new Map<string, { section: TimetableSlot["sectionSubject"]["section"]; subjects: Set<string> }>();
    for (const slot of slots ?? []) {
      const key = slot.sectionSubject.section.id;
      const entry = map.get(key) ?? { section: slot.sectionSubject.section, subjects: new Set<string>() };
      entry.subjects.add(slot.sectionSubject.subject.name);
      map.set(key, entry);
    }
    return Array.from(map.values());
  }, [slots]);

  const byDay = useMemo(() => {
    return DAYS_OF_WEEK.map((day) => ({
      day,
      slots: (slots ?? [])
        .filter((s) => s.dayOfWeek === day)
        .sort((a, b) => a.startTime.localeCompare(b.startTime)),
    })).filter((d) => d.slots.length > 0);
  }, [slots]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-page-title font-semibold text-slate-900">My classes</h1>

      {isLoading ? (
        <Spinner label="Loading your timetable" />
      ) : !slots || slots.length === 0 ? (
        <EmptyState message="No classes assigned to you yet — your admin hasn't built your timetable." />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Sections you teach</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-1 text-sm text-slate-700">
                {bySection.map((entry) => (
                  <li key={entry.section.id}>
                    <span className="font-medium">
                      {entry.section.schoolClass.name} {entry.section.name}
                    </span>{" "}
                    — {Array.from(entry.subjects).join(", ")}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {byDay.map(({ day, slots: daySlots }) => (
            <Card key={day}>
              <CardHeader>
                <CardTitle>{DAY_LABELS[day]}</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableHeaderCell>Time</TableHeaderCell>
                      <TableHeaderCell>Class</TableHeaderCell>
                      <TableHeaderCell>Subject</TableHeaderCell>
                      <TableHeaderCell>Room</TableHeaderCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {daySlots.map((slot) => (
                      <TableRow key={slot.id}>
                        <TableCell>
                          {formatSlotTime(slot.startTime)}–{formatSlotTime(slot.endTime)}
                        </TableCell>
                        <TableCell>
                          {slot.sectionSubject.section.schoolClass.name} {slot.sectionSubject.section.name}
                        </TableCell>
                        <TableCell>{slot.sectionSubject.subject.name}</TableCell>
                        <TableCell>{slot.roomNumber ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))}
        </>
      )}
    </div>
  );
}

export default function AcademicsPage() {
  const { user } = useAuth();

  if (user?.role === "TEACHER") {
    return <MyClassesView />;
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-page-title font-semibold text-slate-900">Academics</h1>
      <YearsSection />
      <ClassesSection />
      <SubjectsSection />
      <SectionsSection />
    </div>
  );
}
