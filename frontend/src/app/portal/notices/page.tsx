"use client";

import { useState } from "react";
import { Pin, Megaphone } from "lucide-react";
import { useAsync } from "@/lib/hooks/useAsync";
import { portalApi } from "@/lib/resources/portal";
import type { NoticeTone } from "@/lib/resources/notices";
import { Alert, Badge, Button, Card, CardContent, Spinner, EmptyState } from "@/components/ui";

const TONE_LABEL: Record<NoticeTone, string> = {
  GENERAL: "General",
  IMPORTANT: "Important",
  URGENT: "Urgent",
  EVENT: "Event",
  HOLIDAY: "Holiday",
};

const TONE_BADGE: Record<NoticeTone, "default" | "info" | "danger" | "success" | "warning"> = {
  GENERAL: "default",
  IMPORTANT: "info",
  URGENT: "danger",
  EVENT: "success",
  HOLIDAY: "warning",
};

/** The Notice Board a STUDENT or PARENT sees: school-wide notices for their
 * role, their (child's) section notices, and anything addressed to them
 * individually — see backend `GET /api/portal/notices` for the exact rules. */
export default function PortalNoticesPage() {
  const [page, setPage] = useState(1);
  const { data, isLoading, error } = useAsync(() => portalApi.notices({ page, limit: 20 }), [page]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-page-title font-semibold text-slate-900">Notice Board</h1>
        <p className="text-sm text-slate-500">Announcements from the school, your section, and anything addressed to you.</p>
      </div>

      {isLoading && <Spinner label="Loading notices" />}
      {error && <Alert tone="danger">Failed to load notices: {error.message}</Alert>}

      {data && (
        <>
          {data.data.length === 0 ? (
            <EmptyState message="No notices right now." />
          ) : (
            <div className="flex flex-col gap-3">
              {data.data.map((notice) => (
                <Card key={notice.id}>
                  <CardContent className="flex flex-col gap-1.5 pt-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 font-semibold text-slate-900">
                        {notice.isPinned && <Pin className="size-4 text-primary-600" aria-hidden="true" />}
                        {notice.title}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={TONE_BADGE[notice.tone]}>{TONE_LABEL[notice.tone]}</Badge>
                        {notice.audiences.includes("INDIVIDUAL") && (
                          <Badge tone="info" className="flex items-center gap-1">
                            <Megaphone className="size-3" aria-hidden="true" />
                            For you
                          </Badge>
                        )}
                        {notice.audiences.includes("SECTION") && notice.section && (
                          <Badge tone="default">
                            {notice.section.schoolClass.name} - {notice.section.name}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <p className="text-sm text-slate-700">{notice.body}</p>
                    <p className="text-xs text-slate-500">
                      {notice.publishedByUser.fullName} · {new Date(notice.publishedAt).toLocaleDateString()}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between text-sm text-slate-500">
            <span>
              Page {data.meta.page} of {data.meta.totalPages} — {data.meta.total} total
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= data.meta.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
