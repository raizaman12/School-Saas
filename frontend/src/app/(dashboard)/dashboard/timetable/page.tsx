"use client";

import { useMemo } from "react";
import { useAsync } from "@/lib/hooks/useAsync";
import { academicsApi } from "@/lib/resources/academics";
import { WeeklyTimetableGrid, type TimetableBlock } from "@/components/domain/WeeklyTimetableGrid";
import { Spinner, Alert, EmptyState } from "@/components/ui";

/**
 * A TEACHER's own weekly timetable, laid out as a real Monday–Sunday grid
 * (see WeeklyTimetableGrid) — every class they teach, whether as class
 * teacher or as a subject teacher across different sections (see
 * lib/teacherScope.ts on the backend), with class/section, time, and room
 * number on each block. Read-only: only SCHOOL_ADMIN edits a timetable
 * (Academics → a section's Timetable panel) — this is purely "here's my
 * week at a glance", the same data GET /api/timetable/me already serves
 * the existing per-day "My classes" list on the Academics page, just
 * presented the way a real school timetable actually looks.
 */
export default function TeacherTimetablePage() {
  const { data: slots, isLoading, error } = useAsync(() => academicsApi.myTimetable(), []);

  const blocks: TimetableBlock[] = useMemo(
    () =>
      (slots ?? []).map((slot) => ({
        id: slot.id,
        dayOfWeek: slot.dayOfWeek,
        startTime: slot.startTime,
        endTime: slot.endTime,
        title: slot.sectionSubject.subject.name,
        subtitle: `${slot.sectionSubject.section.schoolClass.name} - ${slot.sectionSubject.section.name}`,
        room: slot.roomNumber,
        colorKey: slot.sectionSubject.subject.id,
      })),
    [slots],
  );

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-page-title font-semibold text-slate-900">My Timetable</h1>

      {isLoading && <Spinner label="Loading your timetable" />}
      {error && <Alert tone="danger">Failed to load timetable: {error.message}</Alert>}

      {!isLoading && !error && blocks.length === 0 && (
        <EmptyState message="No classes assigned to you yet — your admin hasn't built your timetable." />
      )}

      {!isLoading && !error && blocks.length > 0 && <WeeklyTimetableGrid blocks={blocks} />}
    </div>
  );
}
