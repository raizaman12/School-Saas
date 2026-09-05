"use client";

import Link from "next/link";
import { useAsync } from "@/lib/hooks/useAsync";
import { platformApi } from "@/lib/resources/platform";
import { Alert, Spinner, Card, CardHeader, CardTitle, CardContent, Badge } from "@/components/ui";

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 pt-5">
        <span className="text-sm text-slate-500">{label}</span>
        <span className="text-2xl font-semibold text-slate-900">{value}</span>
      </CardContent>
    </Card>
  );
}

export default function PlatformOverviewPage() {
  const { data: stats, isLoading, error } = useAsync(() => platformApi.stats(), []);

  if (isLoading) return <Spinner label="Loading overview" />;
  if (error) return <Alert tone="danger">Failed to load overview: {error.message}</Alert>;
  if (!stats) return null;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-page-title font-semibold text-slate-900">Platform overview</h1>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total schools" value={stats.totalTenants} />
        <StatCard label="Active" value={stats.byStatus.ACTIVE ?? 0} />
        <StatCard label="New signups (7d)" value={stats.newSignups.last7Days} />
        <StatCard label="New signups (30d)" value={stats.newSignups.last30Days} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Schools by plan</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {(["TRIAL", "BASIC", "STANDARD", "PREMIUM"] as const).map((plan) => (
              <div key={plan} className="flex items-center justify-between text-sm">
                <span className="text-slate-500">{plan}</span>
                <span className="font-medium text-slate-900">{stats.byPlan[plan] ?? 0}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Schools by status</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {(["TRIAL", "ACTIVE", "SUSPENDED", "CANCELLED"] as const).map((status) => (
              <div key={status} className="flex items-center justify-between text-sm">
                <span className="text-slate-500">{status}</span>
                <span className="font-medium text-slate-900">{stats.byStatus[status] ?? 0}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Most recent signups</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col divide-y divide-slate-100">
          {stats.recentSignups.length === 0 && <p className="py-2 text-sm text-slate-500">No signups yet.</p>}
          {stats.recentSignups.map((tenant) => (
            <Link
              key={tenant.id}
              href={`/dashboard/platform/tenants/${tenant.id}`}
              className="flex items-center justify-between gap-3 py-2.5 text-sm hover:bg-slate-50"
            >
              <div>
                <span className="font-medium text-slate-900">{tenant.name}</span>
                <span className="ml-2 text-slate-400">{tenant.slug}</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone="default">{tenant.plan}</Badge>
                <span className="text-slate-400">{new Date(tenant.createdAt).toLocaleDateString()}</span>
              </div>
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
