"use client";

import { useEffect, useState } from "react";
import { Save, Check, CalendarOff } from "lucide-react";
import { attendanceApi, type AttendanceStatus, type RosterResult } from "@/lib/resources/attendance";
import { ApiError } from "@/lib/api";
import { SectionCascadeSelect } from "@/components/domain/SectionCascadeSelect";
import { Button, Input, Alert, Spinner, Card, CardContent, EmptyState } from "@/components/ui";
import { cn } from "@/lib/utils";

const STATUS_OPTIONS: { value: AttendanceStatus; label: string; tone: string }[] = [
  { value: "PRESENT", label: "P", tone: "bg-emerald-100 text-emerald-800 border-emerald-300" },
  { value: "ABSENT", label: "A", tone: "bg-red-100 text-red-800 border-red-300" },
  { value: "LATE", label: "L", tone: "bg-amber-100 text-amber-800 border-amber-300" },
  { value: "LEAVE", label: "Lv", tone: "bg-primary-100 text-primary-800 border-primary-300" },
  { value: "HALF_DAY", label: "HD", tone: "bg-slate-200 text-slate-800 border-slate-400" },
  { value: "EARLY_LEAVE", label: "EL", tone: "bg-fuchsia-100 text-fuchsia-800 border-fuchsia-300" },
];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function AttendancePage() {
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [date, setDate] = useState(todayIso());
  const [roster, setRoster] = useState<Record<string, AttendanceStatus | null>>({});
  const [rosterOrder, setRosterOrder] = useState<{ studentId: string; studentCode: string; fullName: string }[]>([]);
  const [holiday, setHoliday] = useState<RosterResult["holiday"]>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  useEffect(() => {
    if (!sectionId) return;
    setIsLoading(true);
    setError(null);
    setSavedAt(null);
    attendanceApi
      .roster(sectionId, date)
      .then(({ holiday, roster: entries }) => {
        setHoliday(holiday);
        setRosterOrder(entries.map((e) => ({ studentId: e.studentId, studentCode: e.studentCode, fullName: e.fullName })));
        setRoster(Object.fromEntries(entries.map((e) => [e.studentId, e.status])));
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load roster."))
      .finally(() => setIsLoading(false));
  }, [sectionId, date]);

  const setStatus = (studentId: string, status: AttendanceStatus) => {
    setRoster((prev) => ({ ...prev, [studentId]: status }));
  };

  const markAllPresent = () => {
    setRoster((prev) => {
      const next = { ...prev };
      for (const s of rosterOrder) next[s.studentId] = "PRESENT";
      return next;
    });
  };

  const counts = STATUS_OPTIONS.reduce<Record<string, number>>((acc, opt) => {
    acc[opt.value] = Object.values(roster).filter((v) => v === opt.value).length;
    return acc;
  }, {});
  const unmarkedCount = rosterOrder.length - Object.values(roster).filter(Boolean).length;

  const handleSave = async () => {
    if (!sectionId) return;
    const records = rosterOrder
      .filter((s) => roster[s.studentId])
      .map((s) => ({ studentId: s.studentId, status: roster[s.studentId]! }));
    if (records.length === 0) return;

    setIsSaving(true);
    setError(null);
    try {
      await attendanceApi.mark({ sectionId, date, records });
      setSavedAt(new Date());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save attendance.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-page-title font-semibold text-slate-900">Attendance</h1>

      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="flex-1">
              <SectionCascadeSelect onChange={(v) => setSectionId(v?.sectionId ?? null)} />
            </div>
            <Input
              label="Date"
              type="date"
              value={date}
              max={todayIso()}
              onChange={(e) => setDate(e.target.value)}
              className="sm:w-44"
            />
          </div>

          {error && <Alert tone="danger">{error}</Alert>}
          {savedAt && (
            <Alert tone="success">
              <span className="inline-flex items-center gap-1.5">
                <Check className="size-4" aria-hidden="true" /> Attendance saved for {date}.
              </span>
            </Alert>
          )}

          {!sectionId && <EmptyState message="Pick an academic year and section to mark attendance." />}
          {sectionId && isLoading && <Spinner label="Loading roster" />}

          {sectionId && !isLoading && holiday && (
            <Alert tone="warning" title="No class on this date">
              <span className="inline-flex items-center gap-1.5">
                <CalendarOff className="size-4" aria-hidden="true" />
                {holiday.reason === "WEEKLY_OFF" ? `Weekly off — ${holiday.label}` : holiday.label}. Attendance
                cannot be marked for this date.
              </span>
            </Alert>
          )}

          {sectionId && !isLoading && !holiday && rosterOrder.length > 0 && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 px-4 py-2 text-sm text-slate-600">
                <div className="flex flex-wrap gap-4">
                  {STATUS_OPTIONS.map((opt) => (
                    <span key={opt.value}>
                      {opt.label}: <span className="font-semibold text-slate-900">{counts[opt.value] ?? 0}</span>
                    </span>
                  ))}
                  <span>
                    Unmarked: <span className="font-semibold text-slate-900">{unmarkedCount}</span>
                  </span>
                </div>
                <Button variant="ghost" size="sm" onClick={markAllPresent}>
                  Mark all present
                </Button>
              </div>

              <div className="overflow-hidden rounded-lg border border-slate-200">
                <table className="w-full border-collapse text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                        #
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Student
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Mark
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rosterOrder.map((s, idx) => (
                      <tr key={s.studentId} className="hover:bg-slate-50/60">
                        <td className="px-4 py-2 text-slate-400">{idx + 1}</td>
                        <td className="px-4 py-2">
                          <div className="font-medium text-slate-900">{s.fullName}</div>
                          <div className="text-xs text-slate-400">{s.studentCode}</div>
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex gap-2" role="group" aria-label={`Attendance status for ${s.fullName}`}>
                            {STATUS_OPTIONS.map((opt) => {
                              const isSelected = roster[s.studentId] === opt.value;
                              return (
                                <button
                                  key={opt.value}
                                  type="button"
                                  aria-pressed={isSelected}
                                  onClick={() => setStatus(s.studentId, opt.value)}
                                  className={cn(
                                    "focus-ring flex size-11 items-center justify-center rounded-md border text-xs font-semibold transition-colors",
                                    isSelected ? opt.tone : "border-slate-200 bg-white text-slate-400 hover:bg-slate-50",
                                  )}
                                >
                                  {opt.label}
                                </button>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end">
                <Button onClick={handleSave} isLoading={isSaving}>
                  <Save className="size-4" aria-hidden="true" />
                  Save attendance
                </Button>
              </div>
            </>
          )}

          {sectionId && !isLoading && !holiday && rosterOrder.length === 0 && (
            <EmptyState message="No active students in this section." />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
