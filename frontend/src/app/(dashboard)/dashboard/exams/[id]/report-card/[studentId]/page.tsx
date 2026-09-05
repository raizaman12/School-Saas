"use client";

import { use } from "react";
import Link from "next/link";
import { ArrowLeft, Download } from "lucide-react";
import { useAsync } from "@/lib/hooks/useAsync";
import { examsApi } from "@/lib/resources/exams";
import { downloadFile } from "@/lib/api";
import {
  Button,
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
} from "@/components/ui";

export default function ReportCardPage({
  params,
}: {
  params: Promise<{ id: string; studentId: string }>;
}) {
  const { id: examId, studentId } = use(params);
  const { data: reportCard, isLoading, error } = useAsync(() => examsApi.getReportCard(examId, studentId), [examId, studentId]);

  return (
    <div className="flex flex-col gap-4">
      <Link
        href={`/dashboard/exams/${examId}`}
        className="flex w-fit items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to exam
      </Link>

      {isLoading && <Spinner label="Loading report card" />}
      {error && <Alert tone="danger">Failed to load report card: {error.message}</Alert>}

      {reportCard && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h1 className="text-page-title font-semibold text-slate-900">{reportCard.student.fullName}</h1>
              <p className="text-sm text-slate-500">
                {reportCard.student.studentCode} · {reportCard.exam.name} · {reportCard.exam.academicYear}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                downloadFile(
                  `/api/exams/${examId}/report-card/${studentId}/pdf`,
                  `report-card-${reportCard.student.studentCode}.pdf`,
                )
              }
            >
              <Download className="size-4" aria-hidden="true" />
              Download PDF
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Subjects</CardTitle>
              </CardHeader>
              <CardContent>
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
                          {s.marksObtained !== null ? `${s.marksObtained} / ${s.maxMarks}` : "—"}
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
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Summary</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">Total</span>
                  <span className="font-medium text-slate-900">
                    {reportCard.summary.totalObtained} / {reportCard.summary.totalMax}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Percentage</span>
                  <span className="font-medium text-slate-900">
                    {reportCard.summary.percentage !== null ? `${reportCard.summary.percentage}%` : "—"}
                  </span>
                </div>
                <div className="flex justify-between border-b border-slate-100 pb-2">
                  <span className="text-slate-500">Grade</span>
                  <span className="font-semibold text-slate-900">{reportCard.summary.grade ?? "—"}</span>
                </div>
                {reportCard.summary.rank !== null && (
                  <div className="flex justify-between border-b border-slate-100 pb-2">
                    <span className="text-slate-500">Class position</span>
                    <span className="font-semibold text-slate-900">
                      {reportCard.summary.rank} of {reportCard.summary.totalRanked}
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-xs text-slate-400">
                  <span>Subjects graded</span>
                  <span>
                    {reportCard.summary.subjectsGraded} / {reportCard.summary.subjectsTotal}
                  </span>
                </div>

                {reportCard.attendance && (
                  <div className="mt-2 border-t border-slate-100 pt-2">
                    <p className="mb-1 text-slate-500">Attendance during exam period</p>
                    <div className="flex justify-between">
                      <span>Present</span>
                      <span>{reportCard.attendance.present}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Absent</span>
                      <span>{reportCard.attendance.absent}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Leave</span>
                      <span>{reportCard.attendance.leave}</span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
