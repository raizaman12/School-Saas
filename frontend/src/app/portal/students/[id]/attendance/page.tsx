"use client";

import { use } from "react";
import { CalendarOff, CalendarCheck } from "lucide-react";
import { useAsync } from "@/lib/hooks/useAsync";
import { portalApi } from "@/lib/resources/portal";
import { PortalStudentHeader } from "@/components/domain/PortalStudentHeader";
import {
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

const STATUS_LABELS: Record<string, string> = {
  PRESENT: "Present",
  ABSENT: "Absent",
  LATE: "Late",
  LEAVE: "Leave",
  HALF_DAY: "Half day",
  EARLY_LEAVE: "Early leave",
};

export default function PortalStudentAttendancePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const { data: student, isLoading, error } = useAsync(() => portalApi.student(id), [id]);
  const { data: attendance } = useAsync(() => portalApi.attendance(id), [id]);

  if (isLoading) return <Spinner label="Loading student" />;
  if (error) return <Alert tone="danger">Failed to load student: {error.message}</Alert>;
  if (!student) return null;

  return (
    <div className="flex flex-col gap-4">
      <PortalStudentHeader student={student} />

      <Card>
        <CardHeader>
          <CardTitle>Attendance</CardTitle>
        </CardHeader>
        <CardContent>
          {!attendance ? (
            <Spinner label="Loading attendance" />
          ) : (
            <>
              {attendance.today.isNonWorkingDay ? (
                <Alert tone="warning" className="mb-4" title="No class today">
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarOff className="size-4" aria-hidden="true" />
                    {attendance.today.reason === "WEEKLY_OFF"
                      ? `Weekly off — ${attendance.today.label}`
                      : attendance.today.label}
                    .
                  </span>
                </Alert>
              ) : (
                attendance.today.status && (
                  <Alert tone="info" className="mb-4" title="Today">
                    <span className="inline-flex items-center gap-1.5">
                      <CalendarCheck className="size-4" aria-hidden="true" />
                      Marked {STATUS_LABELS[attendance.today.status] ?? attendance.today.status} today.
                    </span>
                  </Alert>
                )
              )}

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
                    {attendance.records.slice(0, 10).map((r) => (
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
        </CardContent>
      </Card>
    </div>
  );
}
