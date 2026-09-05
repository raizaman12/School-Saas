"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarOff } from "lucide-react";
import { useAsync } from "@/lib/hooks/useAsync";
import { portalApi } from "@/lib/resources/portal";
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle, Spinner, EmptyState } from "@/components/ui";

export default function PortalHomePage() {
  const router = useRouter();
  const { data: me, isLoading, error } = useAsync(() => portalApi.me(), []);
  const { data: today } = useAsync(() => portalApi.today(), []);

  useEffect(() => {
    if (me?.role === "STUDENT") {
      router.replace(`/portal/students/${me.student.id}`);
    }
  }, [me, router]);

  if (isLoading || me?.role === "STUDENT") return <Spinner label="Loading your portal" />;
  if (error) return <Alert tone="danger">Could not load your portal profile: {error.message}</Alert>;
  if (!me) return null;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-page-title font-semibold text-slate-900">Welcome, {me.guardian.fullName.split(" ")[0]}</h1>
        <p className="text-sm text-slate-500">Select a child to view their attendance, fees and exam results.</p>
      </div>

      {today?.isNonWorkingDay && (
        <Alert tone="warning" title="No class today">
          <span className="inline-flex items-center gap-1.5">
            <CalendarOff className="size-4" aria-hidden="true" />
            {today.reason === "WEEKLY_OFF" ? `Weekly off — ${today.label}` : today.label}.
          </span>
        </Alert>
      )}

      {me.children.length === 0 ? (
        <EmptyState message="No children are linked to your account yet. Contact the school office." />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {me.children.map((child) => (
            <Link key={child.id} href={`/portal/students/${child.id}`}>
              <Card className="h-full transition-shadow hover:shadow-md">
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <CardTitle>{child.fullName}</CardTitle>
                  {child.isPrimary && <Badge tone="info">Primary</Badge>}
                </CardHeader>
                <CardContent className="pt-0 text-sm text-slate-500">
                  <p>{child.studentCode}</p>
                  <p>
                    {child.currentSection
                      ? `${child.currentSection.schoolClass.name} - ${child.currentSection.name}`
                      : "Not enrolled"}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
