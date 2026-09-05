"use client";

import { use } from "react";
import { useAsync } from "@/lib/hooks/useAsync";
import { portalApi } from "@/lib/resources/portal";
import { PortalStudentHeader } from "@/components/domain/PortalStudentHeader";
import {
  SUPPORT_NEED_CATEGORY_LABEL,
  SUPPORT_NEED_STATUS_LABEL,
  type SupportNeedStatus,
} from "@/lib/resources/supportNeeds";
import { Badge, Alert, Spinner, Card, CardHeader, CardTitle, CardContent, EmptyState } from "@/components/ui";

const SUPPORT_NEED_STATUS_TONE: Record<SupportNeedStatus, "default" | "warning" | "success" | "danger"> = {
  ACTIVE: "default",
  UNDER_REVIEW: "warning",
  RESOLVED: "success",
  DISCONTINUED: "danger",
};

export default function PortalStudentSupportNeedsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const { data: student, isLoading, error } = useAsync(() => portalApi.student(id), [id]);
  const { data: supportNeeds } = useAsync(() => portalApi.supportNeeds(id), [id]);

  if (isLoading) return <Spinner label="Loading student" />;
  if (error) return <Alert tone="danger">Failed to load student: {error.message}</Alert>;
  if (!student) return null;

  return (
    <div className="flex flex-col gap-4">
      <PortalStudentHeader student={student} />

      <Card>
        <CardHeader>
          <CardTitle>Learning support plans</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {!supportNeeds ? (
            <Spinner label="Loading learning support plans" />
          ) : supportNeeds.length === 0 ? (
            <EmptyState message="No learning support plans." />
          ) : (
            supportNeeds.map((sn) => (
              <div key={sn.id} className="rounded-lg border border-slate-200 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="font-medium text-slate-900">{SUPPORT_NEED_CATEGORY_LABEL[sn.category]}</p>
                  <Badge tone={SUPPORT_NEED_STATUS_TONE[sn.status]}>{SUPPORT_NEED_STATUS_LABEL[sn.status]}</Badge>
                </div>
                <p className="mt-2 text-sm text-slate-700">{sn.description}</p>
                <p className="mt-1 text-sm text-slate-500">
                  <span className="font-medium text-slate-700">Support provided: </span>
                  {sn.supportProvided}
                </p>
                {sn.examAccommodations && (
                  <p className="mt-1 text-sm text-slate-500">
                    <span className="font-medium text-slate-700">Exam accommodations: </span>
                    {sn.examAccommodations}
                  </p>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
