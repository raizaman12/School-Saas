"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { useAsync } from "@/lib/hooks/useAsync";
import { examsApi } from "@/lib/resources/exams";
import { ApiError } from "@/lib/api";
import { Button, Input, Alert, Spinner, Card, CardContent } from "@/components/ui";

type DraftBand = { grade: string; minPercentage: string };

export default function GradingBandsPage() {
  const { data: bands, isLoading, refetch } = useAsync(() => examsApi.listGradingBands(), []);
  const [drafts, setDrafts] = useState<DraftBand[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!bands) return;
    setDrafts(
      bands.length > 0
        ? bands.map((b) => ({ grade: b.grade, minPercentage: b.minPercentage }))
        : [
            { grade: "A+", minPercentage: "90" },
            { grade: "A", minPercentage: "80" },
            { grade: "B", minPercentage: "70" },
            { grade: "C", minPercentage: "60" },
            { grade: "D", minPercentage: "50" },
            { grade: "F", minPercentage: "0" },
          ],
    );
  }, [bands]);

  const updateDraft = (index: number, field: keyof DraftBand, value: string) => {
    setSaved(false);
    setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, [field]: value } : d)));
  };

  const addRow = () => setDrafts((prev) => [...prev, { grade: "", minPercentage: "" }]);
  const removeRow = (index: number) => setDrafts((prev) => prev.filter((_, i) => i !== index));

  const handleSave = async () => {
    setError(null);
    setIsSaving(true);
    try {
      await examsApi.replaceGradingBands(
        drafts.map((d) => ({ grade: d.grade.trim(), minPercentage: Number(d.minPercentage) })),
      );
      setSaved(true);
      refetch();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save grading scale.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Link href="/dashboard/exams" className="flex w-fit items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to exams
      </Link>

      <h1 className="text-page-title font-semibold text-slate-900">Grading scale</h1>
      <p className="text-sm text-slate-500">
        Define the grade bands used on report cards, from the minimum percentage required for each grade.
      </p>

      {isLoading && <Spinner label="Loading grading scale" />}

      {!isLoading && (
        <Card>
          <CardContent className="flex flex-col gap-4">
            {error && <Alert tone="danger">{error}</Alert>}
            {saved && <Alert tone="success">Grading scale saved.</Alert>}

            <div className="flex flex-col gap-2">
              {drafts.map((d, i) => (
                <div key={i} className="flex items-end gap-2">
                  <Input
                    label={i === 0 ? "Grade" : undefined}
                    value={d.grade}
                    onChange={(e) => updateDraft(i, "grade", e.target.value)}
                    className="w-24"
                  />
                  <Input
                    label={i === 0 ? "Minimum %" : undefined}
                    type="number"
                    min={0}
                    max={100}
                    value={d.minPercentage}
                    onChange={(e) => updateDraft(i, "minPercentage", e.target.value)}
                    className="w-28"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeRow(i)}
                    aria-label={`Remove ${d.grade || "row"}`}
                  >
                    <Trash2 className="size-4 text-red-600" aria-hidden="true" />
                  </Button>
                </div>
              ))}
            </div>

            <div className="flex justify-between">
              <Button type="button" variant="outline" size="sm" onClick={addRow}>
                <Plus className="size-4" aria-hidden="true" />
                Add grade
              </Button>
              <Button type="button" onClick={handleSave} isLoading={isSaving}>
                Save grading scale
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
