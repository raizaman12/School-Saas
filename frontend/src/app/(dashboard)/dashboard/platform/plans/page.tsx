"use client";

import { Check } from "lucide-react";
import { useAsync } from "@/lib/hooks/useAsync";
import { platformApi } from "@/lib/resources/platform";
import { Alert, Spinner, Card, CardHeader, CardTitle, CardContent } from "@/components/ui";

export default function PlatformPlansPage() {
  const { data: plans, isLoading, error } = useAsync(() => platformApi.listPlans(), []);

  if (isLoading) return <Spinner label="Loading plans" />;
  if (error) return <Alert tone="danger">Failed to load plans: {error.message}</Alert>;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-page-title font-semibold text-slate-900">Subscription plans</h1>
      <p className="text-sm text-slate-500">
        The current tier catalog. Limits are enforced live — student/staff creation is blocked once a school hits
        its plan&apos;s limit, and SMS/WhatsApp sends are blocked once its monthly credit is used up.
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {plans?.map((plan) => (
          <Card key={plan.code}>
            <CardHeader>
              <CardTitle>{plan.name}</CardTitle>
              <p className="text-2xl font-semibold text-slate-900">
                {plan.priceMonthlyPKR === 0 ? "Free" : `Rs ${plan.priceMonthlyPKR.toLocaleString()}`}
                {plan.priceMonthlyPKR > 0 && <span className="text-sm font-normal text-slate-500">/mo</span>}
              </p>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <dl className="flex flex-col gap-1.5 text-sm">
                <div className="flex justify-between">
                  <dt className="text-slate-500">Students</dt>
                  <dd className="font-medium text-slate-900">{plan.maxStudents === null ? "Unlimited" : plan.maxStudents.toLocaleString()}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Staff</dt>
                  <dd className="font-medium text-slate-900">{plan.maxStaff === null ? "Unlimited" : plan.maxStaff.toLocaleString()}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">SMS/WhatsApp</dt>
                  <dd className="font-medium text-slate-900">
                    {plan.maxSmsCreditsPerMonth === null
                      ? "Unlimited"
                      : plan.maxSmsCreditsPerMonth === 0
                        ? "Not included"
                        : `${plan.maxSmsCreditsPerMonth.toLocaleString()}/mo`}
                  </dd>
                </div>
              </dl>
              <ul className="flex flex-col gap-1.5 border-t border-slate-100 pt-3 text-sm text-slate-600">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-1.5">
                    <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
                    {feature}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
