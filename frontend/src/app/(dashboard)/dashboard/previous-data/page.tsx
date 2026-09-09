"use client";

import { useState } from "react";
import Link from "next/link";
import { Eye, Trophy } from "lucide-react";
import { useAsync } from "@/lib/hooks/useAsync";
import { useDebouncedValue } from "@/lib/hooks/useDebouncedValue";
import { studentsApi, type StudentStatus } from "@/lib/resources/students";
import { staffApi, type StaffStatus } from "@/lib/resources/staff";
import { examsApi } from "@/lib/resources/exams";
import { SectionCascadeSelect } from "@/components/domain/SectionCascadeSelect";
import {
  Button,
  Input,
  Select,
  Badge,
  Alert,
  Spinner,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
  EmptyState,
} from "@/components/ui";

const STUDENT_STATUS_TONE: Record<string, "success" | "default" | "warning" | "danger"> = {
  ACTIVE: "success",
  INACTIVE: "default",
  GRADUATED: "default",
  TRANSFERRED_OUT: "warning",
  EXPELLED: "danger",
  ARCHIVED: "danger",
};

const STAFF_STATUS_TONE: Record<string, "success" | "default" | "warning" | "danger"> = {
  ACTIVE: "success",
  ON_LEAVE: "warning",
  TERMINATED: "danger",
};

/**
 * The three groupings the user actually asked for — "students who left
 * school, students who were transferred, students the admin deleted" — plus
 * a combined "everything" option. The backend's status filter accepts a
 * comma-separated list (see sis/validation.ts), so "Left" collapses three
 * real statuses into one query instead of the page merging three separate
 * result pages by hand.
 */
const STUDENT_STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "INACTIVE,GRADUATED,EXPELLED,TRANSFERRED_OUT,ARCHIVED", label: "All previous students" },
  { value: "INACTIVE,GRADUATED,EXPELLED", label: "Left school (inactive / graduated / expelled)" },
  { value: "TRANSFERRED_OUT", label: "Transferred out" },
  { value: "ARCHIVED", label: "Archived (deleted by admin)" },
];

const STAFF_STATUS_FILTERS: { value: StaffStatus; label: string }[] = [
  { value: "TERMINATED", label: "Archived (left / removed by admin)" },
  { value: "ON_LEAVE", label: "On leave" },
];

type Tab = "students" | "teachers" | "results";
const TABS: { value: Tab; label: string }[] = [
  { value: "students", label: "Students" },
  { value: "teachers", label: "Teachers" },
  { value: "results", label: "Results" },
];

function StudentsTab() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>(STUDENT_STATUS_FILTERS[0].value);
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebouncedValue(search);

  const { data, isLoading, error } = useAsync(
    () =>
      studentsApi.list({
        page,
        limit: 20,
        search: debouncedSearch || undefined,
        sectionId: sectionId || undefined,
        status: status.split(",") as StudentStatus[],
      }),
    [page, debouncedSearch, status, sectionId],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full max-w-xs">
          <Input
            label="Search"
            placeholder="Name or admission code"
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
          />
        </div>
        <Select
          label="Status"
          value={status}
          onChange={(e) => {
            setPage(1);
            setStatus(e.target.value);
          }}
          className="w-64"
        >
          {STUDENT_STATUS_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </Select>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <p className="mb-2 text-xs font-medium text-slate-500">Narrow to a class + section (optional)</p>
        <SectionCascadeSelect
          onChange={(v) => {
            setPage(1);
            setSectionId(v?.sectionId ?? null);
          }}
        />
      </div>

      {isLoading && <Spinner label="Loading students" />}
      {error && <Alert tone="danger">Failed to load students: {error.message}</Alert>}

      {data && (
        <>
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Admission code</TableHeaderCell>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>Last known section</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.data.map((student) => (
                <TableRow key={student.id}>
                  <TableCell>
                    <Link
                      href={`/dashboard/students/${student.id}`}
                      className="font-medium text-primary-600 hover:underline"
                    >
                      {student.studentCode}
                    </Link>
                  </TableCell>
                  <TableCell>{student.fullName}</TableCell>
                  <TableCell>
                    {student.currentSection
                      ? `${student.currentSection.schoolClass.name} - ${student.currentSection.name}`
                      : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge tone={STUDENT_STATUS_TONE[student.status] ?? "default"}>{student.status}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {data.data.length === 0 && <EmptyState message="No students match these filters." />}

          <div className="flex items-center justify-between text-sm text-slate-500">
            <span>
              Page {data.meta.page} of {data.meta.totalPages} — {data.meta.total} total
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= data.meta.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function TeachersTab() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StaffStatus>(STAFF_STATUS_FILTERS[0].value);
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebouncedValue(search);

  const { data, isLoading, error } = useAsync(
    () => staffApi.list({ page, limit: 20, search: debouncedSearch || undefined, status }),
    [page, debouncedSearch, status],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full max-w-xs">
          <Input
            label="Search"
            placeholder="Name, employee code, designation"
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
          />
        </div>
        <Select
          label="Status"
          value={status}
          onChange={(e) => {
            setPage(1);
            setStatus(e.target.value as StaffStatus);
          }}
          className="w-64"
        >
          {STAFF_STATUS_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </Select>
      </div>

      {isLoading && <Spinner label="Loading staff" />}
      {error && <Alert tone="danger">Failed to load staff: {error.message}</Alert>}

      {data && (
        <>
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Employee code</TableHeaderCell>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>Role</TableHeaderCell>
                <TableHeaderCell>Designation</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.data.map((staff) => (
                <TableRow key={staff.id}>
                  <TableCell>
                    <Link href={`/dashboard/staff/${staff.id}`} className="font-medium text-primary-600 hover:underline">
                      {staff.employeeCode}
                    </Link>
                  </TableCell>
                  <TableCell>{staff.user.fullName}</TableCell>
                  <TableCell>{staff.user.role}</TableCell>
                  <TableCell>{staff.designation}</TableCell>
                  <TableCell>
                    <Badge tone={STAFF_STATUS_TONE[staff.status] ?? "default"}>{staff.status}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {data.data.length === 0 && <EmptyState message="No staff match these filters." />}

          <div className="flex items-center justify-between text-sm text-slate-500">
            <span>
              Page {data.meta.page} of {data.meta.totalPages} — {data.meta.total} total
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= data.meta.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Class + Section + Academic Year, then an Exam within that year — results
 * are pulled with historical=true, which resolves the roster from that
 * year's Enrollment records instead of each student's *current*
 * section/status, so a student who has since been promoted, transferred, or
 * archived still shows up here (see exams.ts's resolveHistoricalRoster).
 */
function ResultsTab() {
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [academicYearId, setAcademicYearId] = useState<string | null>(null);
  const [examId, setExamId] = useState<string>("");

  const { data: exams, isLoading: examsLoading } = useAsync(
    () => (academicYearId ? examsApi.list({ academicYearId }) : Promise.resolve(null)),
    [academicYearId],
  );

  const { data: rows, isLoading, error } = useAsync(
    () => (sectionId && examId ? examsApi.sectionResults(examId, sectionId, { historical: true }) : Promise.resolve(null)),
    [sectionId, examId],
  );

  return (
    <div className="flex flex-col gap-4">
      <SectionCascadeSelect
        onChange={(v) => {
          setSectionId(v?.sectionId ?? null);
          setAcademicYearId(v?.academicYearId ?? null);
          setExamId("");
        }}
      />

      {sectionId && (
        <Select label="Exam" value={examId} onChange={(e) => setExamId(e.target.value)} className="max-w-xs">
          <option value="">{examsLoading ? "Loading exams…" : "Select exam"}</option>
          {(exams ?? []).map((exam) => (
            <option key={exam.id} value={exam.id}>
              {exam.name}
            </option>
          ))}
        </Select>
      )}

      {!sectionId && <EmptyState message="Pick an academic year, class, and section to browse its results." />}
      {sectionId && !examId && <EmptyState message="Pick an exam to see this section's results for that year." />}
      {sectionId && examId && isLoading && <Spinner label="Loading results" />}
      {sectionId && examId && error && <Alert tone="danger">Failed to load results: {error.message}</Alert>}
      {sectionId && examId && rows && rows.length === 0 && (
        <EmptyState message="No students were enrolled in this section for that exam's academic year." />
      )}

      {sectionId && examId && rows && rows.length > 0 && (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>
                <span className="inline-flex items-center gap-1">
                  <Trophy className="size-3.5" aria-hidden="true" /> Position
                </span>
              </TableHeaderCell>
              <TableHeaderCell>Admission code</TableHeaderCell>
              <TableHeaderCell>Name</TableHeaderCell>
              <TableHeaderCell>Marks</TableHeaderCell>
              <TableHeaderCell>%</TableHeaderCell>
              <TableHeaderCell>Grade</TableHeaderCell>
              <TableHeaderCell>Subjects graded</TableHeaderCell>
              <TableHeaderCell></TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.studentId}>
                <TableCell>{r.rank !== null ? `${r.rank} / ${r.totalRanked}` : "—"}</TableCell>
                <TableCell>{r.studentCode}</TableCell>
                <TableCell className="font-medium text-slate-900">{r.fullName}</TableCell>
                <TableCell>
                  {r.totalObtained} / {r.totalMax}
                </TableCell>
                <TableCell>{r.percentage !== null ? `${r.percentage}%` : "—"}</TableCell>
                <TableCell>{r.grade ?? "—"}</TableCell>
                <TableCell>
                  {r.subjectsGraded} / {r.subjectsTotal}
                </TableCell>
                <TableCell>
                  <Link
                    href={`/dashboard/exams/${examId}/report-card/${r.studentId}`}
                    className="inline-flex items-center gap-1 text-primary-600 hover:underline"
                  >
                    <Eye className="size-4" aria-hidden="true" />
                    View
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

export default function PreviousDataPage() {
  const [tab, setTab] = useState<Tab>("students");

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-page-title font-semibold text-slate-900">Previous Data</h1>
        <p className="text-sm text-slate-500">
          Students who left, were transferred, or were archived; staff no longer active; and results from past
          academic years — without scrolling the regular lists.
        </p>
      </div>

      <div className="flex gap-1 border-b border-slate-200">
        {TABS.map((tb) => (
          <button
            key={tb.value}
            type="button"
            onClick={() => setTab(tb.value)}
            className={`focus-ring -mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === tb.value
                ? "border-primary-600 text-primary-700"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {tab === "students" && <StudentsTab />}
      {tab === "teachers" && <TeachersTab />}
      {tab === "results" && <ResultsTab />}
    </div>
  );
}
