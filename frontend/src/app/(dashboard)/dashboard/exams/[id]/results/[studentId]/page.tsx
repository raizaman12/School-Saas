"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Save, Check } from "lucide-react";
import { useAsync } from "@/lib/hooks/useAsync";
import { examsApi } from "@/lib/resources/exams";
import { ApiError } from "@/lib/api";
import {
  Button,
  Input,
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

type DraftRow = { marksObtained: string; remarks: string };

/**
 * Admin's "Edit" shortcut from the Generate Result list — every subject
 * this student is examined in for this exam, each independently editable
 * and saved via the same saveMarks(examSubjectId, ...) call a subject
 * teacher would use, so an admin can correct one wrong mark without
 * opening that subject's whole-class roster.
 */
export default function EditStudentResultPage({
  params,
}: {
  params: Promise<{ id: string; studentId: string }>;
}) {
  const { id: examId, studentId } = use(params);
  const {
    data: reportCard,
    isLoading,
    error,
    refetch,
  } = useAsync(() => examsApi.getReportCard(examId, studentId), [examId, studentId]);

  const [drafts, setDrafts] = useState<Record<string, DraftRow>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

  useEffect(() => {
    if (!reportCard) return;
    const initial: Record<string, DraftRow> = {};
    for (const s of reportCard.subjects) {
      initial[s.examSubjectId] = { marksObtained: s.marksObtained !== null ? String(s.marksObtained) : "", remarks: "" };
    }
    setDrafts(initial);
  }, [reportCard]);

  const updateDraft = (examSubjectId: string, field: keyof DraftRow, value: string) => {
    setSavedId(null);
    setDrafts((prev) => ({ ...prev, [examSubjectId]: { ...prev[examSubjectId], [field]: value } }));
  };

  const saveSubject = async (examSubjectId: string) => {
    setSaveError(null);
    setSavingId(examSubjectId);
    try {
      const draft = drafts[examSubjectId];
      await examsApi.saveMarks(examSubjectId, [
        {
          studentId,
          marksObtained: draft.marksObtained === "" ? null : Number(draft.marksObtained),
          remarks: draft.remarks || undefined,
        },
      ]);
      setSavedId(examSubjectId);
      refetch();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Could not save marks.");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Link
        href={`/dashboard/exams/${examId}`}
        className="flex w-fit items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to exam
      </Link>

      {isLoading && <Spinner label="Loading results" />}
      {error && <Alert tone="danger">Failed to load results: {error.message}</Alert>}

      {reportCard && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h1 className="text-page-title font-semibold text-slate-900">Edit results — {reportCard.student.fullName}</h1>
              <p className="text-sm text-slate-500">
                {reportCard.student.studentCode} · {reportCard.exam.name} · {reportCard.exam.academicYear}
              </p>
            </div>
            {reportCard.summary.rank !== null && (
              <Badge tone="info">
                Position {reportCard.summary.rank} of {reportCard.summary.totalRanked}
              </Badge>
            )}
          </div>

          {saveError && <Alert tone="danger">{saveError}</Alert>}

          <Card>
            <CardHeader>
              <CardTitle>Subjects</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>Subject</TableHeaderCell>
                    <TableHeaderCell>Marks obtained</TableHeaderCell>
                    <TableHeaderCell>Remarks</TableHeaderCell>
                    <TableHeaderCell></TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {reportCard.subjects.map((s) => {
                    const draft = drafts[s.examSubjectId] ?? { marksObtained: "", remarks: "" };
                    return (
                      <TableRow key={s.examSubjectId}>
                        <TableCell>{s.subject}</TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min={0}
                            max={s.maxMarks}
                            value={draft.marksObtained}
                            onChange={(e) => updateDraft(s.examSubjectId, "marksObtained", e.target.value)}
                            className="w-24"
                            aria-label={`Marks for ${s.subject}`}
                          />
                          <span className="ml-1 text-xs text-slate-400">/ {s.maxMarks}</span>
                        </TableCell>
                        <TableCell>
                          <Input
                            value={draft.remarks}
                            onChange={(e) => updateDraft(s.examSubjectId, "remarks", e.target.value)}
                            className="w-full max-w-xs"
                            aria-label={`Remarks for ${s.subject}`}
                          />
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="outline"
                            isLoading={savingId === s.examSubjectId}
                            onClick={() => saveSubject(s.examSubjectId)}
                          >
                            {savedId === s.examSubjectId ? (
                              <Check className="size-4" aria-hidden="true" />
                            ) : (
                              <Save className="size-4" aria-hidden="true" />
                            )}
                            Save
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
