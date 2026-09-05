"use client";

import { use } from "react";
import { useAsync } from "@/lib/hooks/useAsync";
import { portalApi } from "@/lib/resources/portal";
import { PortalStudentHeader } from "@/components/domain/PortalStudentHeader";
import { BLOOD_GROUP_LABEL, HEALTH_LOG_OUTCOME_LABEL } from "@/lib/resources/health";
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

export default function PortalStudentHealthPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const { data: student, isLoading, error } = useAsync(() => portalApi.student(id), [id]);
  const { data: healthProfile } = useAsync(() => portalApi.healthProfile(id), [id]);
  const { data: healthLog } = useAsync(() => portalApi.healthLog(id), [id]);

  if (isLoading) return <Spinner label="Loading student" />;
  if (error) return <Alert tone="danger">Failed to load student: {error.message}</Alert>;
  if (!student) return null;

  return (
    <div className="flex flex-col gap-4">
      <PortalStudentHeader student={student} />

      <Card>
        <CardHeader>
          <CardTitle>Health</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!healthProfile ? (
            <EmptyState message="No health profile recorded yet." />
          ) : (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <div>
                <dt className="text-slate-500">Blood group</dt>
                <dd className="text-slate-900">{healthProfile.bloodGroup ? BLOOD_GROUP_LABEL[healthProfile.bloodGroup] : "—"}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Emergency contact</dt>
                <dd className="text-slate-900">
                  {healthProfile.emergencyContactName ?? "—"}
                  {healthProfile.emergencyContactPhone ? ` (${healthProfile.emergencyContactPhone})` : ""}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-slate-500">Allergies</dt>
                <dd className="text-slate-900">{healthProfile.allergies ?? "—"}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-slate-500">Chronic conditions</dt>
                <dd className="text-slate-900">{healthProfile.chronicConditions ?? "—"}</dd>
              </div>
            </dl>
          )}

          {healthLog && healthLog.length > 0 && (
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Date</TableHeaderCell>
                  <TableHeaderCell>Complaint</TableHeaderCell>
                  <TableHeaderCell>Outcome</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {healthLog.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>{new Date(entry.visitDate).toLocaleDateString()}</TableCell>
                    <TableCell>{entry.complaint}</TableCell>
                    <TableCell>{HEALTH_LOG_OUTCOME_LABEL[entry.outcome]}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
