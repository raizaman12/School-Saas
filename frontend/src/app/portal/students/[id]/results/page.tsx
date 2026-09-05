"use client";

import { use, useState } from "react";
import { FileText, CalendarDays } from "lucide-react";
import { useAsync } from "@/lib/hooks/useAsync";
import { portalApi, type PortalReportCard, type PortalDatesheetEntry } from "@/lib/resources/portal";
import { PortalStudentHeader } from "@/components/domain/PortalStudentHeader";
import { ApiError } from "@/lib/api";
import {
  Badge,
  Alert,
  Spinner,
  Button,
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

export default function PortalStudentResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const { data: student, isLoading, error } = useAsync(() => portalApi.student(id), [id]);
  const { data: exams } = useAsync(() => portalApi.exams(id), [id]);

  const [selectedExamId, setSelectedExamId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<"reportCard" | "datesheet" | null>(null);
  const [reportCard, setReportCard] = useState<PortalReportCard | null>(null);
  const [reportCardLoading, setReportCardLoading] = useState(false);
  const [reportCardError, setReportCardError] = useState<string | null>(null);
  const [datesheet, setDatesheet] = useState<PortalDatesheetEntry[] | null>(null);
  const [datesheetLoading, setDatesheetLoading] = useState(false);
  const [datesheetError, setDatesheetError] = useState<string | null>(null);

  const viewReportCard = async (examId: string) => {
    setSelectedExamId(examId);
    setActiveView("reportCard");
    setReportCard(null);
    setReportCardError(null);
    setReportCardLoading(true);
    try {
      const rc = await portalApi.reportCard(id, examId);
      setReportCard(rc);
    } catch (err) {
      setReportCardError(err instanceof ApiError ? err.message : "Could not load report card.");
    } finally {
      setReportCardLoading(false);
    }
  };

  const viewDatesheet = async (examId: string) => {
    setSelectedExamId(examId);
    setActiveView("datesheet");
    setDatesheet(null);
    setDatesheetError(null);
    setDatesheetLoading(true);
    try {
      const rows = await portalApi.examDatesheet(id, examId);
      setDatesheet(rows);
    } catch (err) {
      setDatesheetError(err instanceof ApiError ? err.message : "Could not load the datesheet.");
    } finally {
      setDatesheetLoading(false);
    }
  };

  if (isLoading) return <Spinner label="Loading student" />;
  if (error) return <Alert tone="danger">Failed to load student: {error.message}</Alert>;
  if (!student) return null;

  return (
    <div className="flex flex-col gap-4">
      <PortalStudentHeader student={student} />

      <Card>
        <CardHeader>
          <CardTitle>Exams &amp; report cards</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!exams ? (
            <Spinner label="Loading exams" />
          ) : exams.length === 0 ? (
            <EmptyState message="No exams found for this student's section yet." />
          ) : (
            <ul className="flex flex-col divide-y divide-slate-100">
              {exams.map((exam) => (
                <li key={exam.id} className="flex items-center justify-between gap-3 py-2">
                  <div>
                    <p className="text-sm font-medium text-slate-900">{exam.name}</p>
                    {exam.startDate && (
                      <p className="text-xs text-slate-500">
                        {new Date(exam.startDate).toLocaleDateString()}
                        {exam.endDate ? ` – ${new Date(exam.endDate).toLocaleDateString()}` : ""}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant={selectedExamId === exam.id && activeView === "datesheet" ? "primary" : "outline"}
                      onClick={() => viewDatesheet(exam.id)}
                    >
                      <CalendarDays className="size-4" aria-hidden="true" />
                      Datesheet
                    </Button>
                    <Button
                      size="sm"
                      variant={selectedExamId === exam.id && activeView === "reportCard" ? "primary" : "outline"}
                      onClick={() => viewReportCard(exam.id)}
                    >
                      <FileText className="size-4" aria-hidden="true" />
                      Report card
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {selectedExamId && activeView === "datesheet" && (
            <div className="rounded-lg border border-slate-200 p-4">
              {datesheetLoading && <Spinner label="Loading datesheet" />}
              {datesheetError && <Alert tone="danger">{datesheetError}</Alert>}
              {datesheet && datesheet.length === 0 && (
                <EmptyState message="No datesheet has been published for this exam yet — check back once the school schedules it." />
              )}
              {datesheet && datesheet.length > 0 && (
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableHeaderCell>Subject</TableHeaderCell>
                      <TableHeaderCell>Date</TableHeaderCell>
                      <TableHeaderCell>Time</TableHeaderCell>
                      <TableHeaderCell>Max marks</TableHeaderCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {datesheet.map((row) => (
                      <TableRow key={row.examSubjectId}>
                        <TableCell className="font-medium text-slate-900">{row.subject}</TableCell>
                        <TableCell>{new Date(row.examDate).toLocaleDateString()}</TableCell>
                        <TableCell>
                          {row.startTime
                            ? new Date(row.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })
                            : "—"}
                        </TableCell>
                        <TableCell>{row.maxMarks}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          )}

          {selectedExamId && activeView === "reportCard" && (
            <div className="rounded-lg border border-slate-200 p-4">
              {reportCardLoading && <Spinner label="Loading report card" />}
              {reportCardError && <Alert tone="danger">{reportCardError}</Alert>}
              {reportCard && (
                <div className="flex flex-col gap-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="font-semibold text-slate-900">{reportCard.exam.name}</h3>
                      <p className="text-xs text-slate-500">{reportCard.exam.academicYear}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {reportCard.summary.rank !== null && (
                        <Badge tone="info">
                          Position {reportCard.summary.rank} of {reportCard.summary.totalRanked}
                        </Badge>
                      )}
                      {reportCard.summary.grade && (
                        <Badge tone={reportCard.summary.grade === "F" ? "danger" : "success"}>
                          Grade {reportCard.summary.grade}
                        </Badge>
                      )}
                    </div>
                  </div>

                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableHeaderCell>Subject</TableHeaderCell>
                        <TableHeaderCell>Marks</TableHeaderCell>
                        <TableHeaderCell>%</TableHeaderCell>
                        <TableHeaderCell>Grade</TableHeaderCell>
                        <TableHeaderCell>Result</TableHeaderCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {reportCard.subjects.map((s) => (
                        <TableRow key={s.subject}>
                          <TableCell>{s.subject}</TableCell>
                          <TableCell>
                            {s.marksObtained ?? "—"} / {s.maxMarks}
                          </TableCell>
                          <TableCell>{s.percentage !== null ? `${s.percentage}%` : "—"}</TableCell>
                          <TableCell>{s.grade ?? "—"}</TableCell>
                          <TableCell>
                            {s.passed === null ? (
                              "—"
                            ) : (
                              <Badge tone={s.passed ? "success" : "danger"}>{s.passed ? "Pass" : "Fail"}</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>

                  <dl className="flex flex-wrap gap-4 text-sm">
                    <div>
                      <dt className="text-slate-500">Total</dt>
                      <dd className="font-medium text-slate-900">
                        {reportCard.summary.totalObtained} / {reportCard.summary.totalMax}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Overall %</dt>
                      <dd className="font-medium text-slate-900">
                        {reportCard.summary.percentage !== null ? `${reportCard.summary.percentage}%` : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Subjects graded</dt>
                      <dd className="font-medium text-slate-900">
                        {reportCard.summary.subjectsGraded} / {reportCard.summary.subjectsTotal}
                      </dd>
                    </div>
                  </dl>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
