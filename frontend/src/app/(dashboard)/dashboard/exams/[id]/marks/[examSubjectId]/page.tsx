"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Save } from "lucide-react";
import { useAsync } from "@/lib/hooks/useAsync";
import { examsApi, type MarkRosterEntry } from "@/lib/resources/exams";
import { ApiError } from "@/lib/api";
import {
  Button,
  Input,
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

type DraftRow = { marksObtained: string; remarks: string };

export default function MarksEntryPage({
  params,
}: {
  params: Promise<{ id: string; examSubjectId: string }>;
}) {
  const { id: examId, examSubjectId } = use(params);
  const { data: roster, isLoading, error } = useAsync(() => examsApi.getRoster(examSubjectId), [examSubjectId]);

  const [drafts, setDrafts] = useState<Record<string, DraftRow>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!roster) return;
    const initial: Record<string, DraftRow> = {};
    for (const r of roster) {
      initial[r.studentId] = {
        marksObtained: r.marksObtained !== null ? String(r.marksObtained) : "",
        remarks: r.remarks ?? "",
      };
    }
    setDrafts(initial);
  }, [roster]);

  const updateDraft = (studentId: string, field: keyof DraftRow, value: string) => {
    setSaved(false);
    setDrafts((prev) => ({ ...prev, [studentId]: { ...prev[studentId], [field]: value } }));
  };

  const handleSave = async () => {
    setSaveError(null);
    setIsSaving(true);
    try {
      const records = Object.entries(drafts).map(([studentId, draft]) => ({
        studentId,
        marksObtained: draft.marksObtained === "" ? null : Number(draft.marksObtained),
        remarks: draft.remarks || undefined,
      }));
      await examsApi.saveMarks(examSubjectId, records);
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Could not save marks.");
    } finally {
      setIsSaving(false);
    }
  };

  const rowTone = (entry: MarkRosterEntry, obtained: string) => {
    if (obtained === "") return undefined;
    const n = Number(obtained);
    return n < entry.passingMarks ? "bg-red-50/60" : undefined;
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

      <h1 className="text-page-title font-semibold text-slate-900">Enter marks</h1>

      {isLoading && <Spinner label="Loading roster" />}
      {error && <p className="text-sm text-red-600">Failed to load roster: {error.message}</p>}

      {roster && (
        <>
          {saveError && <Alert tone="danger">{saveError}</Alert>}
          {saved && <Alert tone="success">Marks saved.</Alert>}

          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Admission code</TableHeaderCell>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>Marks obtained</TableHeaderCell>
                <TableHeaderCell>Remarks</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {roster.map((entry) => {
                const draft = drafts[entry.studentId] ?? { marksObtained: "", remarks: "" };
                return (
                  <TableRow key={entry.studentId} className={rowTone(entry, draft.marksObtained)}>
                    <TableCell>{entry.studentCode}</TableCell>
                    <TableCell>{entry.fullName}</TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={0}
                        max={entry.maxMarks}
                        value={draft.marksObtained}
                        onChange={(e) => updateDraft(entry.studentId, "marksObtained", e.target.value)}
                        className="w-24"
                        aria-label={`Marks for ${entry.fullName}`}
                      />
                      <span className="ml-1 text-xs text-slate-400">/ {entry.maxMarks}</span>
                    </TableCell>
                    <TableCell>
                      <Input
                        value={draft.remarks}
                        onChange={(e) => updateDraft(entry.studentId, "remarks", e.target.value)}
                        className="w-full max-w-xs"
                        aria-label={`Remarks for ${entry.fullName}`}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {roster.length === 0 && <EmptyState message="No active students enrolled in this section." />}

          {roster.length > 0 && (
            <div className="flex justify-end">
              <Button onClick={handleSave} isLoading={isSaving}>
                <Save className="size-4" aria-hidden="true" />
                Save marks
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
