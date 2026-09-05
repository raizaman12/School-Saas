"use client";

import { use } from "react";
import { useAsync } from "@/lib/hooks/useAsync";
import { portalApi } from "@/lib/resources/portal";
import { PortalStudentHeader } from "@/components/domain/PortalStudentHeader";
import { DISCIPLINE_CATEGORY_LABEL, DISCIPLINE_ACTION_LABEL, type DisciplineSeverity } from "@/lib/resources/discipline";
import {
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

const SEVERITY_TONE: Record<DisciplineSeverity, "default" | "warning" | "danger"> = {
  MINOR: "default",
  MODERATE: "warning",
  MAJOR: "danger",
};

export default function PortalStudentDisciplinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const { data: student, isLoading, error } = useAsync(() => portalApi.student(id), [id]);
  const { data: disciplineRecords } = useAsync(() => portalApi.disciplineRecords(id), [id]);

  if (isLoading) return <Spinner label="Loading student" />;
  if (error) return <Alert tone="danger">Failed to load student: {error.message}</Alert>;
  if (!student) return null;

  return (
    <div className="flex flex-col gap-4">
      <PortalStudentHeader student={student} />

      <Card>
        <CardHeader>
          <CardTitle>Discipline records</CardTitle>
        </CardHeader>
        <CardContent>
          {!disciplineRecords ? (
            <Spinner label="Loading discipline records" />
          ) : disciplineRecords.length === 0 ? (
            <EmptyState message="No discipline records." />
          ) : (
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Date</TableHeaderCell>
                  <TableHeaderCell>Category</TableHeaderCell>
                  <TableHeaderCell>Severity</TableHeaderCell>
                  <TableHeaderCell>Action taken</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {disciplineRecords.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{new Date(r.incidentDate).toLocaleDateString()}</TableCell>
                    <TableCell>{DISCIPLINE_CATEGORY_LABEL[r.category]}</TableCell>
                    <TableCell>
                      <Badge tone={SEVERITY_TONE[r.severity]}>{r.severity}</Badge>
                    </TableCell>
                    <TableCell>{DISCIPLINE_ACTION_LABEL[r.actionTaken]}</TableCell>
                    <TableCell>
                      <Badge tone={r.resolved ? "success" : "warning"}>{r.resolved ? "Resolved" : "Open"}</Badge>
                    </TableCell>
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
