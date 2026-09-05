"use client";

import { useAsync } from "@/lib/hooks/useAsync";
import { analyticsApi } from "@/lib/resources/analytics";
import { Card, CardHeader, CardTitle, CardContent, Spinner, EmptyState } from "@/components/ui";

function KpiCard({ label, value, sublabel }: { label: string; value: string; sublabel?: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 py-5">
        <p className="text-sm text-slate-500">{label}</p>
        <p className="text-2xl font-semibold text-slate-900">{value}</p>
        {sublabel && <p className="text-xs text-slate-400">{sublabel}</p>}
      </CardContent>
    </Card>
  );
}

/**
 * A small dependency-free vertical bar chart. Every other page in this
 * app is built from plain Tailwind + the shared ui/ primitives with no
 * charting library, so this keeps that same footprint rather than
 * pulling in a new npm dependency for what's fundamentally "a row of
 * divs with proportional heights".
 */
function BarChart({
  items,
  formatValue = (n: number) => String(n),
  barColor = "bg-primary-500",
}: {
  items: { label: string; value: number }[];
  formatValue?: (n: number) => string;
  barColor?: string;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="flex items-end gap-3 overflow-x-auto pb-2" style={{ minHeight: 160 }}>
      {items.map((item) => (
        <div key={item.label} className="flex min-w-[3rem] flex-1 flex-col items-center gap-1">
          <span className="text-xs font-medium text-slate-700">{formatValue(item.value)}</span>
          <div className="flex h-28 w-full items-end">
            <div
              className={`w-full rounded-t-md ${barColor}`}
              style={{ height: `${Math.max(2, (item.value / max) * 100)}%` }}
            />
          </div>
          <span className="max-w-[4.5rem] truncate text-center text-xs text-slate-500" title={item.label}>
            {item.label}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Two side-by-side bars per category (e.g. billed vs collected) with a small legend. */
function DualBarChart({
  items,
  aLabel,
  bLabel,
  formatValue = (n: number) => String(n),
}: {
  items: { label: string; a: number; b: number }[];
  aLabel: string;
  bLabel: string;
  formatValue?: (n: number) => string;
}) {
  const max = Math.max(1, ...items.flatMap((i) => [i.a, i.b]));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-primary-500" /> {aLabel}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-slate-300" /> {bLabel}
        </span>
      </div>
      <div className="flex items-end gap-3 overflow-x-auto pb-2" style={{ minHeight: 160 }}>
        {items.map((item) => (
          <div key={item.label} className="flex min-w-[3.5rem] flex-1 flex-col items-center gap-1">
            <div className="flex h-28 w-full items-end justify-center gap-1">
              <div
                className="w-2/5 rounded-t-md bg-primary-500"
                style={{ height: `${Math.max(2, (item.a / max) * 100)}%` }}
                title={`${aLabel}: ${formatValue(item.a)}`}
              />
              <div
                className="w-2/5 rounded-t-md bg-slate-300"
                style={{ height: `${Math.max(2, (item.b / max) * 100)}%` }}
                title={`${bLabel}: ${formatValue(item.b)}`}
              />
            </div>
            <span className="max-w-[4.5rem] truncate text-center text-xs text-slate-500" title={item.label}>
              {item.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChartCard({
  title,
  data,
  isLoading,
  emptyMessage,
  children,
}: {
  title: string;
  data: unknown[] | null | undefined;
  isLoading: boolean;
  emptyMessage: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && <Spinner label={`Loading ${title.toLowerCase()}`} />}
        {!isLoading && (!data || data.length === 0) && <EmptyState message={emptyMessage} />}
        {!isLoading && data && data.length > 0 && children}
      </CardContent>
    </Card>
  );
}

export default function AnalyticsPage() {
  const { data: overview, isLoading: overviewLoading } = useAsync(() => analyticsApi.overview(), []);
  const { data: enrollment, isLoading: enrollmentLoading } = useAsync(
    () => analyticsApi.enrollmentByClass(),
    [],
  );
  const { data: attendanceTrend, isLoading: attendanceLoading } = useAsync(
    () => analyticsApi.attendanceTrend(6),
    [],
  );
  const { data: feeTrend, isLoading: feeLoading } = useAsync(() => analyticsApi.feeCollectionTrend(6), []);
  const { data: examPerformance, isLoading: examLoading } = useAsync(() => analyticsApi.examPerformance(6), []);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-page-title font-semibold text-slate-900">Analytics</h1>
        <p className="text-sm text-slate-500">A quick school-wide snapshot — enrollment, attendance, fees, and exam performance.</p>
      </div>

      {overviewLoading && <Spinner label="Loading overview" />}
      {overview && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <KpiCard label="Active students" value={String(overview.activeStudents)} />
          <KpiCard label="Staff" value={String(overview.totalStaff)} />
          <KpiCard
            label="Attendance (30 days)"
            value={overview.attendanceRateLast30Days !== null ? `${overview.attendanceRateLast30Days}%` : "—"}
          />
          <KpiCard
            label="Fee collection"
            value={overview.feeCollectionRateActiveYear !== null ? `${overview.feeCollectionRateActiveYear}%` : "—"}
            sublabel={overview.activeAcademicYear ?? undefined}
          />
          <KpiCard
            label="Latest exam avg."
            value={overview.latestExam?.averagePercentage !== null && overview.latestExam ? `${overview.latestExam.averagePercentage}%` : "—"}
            sublabel={overview.latestExam?.name}
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard
          title="Enrollment by class"
          data={enrollment}
          isLoading={enrollmentLoading}
          emptyMessage="No active, enrolled students yet."
        >
          <BarChart items={(enrollment ?? []).map((r) => ({ label: r.className, value: r.count }))} />
        </ChartCard>

        <ChartCard
          title="Attendance trend (6 months)"
          data={attendanceTrend?.filter((p) => p.totalMarked > 0)}
          isLoading={attendanceLoading}
          emptyMessage="No attendance has been marked in the last 6 months."
        >
          <BarChart
            items={(attendanceTrend ?? []).map((p) => ({
              label: p.label,
              value: p.attendanceRate ?? 0,
            }))}
            formatValue={(n) => `${n}%`}
          />
        </ChartCard>

        <ChartCard
          title="Fee collection trend (6 months)"
          data={feeTrend?.filter((p) => p.billed > 0)}
          isLoading={feeLoading}
          emptyMessage="No invoices have been billed in the last 6 months."
        >
          <DualBarChart
            items={(feeTrend ?? []).map((p) => ({ label: p.label, a: p.collected, b: p.billed }))}
            aLabel="Collected"
            bLabel="Billed"
            formatValue={(n) => `Rs ${n.toLocaleString()}`}
          />
        </ChartCard>

        <ChartCard
          title="Exam performance"
          data={examPerformance?.filter((p) => p.averagePercentage !== null)}
          isLoading={examLoading}
          emptyMessage="No graded exams yet."
        >
          <BarChart
            items={(examPerformance ?? [])
              .filter((p) => p.averagePercentage !== null)
              .map((p) => ({ label: p.examName, value: p.averagePercentage ?? 0 }))}
            formatValue={(n) => `${n}%`}
            barColor="bg-emerald-500"
          />
        </ChartCard>
      </div>
    </div>
  );
}
