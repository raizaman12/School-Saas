"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Search, Download, CalendarClock, ListChecks, Trophy, Eye, PencilLine, CalendarDays } from "lucide-react";
import { useAsync } from "@/lib/hooks/useAsync";
import { useAuth } from "@/lib/auth/AuthProvider";
import { academicsApi } from "@/lib/resources/academics";
import { examsApi, type ReportCardBatchJob, type SubmissionStatusRow } from "@/lib/resources/exams";
import { studentsApi, type StudentListItem } from "@/lib/resources/students";
import { SectionCascadeSelect } from "@/components/domain/SectionCascadeSelect";
import { ApiError, downloadFile } from "@/lib/api";
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
} from "@/components/ui";

interface DatesheetRow {
  sectionSubjectId: string;
  subjectLabel: string;
  examDate: string;
  startTime: string;
  maxMarks: string;
  passingMarks: string;
}

/**
 * The "har class ki exam datesheet banane wala hisaab" — pick a class/section
 * and every subject it has gets one row where the admin sets that paper's
 * date (and optionally time) plus max/passing marks, all saved in a single
 * bulk call. Re-picking a section that already has a datesheet pre-fills the
 * existing dates so re-opening this just edits them instead of starting over.
 * A subject with no date set here never appears on the students'/parents'
 * portal or in "Enter marks" — see POST /:examId/subjects/bulk.
 */
function DatesheetBuilder({ examId, onSaved }: { examId: string; onSaved: () => void }) {
  const [sectionId, setSectionId] = useState<string | undefined>(undefined);
  const [rows, setRows] = useState<DatesheetRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const { data: sectionSubjects, isLoading: subjectsLoading } = useAsync(
    () => (sectionId ? academicsApi.listSectionSubjects(sectionId) : Promise.resolve(null)),
    [sectionId],
  );
  const { data: existing } = useAsync(
    () => (sectionId ? examsApi.listSubjects(examId, sectionId) : Promise.resolve(null)),
    [examId, sectionId],
  );

  useEffect(() => {
    setSaved(false);
    if (!sectionSubjects) {
      setRows([]);
      return;
    }
    setRows(
      sectionSubjects.map((ss) => {
        const current = existing?.find((e) => e.sectionSubject.id === ss.id);
        return {
          sectionSubjectId: ss.id,
          subjectLabel: ss.subject.name + (ss.teacher ? ` — ${ss.teacher.fullName}` : ""),
          examDate: current?.examDate ? current.examDate.slice(0, 10) : "",
          startTime: current?.startTime ? current.startTime.slice(11, 16) : "",
          maxMarks: String(current?.maxMarks ?? 100),
          passingMarks: String(current?.passingMarks ?? 40),
        };
      }),
    );
    // sectionSubjects already carries sectionId's identity; existing is only
    // used to pre-fill once when the section (re)loads, not on every refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionSubjects]);

  const updateRow = (index: number, patch: Partial<DatesheetRow>) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
    setSaved(false);
  };

  const canSave = !!sectionId && rows.length > 0 && rows.every((r) => r.examDate && r.maxMarks && r.passingMarks);

  const save = async () => {
    if (!sectionId) return;
    setError(null);
    setIsSaving(true);
    try {
      await examsApi.bulkSetDatesheet(examId, {
        sectionId,
        subjects: rows.map((r) => ({
          sectionSubjectId: r.sectionSubjectId,
          examDate: r.examDate,
          startTime: r.startTime || undefined,
          maxMarks: Number(r.maxMarks),
          passingMarks: Number(r.passingMarks),
        })),
      });
      setSaved(true);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the datesheet.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-slate-200 p-4">
      {error && <Alert tone="danger">{error}</Alert>}
      {saved && <Alert tone="success">Datesheet saved — it&apos;s now visible on this section&apos;s student/parent portal.</Alert>}
      <div>
        <p className="mb-2 text-sm font-medium text-slate-700">Class &amp; section</p>
        <SectionCascadeSelect onChange={(v) => setSectionId(v?.sectionId)} />
      </div>

      {sectionId && subjectsLoading && <Spinner label="Loading subjects" />}
      {sectionId && sectionSubjects && sectionSubjects.length === 0 && (
        <EmptyState message="This section has no subjects assigned yet — add subjects to it first." />
      )}

      {sectionId && rows.length > 0 && (
        <>
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Subject</TableHeaderCell>
                <TableHeaderCell>Exam date</TableHeaderCell>
                <TableHeaderCell>Start time</TableHeaderCell>
                <TableHeaderCell>Max marks</TableHeaderCell>
                <TableHeaderCell>Passing marks</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row, i) => (
                <TableRow key={row.sectionSubjectId}>
                  <TableCell className="font-medium text-slate-900">{row.subjectLabel}</TableCell>
                  <TableCell>
                    <Input
                      aria-label={`Exam date for ${row.subjectLabel}`}
                      type="date"
                      value={row.examDate}
                      onChange={(e) => updateRow(i, { examDate: e.target.value })}
                      className="w-40"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      aria-label={`Start time for ${row.subjectLabel}`}
                      type="time"
                      value={row.startTime}
                      onChange={(e) => updateRow(i, { startTime: e.target.value })}
                      className="w-32"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      aria-label={`Max marks for ${row.subjectLabel}`}
                      type="number"
                      value={row.maxMarks}
                      onChange={(e) => updateRow(i, { maxMarks: e.target.value })}
                      className="w-20"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      aria-label={`Passing marks for ${row.subjectLabel}`}
                      type="number"
                      value={row.passingMarks}
                      onChange={(e) => updateRow(i, { passingMarks: e.target.value })}
                      className="w-20"
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-slate-500">
              A subject only shows up for marks entry and on the student/parent portal once it has a date here.
            </p>
            <Button size="sm" isLoading={isSaving} disabled={!canSave} onClick={save}>
              Save datesheet
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function ReportCardLookup({ examId }: { examId: string }) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<StudentListItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    if (search.trim().length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setIsSearching(true);
    const timer = setTimeout(() => {
      studentsApi
        .list({ page: 1, limit: 8, search })
        .then((res) => {
          if (!cancelled) setResults(res.data);
        })
        .finally(() => {
          if (!cancelled) setIsSearching(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search]);

  return (
    <div className="flex flex-col gap-2">
      <div className="relative max-w-sm">
        <Input
          label="Find a student"
          placeholder="Name or admission code"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Search className="pointer-events-none absolute right-3 top-9 size-4 text-slate-400" aria-hidden="true" />
      </div>
      {isSearching && <Spinner label="Searching" />}
      {results.length > 0 && (
        <ul className="flex flex-col divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
          {results.map((s) => (
            <li key={s.id}>
              <Link
                href={`/dashboard/exams/${examId}/report-card/${s.id}`}
                className="flex items-center justify-between px-3 py-2 text-sm hover:bg-slate-50"
              >
                <span className="font-medium text-slate-900">{s.fullName}</span>
                <span className="text-slate-400">{s.studentCode}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BatchReportCards({ examId }: { examId: string }) {
  const { data: classes } = useAsync(() => academicsApi.listClasses(), []);
  const { data: sections } = useAsync(() => academicsApi.listSections(), []);
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [job, setJob] = useState<ReportCardBatchJob | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sectionsForClass = (sections ?? []).filter((s) => s.schoolClass.id === classId);

  useEffect(() => {
    setSectionId("");
  }, [classId]);

  useEffect(() => {
    if (!job || job.status === "COMPLETED" || job.status === "FAILED") return;
    const timer = setInterval(() => {
      examsApi.getBatch(job.id).then(setJob);
    }, 2000);
    return () => clearInterval(timer);
  }, [job]);

  const startBatch = async () => {
    if (!classId) return;
    setError(null);
    try {
      const created = await examsApi.createBatch(examId, classId, sectionId || undefined);
      setJob(created);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not start batch generation.");
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="flex flex-wrap items-end gap-3">
        <Select label="Class" value={classId} onChange={(e) => setClassId(e.target.value)} className="w-48">
          <option value="">Select class…</option>
          {classes?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select
          label="Section"
          value={sectionId}
          onChange={(e) => setSectionId(e.target.value)}
          disabled={!classId}
          className="w-48"
        >
          <option value="">All sections</option>
          {sectionsForClass.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <Button size="sm" disabled={!classId || (!!job && job.status !== "COMPLETED" && job.status !== "FAILED")} onClick={startBatch}>
          Generate report cards
        </Button>
      </div>

      {job && (
        <div className="flex items-center gap-3 text-sm">
          <Badge
            tone={job.status === "COMPLETED" ? "success" : job.status === "FAILED" ? "danger" : "default"}
          >
            {job.status}
          </Badge>
          <span className="text-slate-500">
            {job.processedCount}/{job.totalCount || "…"} processed
          </span>
          {job.status === "COMPLETED" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => downloadFile(`/api/exams/report-card-batches/${job.id}/download`, `report-cards-${job.id}.zip`)}
            >
              <Download className="size-4" aria-hidden="true" />
              Download zip
            </Button>
          )}
          {job.status === "FAILED" && job.errorMessage && <span className="text-red-600">{job.errorMessage}</span>}
        </div>
      )}
    </div>
  );
}

/** Admin-only: set (or clear) the date by which subject teachers should submit their marks. Purely informational — see Exam.resultsDeadline's doc comment. */
function ResultsDeadlineCard({ exam, onUpdated }: { exam: { id: string; resultsDeadline: string | null }; onUpdated: () => void }) {
  const [value, setValue] = useState(exam.resultsDeadline ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setValue(exam.resultsDeadline ?? "");
  }, [exam.resultsDeadline]);

  const save = async (next: string | null) => {
    setError(null);
    setSaved(false);
    setIsSaving(true);
    try {
      await examsApi.setResultsDeadline(exam.id, next);
      setSaved(true);
      onUpdated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update the deadline.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {error && <Alert tone="danger">{error}</Alert>}
      {saved && <Alert tone="success">Deadline updated.</Alert>}
      <p className="text-sm text-slate-500">
        Subject teachers see this date on their own &quot;Grades&quot; tab — it doesn&apos;t block marks entry, it just
        tells you who&apos;s still behind (see &quot;Marks submission status&quot; below).
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <Input label="Results deadline" type="date" value={value} onChange={(e) => setValue(e.target.value)} className="w-48" />
        <Button size="sm" isLoading={isSaving} onClick={() => save(value || null)} disabled={!value}>
          Save deadline
        </Button>
        {exam.resultsDeadline && (
          <Button size="sm" variant="outline" isLoading={isSaving} onClick={() => save(null)}>
            Clear deadline
          </Button>
        )}
      </div>
    </div>
  );
}

/** Admin-only: which subject teachers have (and haven't) finished entering/submitting marks for this exam. */
function SubmissionStatusCard({ examId }: { examId: string }) {
  const { data: rows, isLoading, error } = useAsync(() => examsApi.submissionStatus(examId), [examId]);

  if (isLoading) return <Spinner label="Loading submission status" />;
  if (error) return <Alert tone="danger">Failed to load submission status: {error.message}</Alert>;
  if (!rows || rows.length === 0) return <EmptyState message="No subjects added to this exam yet." />;

  const pending = rows.filter((r: SubmissionStatusRow) => !r.submitted);

  return (
    <div className="flex flex-col gap-3">
      {pending.length > 0 ? (
        <Alert tone="warning">
          {pending.length} of {rows.length} subject{rows.length === 1 ? "" : "s"} still not submitted.
        </Alert>
      ) : (
        <Alert tone="success">All subjects submitted.</Alert>
      )}
      <Table>
        <TableHead>
          <TableRow>
            <TableHeaderCell>Subject</TableHeaderCell>
            <TableHeaderCell>Section</TableHeaderCell>
            <TableHeaderCell>Teacher</TableHeaderCell>
            <TableHeaderCell>Marks entered</TableHeaderCell>
            <TableHeaderCell>Status</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r: SubmissionStatusRow) => (
            <TableRow key={r.examSubjectId}>
              <TableCell>{r.subject}</TableCell>
              <TableCell>{r.section}</TableCell>
              <TableCell>{r.teacher?.fullName ?? "—"}</TableCell>
              <TableCell>
                {r.marksEnteredCount} / {r.totalStudents}
              </TableCell>
              <TableCell>
                <Badge tone={r.submitted ? "success" : "warning"}>{r.submitted ? "Submitted" : "Pending"}</Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * Admin's "Generate Result" flow: pick a Class + Section and get every
 * student's ranked result inline, with View/Edit shortcuts — replaces
 * having to wait for/download a zip of PDFs just to see how a class did
 * (the PDF batch generator above still exists for when printable copies
 * are actually needed).
 */
function GenerateResultsCard({ examId }: { examId: string }) {
  const [sectionId, setSectionId] = useState<string | null>(null);
  const { data: rows, isLoading, error } = useAsync(
    () => (sectionId ? examsApi.sectionResults(examId, sectionId) : Promise.resolve(null)),
    [examId, sectionId],
  );

  return (
    <div className="flex flex-col gap-4">
      <SectionCascadeSelect onChange={(v) => setSectionId(v?.sectionId ?? null)} />

      {!sectionId && <EmptyState message="Pick a class and section to generate its results list." />}
      {sectionId && isLoading && <Spinner label="Loading results" />}
      {sectionId && error && <Alert tone="danger">Failed to load results: {error.message}</Alert>}
      {sectionId && rows && rows.length === 0 && <EmptyState message="No active students in this section." />}

      {sectionId && rows && rows.length > 0 && (
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
                  <div className="flex items-center gap-3">
                    <Link
                      href={`/dashboard/exams/${examId}/report-card/${r.studentId}`}
                      className="inline-flex items-center gap-1 text-primary-600 hover:underline"
                    >
                      <Eye className="size-4" aria-hidden="true" />
                      View
                    </Link>
                    <Link
                      href={`/dashboard/exams/${examId}/results/${r.studentId}`}
                      className="inline-flex items-center gap-1 text-primary-600 hover:underline"
                    >
                      <PencilLine className="size-4" aria-hidden="true" />
                      Edit
                    </Link>
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

export default function ExamDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useAuth();
  const canManage = user?.role === "SCHOOL_ADMIN";
  const [showDatesheetBuilder, setShowDatesheetBuilder] = useState(false);

  const { data: exams } = useAsync(() => examsApi.list(), []);
  const { data: subjects, isLoading, error, refetch } = useAsync(() => examsApi.listSubjects(id), [id]);

  const exam = exams?.find((e) => e.id === id);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-page-title font-semibold text-slate-900">{exam?.name ?? "Exam"}</h1>
        <p className="text-sm text-slate-500">Configure subjects, enter marks, and generate report cards.</p>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays className="size-4" aria-hidden="true" /> Datesheet
            </span>
          </CardTitle>
          {canManage && (
            <Button size="sm" variant="outline" onClick={() => setShowDatesheetBuilder((v) => !v)}>
              <Plus className="size-4" aria-hidden="true" />
              {showDatesheetBuilder ? "Close" : "Build datesheet"}
            </Button>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {showDatesheetBuilder && (
            <DatesheetBuilder
              examId={id}
              onSaved={() => {
                refetch();
              }}
            />
          )}

          {isLoading && <Spinner label="Loading subjects" />}
          {error && <p className="text-sm text-red-600">Failed to load subjects: {error.message}</p>}

          {subjects && (
            <>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>Subject</TableHeaderCell>
                    <TableHeaderCell>Section</TableHeaderCell>
                    <TableHeaderCell>Teacher</TableHeaderCell>
                    <TableHeaderCell>Date &amp; time</TableHeaderCell>
                    <TableHeaderCell>Max / passing</TableHeaderCell>
                    <TableHeaderCell>Marks</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {subjects.map((es) => (
                    <TableRow key={es.id}>
                      <TableCell>{es.sectionSubject.subject.name}</TableCell>
                      <TableCell>{es.sectionSubject.section.name}</TableCell>
                      <TableCell>{es.sectionSubject.teacher?.fullName ?? "—"}</TableCell>
                      <TableCell>
                        {es.examDate ? (
                          <>
                            {new Date(es.examDate).toLocaleDateString()}
                            {es.startTime
                              ? ` · ${new Date(es.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })}`
                              : ""}
                          </>
                        ) : (
                          <Badge tone="warning">Not scheduled</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {es.maxMarks} / {es.passingMarks}
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/dashboard/exams/${id}/marks/${es.id}`}
                          className="font-medium text-primary-600 hover:underline"
                        >
                          Enter marks
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {subjects.length === 0 && (
                <EmptyState message="No subjects scheduled yet — use “Build datesheet” to pick a class and set each subject's exam date." />
              )}
            </>
          )}
        </CardContent>
      </Card>

      {canManage && exam && (
        <Card>
          <CardHeader>
            <CardTitle>
              <span className="inline-flex items-center gap-1.5">
                <CalendarClock className="size-4" aria-hidden="true" /> Results deadline
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResultsDeadlineCard exam={exam} onUpdated={() => {}} />
          </CardContent>
        </Card>
      )}

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>
              <span className="inline-flex items-center gap-1.5">
                <ListChecks className="size-4" aria-hidden="true" /> Marks submission status
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <SubmissionStatusCard examId={id} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            <span className="inline-flex items-center gap-1.5">
              <Trophy className="size-4" aria-hidden="true" /> Generate result
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <GenerateResultsCard examId={id} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Report card lookup</CardTitle>
        </CardHeader>
        <CardContent>
          <ReportCardLookup examId={id} />
        </CardContent>
      </Card>

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>Batch-generate report cards (PDF/zip)</CardTitle>
          </CardHeader>
          <CardContent>
            <BatchReportCards examId={id} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
