"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Save } from "lucide-react";
import { useAsync } from "@/lib/hooks/useAsync";
import { classTestsApi, type ClassTestRosterEntry } from "@/lib/resources/classTests";
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

/**
 * A teacher's own class-test marks-entry roster — mirrors the formal exam's
 * marks-entry page (dashboard/exams/[id]/marks/[examSubjectId]) exactly,
 * since the whole point is a teacher can enter marks for their own quick
 * test the same familiar way, just without an admin needing to build a
 * datesheet or add subjects first.
 */
export default function ClassTestMarksEntryPage({
  params,
}: {
  params: Promise<{ sectionSubjectId: string; classTestId: string }>;
}) {
  const { sectionSubjectId, classTestId } = use(params);
  const { data, isLoading, error } = useAsync(() => classTestsApi.getRoster(classTestId), [classTestId]);

  const [drafts, setDrafts] = useState<Record<string, DraftRow>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!data) return;
    const initial: Record<string, DraftRow> = {};
    for (const r of data.roster) {
      initial[r.studentId] = {
        marksObtained: r.marksObtained !== null ? String(r.marksObtained) : "",
        remarks: r.remarks ?? "",
      };
    }
    setDrafts(initial);
  }, [data]);

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
      await classTestsApi.saveMarks(classTestId, records);
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Could not save marks.");
    } finally {
      setIsSaving(false);
    }
  };

  const rowTone = (entry: ClassTestRosterEntry, obtained: string) => {
    if (obtained === "") return undefined;
    const n = Number(obtained);
    return n < entry.passingMarks ? "bg-red-50/60" : undefined;
  };

  return (
    <div className="flex flex-col gap-4">
      <Link
        href={`/dashboard/academics/courses/${sectionSubjectId}`}
        className="flex w-fit items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to course
      </Link>

      <h1 className="text-page-title font-semibold text-slate-900">
        {data ? `Enter marks — ${data.classTest.name}` : "Enter marks"}
      </h1>

      {isLoading && <Spinner label="Loading roster" />}
      {error && <p className="text-sm text-red-600">Failed to load roster: {error.message}</p>}

      {data && (
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
              {data.roster.map((entry) => {
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
          {data.roster.length === 0 && <EmptyState message="No active students enrolled in this section." />}

          {data.roster.length > 0 && (
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
