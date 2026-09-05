"use client";

import { use, useMemo } from "react";
import { useAsync } from "@/lib/hooks/useAsync";
import { portalApi } from "@/lib/resources/portal";
import { PortalStudentHeader } from "@/components/domain/PortalStudentHeader";
import { WeeklyTimetableGrid, type TimetableBlock } from "@/components/domain/WeeklyTimetableGrid";
import { Alert, Spinner, EmptyState } from "@/components/ui";

/**
 * A student's/parent's own weekly timetable — same WeeklyTimetableGrid the
 * teacher dashboard uses (see dashboard/timetable/page.tsx), but title and
 * subtitle flipped: a student wants to know WHO teaches a slot (the
 * teacher's name), not their own subject list, which they already see on
 * the Overview page's course cards.
 */
export default function PortalStudentTimetablePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const { data: student, isLoading, error } = useAsync(() => portalApi.student(id), [id]);
  const { data: timetableSlots } = useAsync(() => portalApi.timetable(id), [id]);

  const timetableBlocks: TimetableBlock[] = useMemo(
    () =>
      (timetableSlots ?? []).map((slot) => ({
        id: slot.id,
        dayOfWeek: slot.dayOfWeek,
        startTime: slot.startTime,
        endTime: slot.endTime,
        title: slot.sectionSubject.subject.name,
        subtitle: slot.sectionSubject.teacher ? slot.sectionSubject.teacher.fullName : "No teacher assigned",
        room: slot.roomNumber,
        colorKey: slot.sectionSubject.subject.id,
      })),
    [timetableSlots],
  );

  if (isLoading) return <Spinner label="Loading student" />;
  if (error) return <Alert tone="danger">Failed to load student: {error.message}</Alert>;
  if (!student) return null;

  return (
    <div className="flex flex-col gap-4">
      <PortalStudentHeader student={student} />

      <div>
        <h2 className="mb-3 text-section-title font-semibold text-slate-900">Timetable</h2>
        {!timetableSlots ? (
          <Spinner label="Loading timetable" />
        ) : timetableBlocks.length === 0 ? (
          <EmptyState message="No timetable published for this section yet." />
        ) : (
          <WeeklyTimetableGrid blocks={timetableBlocks} />
        )}
      </div>
    </div>
  );
}
