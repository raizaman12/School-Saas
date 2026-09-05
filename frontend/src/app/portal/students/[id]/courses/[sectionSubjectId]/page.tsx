"use client";

import { use, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Megaphone,
  FolderOpen,
  ClipboardList,
  GraduationCap,
  CalendarCheck,
  Pin,
  Download,
} from "lucide-react";
import { useAsync } from "@/lib/hooks/useAsync";
import { portalApi } from "@/lib/resources/portal";
import { classTestsApi } from "@/lib/resources/classTests";
import {
  Badge,
  Spinner,
  Card,
  CardContent,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
  EmptyState,
} from "@/components/ui";

const STATUS_LABELS: Record<string, string> = {
  PRESENT: "Present",
  ABSENT: "Absent",
  LATE: "Late",
  LEAVE: "Leave",
  HALF_DAY: "Half day",
  EARLY_LEAVE: "Early leave",
};

const TONE_BADGE: Record<string, "default" | "info" | "danger" | "success" | "warning"> = {
  GENERAL: "default",
  IMPORTANT: "info",
  URGENT: "danger",
  EVENT: "success",
  HOLIDAY: "warning",
};

type TabKey = "announcements" | "materials" | "assessment" | "grades" | "attendance";

const TABS: { key: TabKey; label: string; icon: typeof Megaphone }[] = [
  { key: "announcements", label: "Announcements", icon: Megaphone },
  { key: "materials", label: "Course Material", icon: FolderOpen },
  { key: "assessment", label: "Assessment", icon: ClipboardList },
  { key: "grades", label: "View Grades", icon: GraduationCap },
  { key: "attendance", label: "Attendance", icon: CalendarCheck },
];

export default function PortalCourseDetailPage({
  params,
}: {
  params: Promise<{ id: string; sectionSubjectId: string }>;
}) {
  const { id, sectionSubjectId } = use(params);
  const [tab, setTab] = useState<TabKey>("announcements");

  const { data: courses } = useAsync(() => portalApi.courses(id), [id]);
  const course = courses?.find((c) => c.id === sectionSubjectId) ?? null;

  const { data: announcements, isLoading: announcementsLoading } = useAsync(
    () => portalApi.courseAnnouncements(id, sectionSubjectId),
    [id, sectionSubjectId],
  );
  const { data: materials, isLoading: materialsLoading } = useAsync(
    () => portalApi.courseMaterials(id, sectionSubjectId),
    [id, sectionSubjectId],
  );
  const { data: homework, isLoading: homeworkLoading } = useAsync(
    () => portalApi.courseHomework(id, sectionSubjectId),
    [id, sectionSubjectId],
  );
  const { data: grades, isLoading: gradesLoading } = useAsync(
    () => portalApi.courseGrades(id, sectionSubjectId),
    [id, sectionSubjectId],
  );
  // Separate from `grades` above — a class test is a distinct concept from
  // a formal exam paper (never counted in the report card/class ranking —
  // see the backend's classTests.ts doc comment) — shown as its own list
  // rather than merged into the same table so that distinction stays clear
  // here too.
  const { data: classTests, isLoading: classTestsLoading } = useAsync(
    () => classTestsApi.portalResults(id, sectionSubjectId),
    [id, sectionSubjectId],
  );
  // Attendance is not scoped per course — a student marks daily/section-level
  // attendance, so this tab shows their whole attendance history for as
  // long as they've studied this course (same data as the student's main
  // portal page), per explicit product direction rather than a separate
  // per-period attendance system.
  const { data: attendance, isLoading: attendanceLoading } = useAsync(() => portalApi.attendance(id), [id]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link
          href={`/portal/students/${id}`}
          className="mb-2 inline-flex items-center gap-1 text-sm text-primary-600 hover:underline"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to courses
        </Link>
        <h1 className="text-page-title font-semibold text-slate-900">{course ? course.subject.name : "Course"}</h1>
        {course && (
          <p className="text-sm text-slate-500">
            {course.teacher ? course.teacher.fullName : "No teacher assigned"} · {course.section.schoolClass.name} -{" "}
            {course.section.name}
          </p>
        )}
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

      {tab === "announcements" && (
        <div className="flex flex-col gap-3">
          {announcementsLoading && <Spinner label="Loading announcements" />}
          {announcements && announcements.length === 0 && <EmptyState message="No announcements from this teacher yet." />}
          {announcements?.map((a) => (
            <Card key={a.id}>
              <CardContent className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    {a.isPinned && <Pin className="size-3.5 text-primary-600" aria-hidden="true" />}
                    <h3 className="font-medium text-slate-900">{a.title}</h3>
                  </div>
                  <Badge tone={TONE_BADGE[a.tone] ?? "default"}>{a.tone}</Badge>
                </div>
                <p className="text-sm text-slate-700">{a.body}</p>
                <p className="text-xs text-slate-500">
                  {a.publishedByUser.fullName} · {new Date(a.publishedAt).toLocaleDateString()}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {tab === "materials" && (
        <div className="flex flex-col gap-3">
          {materialsLoading && <Spinner label="Loading course material" />}
          {materials && materials.length === 0 && <EmptyState message="No course material shared yet." />}
          {materials && materials.length > 0 && (
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Title</TableHeaderCell>
                  <TableHeaderCell>Shared by</TableHeaderCell>
                  <TableHeaderCell>Date</TableHeaderCell>
                  <TableHeaderCell></TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {materials.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>{m.title}</TableCell>
                    <TableCell>{m.uploadedByUser.fullName}</TableCell>
                    <TableCell>{new Date(m.createdAt).toLocaleDateString()}</TableCell>
                    <TableCell>
                      <a
                        href={m.fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-primary-600 hover:underline"
                      >
                        <Download className="size-4" aria-hidden="true" />
                        Download
                      </a>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}

      {tab === "assessment" && (
        <div className="flex flex-col gap-3">
          {homeworkLoading && <Spinner label="Loading assessments" />}
          {homework && homework.length === 0 && <EmptyState message="No assignments given yet." />}
          {homework?.map((hw) => (
            <Card key={hw.id}>
              <CardContent className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-medium text-slate-900">{hw.title}</h3>
                  <Badge tone="warning">Due {new Date(hw.dueDate).toLocaleDateString()}</Badge>
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
                <p className="text-xs text-slate-500">Assigned by {hw.assignedByUser.fullName}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {tab === "grades" && (
        <div className="flex flex-col gap-6">
          <div>
            <h2 className="mb-2 text-sm font-semibold text-slate-900">Exams</h2>
            {gradesLoading && <Spinner label="Loading grades" />}
            {grades && grades.length === 0 && <EmptyState message="No graded exams for this course yet." />}
            {grades && grades.length > 0 && (
              <Table>
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>Exam</TableHeaderCell>
                    <TableHeaderCell>Marks</TableHeaderCell>
                    <TableHeaderCell>Remarks</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {grades.map((g) => (
                    <TableRow key={g.exam.id}>
                      <TableCell>{g.exam.name}</TableCell>
                      <TableCell>
                        {g.marksObtained ?? "—"} / {g.maxMarks}
                      </TableCell>
                      <TableCell>{g.remarks ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>

          <div>
            <h2 className="mb-2 text-sm font-semibold text-slate-900">Class tests</h2>
            {classTestsLoading && <Spinner label="Loading class tests" />}
            {classTests && classTests.length === 0 && (
              <EmptyState message="No class tests recorded for this course yet." />
            )}
            {classTests && classTests.length > 0 && (
              <Table>
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>Test</TableHeaderCell>
                    <TableHeaderCell>Marks</TableHeaderCell>
                    <TableHeaderCell>Remarks</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {classTests.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>{c.name}</TableCell>
                      <TableCell>
                        {c.marksObtained ?? "—"} / {c.maxMarks}
                      </TableCell>
                      <TableCell>{c.remarks ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </div>
      )}

      {tab === "attendance" && (
        <div>
          {attendanceLoading && <Spinner label="Loading attendance" />}
          {attendance && (
            <>
              <div className="mb-4 flex flex-wrap gap-4 text-sm">
                {Object.entries(attendance.summary.counts).map(([status, count]) => (
                  <span key={status}>
                    {STATUS_LABELS[status] ?? status}: <span className="font-semibold text-slate-900">{count}</span>
                  </span>
                ))}
              </div>
              {attendance.records.length === 0 ? (
                <EmptyState message="No attendance records yet." />
              ) : (
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableHeaderCell>Date</TableHeaderCell>
                      <TableHeaderCell>Status</TableHeaderCell>
                      <TableHeaderCell>Remarks</TableHeaderCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {attendance.records.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>{new Date(r.date).toLocaleDateString()}</TableCell>
                        <TableCell>{STATUS_LABELS[r.status] ?? r.status}</TableCell>
                        <TableCell>{r.remarks ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
