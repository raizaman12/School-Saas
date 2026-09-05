"use client";

import { use, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useAsync } from "@/lib/hooks/useAsync";
import { platformApi, type TenantStatus } from "@/lib/resources/platform";
import type { TenantPlan } from "@/lib/auth/types";
import { ApiError } from "@/lib/api";
import {
  ConfirmButton,
  Select,
  Badge,
  Alert,
  Spinner,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui";

const STATUS_TONE: Record<TenantStatus, "success" | "default" | "warning" | "danger"> = {
  TRIAL: "default",
  ACTIVE: "success",
  SUSPENDED: "danger",
  CANCELLED: "warning",
};

function UsageRow({
  label,
  used,
  limit,
  withinLimit,
}: {
  label: string;
  used: number;
  limit: number | null;
  withinLimit: boolean;
}) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 py-2 text-sm last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className={`font-medium ${withinLimit ? "text-slate-900" : "text-red-600"}`}>
        {used.toLocaleString()} {limit !== null ? `/ ${limit.toLocaleString()}` : "(unlimited)"}
      </span>
    </div>
  );
}

export default function PlatformTenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: tenant, isLoading, error, refetch } = useAsync(() => platformApi.getTenant(id), [id]);

  const [planChangeError, setPlanChangeError] = useState<string | null>(null);

  const onPlanChange = async (plan: TenantPlan) => {
    setPlanChangeError(null);
    try {
      await platformApi.updateTenantPlan(id, plan);
      refetch();
    } catch (err) {
      setPlanChangeError(err instanceof ApiError ? err.message : "Could not update plan.");
    }
  };

  if (isLoading) return <Spinner label="Loading school" />;
  if (error) return <Alert tone="danger">Failed to load school: {error.message}</Alert>;
  if (!tenant) return null;

  return (
    <div className="flex flex-col gap-4">
      <Link href="/dashboard/platform/tenants" className="flex w-fit items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to schools
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-page-title font-semibold text-slate-900">{tenant.name}</h1>
          <p className="text-sm text-slate-500">{tenant.slug} · {tenant.contactEmail}</p>
        </div>
        <Badge tone={STATUS_TONE[tenant.status]}>{tenant.status}</Badge>
      </div>

      {(!tenant.limits.withinStudentLimit || !tenant.limits.withinStaffLimit) && (
        <Alert tone="warning" title="Over plan limit">
          This school has exceeded its {tenant.planDefinition.name} plan limits. New student or staff creation is
          blocked until they upgrade or you raise their plan.
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Usage vs. plan limits</CardTitle>
          </CardHeader>
          <CardContent>
            <UsageRow
              label="Active students"
              used={tenant.usage.studentCount}
              limit={tenant.planDefinition.maxStudents}
              withinLimit={tenant.limits.withinStudentLimit}
            />
            <UsageRow
              label="Active staff"
              used={tenant.usage.staffCount}
              limit={tenant.planDefinition.maxStaff}
              withinLimit={tenant.limits.withinStaffLimit}
            />
            <UsageRow
              label="SMS/WhatsApp sends this month"
              used={tenant.usage.smsCreditsUsedThisMonth}
              limit={tenant.planDefinition.maxSmsCreditsPerMonth}
              withinLimit={tenant.limits.withinSmsLimit}
            />
            <div className="flex items-center justify-between pt-2 text-sm">
              <span className="text-slate-500">Total user accounts</span>
              <span className="font-medium text-slate-900">{tenant.usage.userCount}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Plan & account</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {planChangeError && <Alert tone="danger">{planChangeError}</Alert>}
            <Select
              label="Subscription plan"
              value={tenant.plan}
              onChange={(e) => onPlanChange(e.target.value as TenantPlan)}
            >
              <option value="TRIAL">Trial</option>
              <option value="BASIC">Basic</option>
              <option value="STANDARD">Standard</option>
              <option value="PREMIUM">Premium</option>
            </Select>
            <p className="text-xs text-slate-500">
              Rs {tenant.planDefinition.priceMonthlyPKR.toLocaleString()}/mo — {tenant.planDefinition.features.join(", ")}
            </p>

            <div className="border-t border-slate-100 pt-4">
              {tenant.status === "SUSPENDED" ? (
                <ConfirmButton
                  triggerLabel="Reactivate school"
                  triggerVariant="outline"
                  confirmLabel="Confirm reactivate"
                  confirmVariant="primary"
                  title="Reactivate this school?"
                  description="Staff and admins at this school will be able to log in again."
                  onConfirm={() => platformApi.updateTenantStatus(id, "ACTIVE").then(() => refetch())}
                />
              ) : (
                <ConfirmButton
                  triggerLabel="Suspend school"
                  triggerVariant="danger"
                  confirmLabel="Confirm suspend"
                  confirmVariant="danger"
                  title="Suspend this school?"
                  description="Staff and admins at this school will immediately be unable to log in."
                  onConfirm={() => platformApi.updateTenantStatus(id, "SUSPENDED").then(() => refetch())}
                />
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
