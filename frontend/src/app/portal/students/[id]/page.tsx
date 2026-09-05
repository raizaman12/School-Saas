"use client";

import { use } from "react";
import Link from "next/link";
import { BookOpen, ChevronRight } from "lucide-react";
import { useAsync } from "@/lib/hooks/useAsync";
import { portalApi } from "@/lib/resources/portal";
import { PortalStudentHeader } from "@/components/domain/PortalStudentHeader";
import { Alert, Spinner, Card, CardHeader, CardTitle, CardContent, EmptyState } from "@/components/ui";

/**
 * The student/parent portal's Overview — just the student's course list.
 * Every OTHER section (Timetable, Attendance, Results, Fees, Discipline,
 * Learning Support, Health) used to be stacked underneath this on one
 * long page reached via hash anchors; each now has its own route (see
 * PortalSidebar's nav items) so a link in the sidebar actually shows only
 * that section instead of a giant scrolling page with everything on it.
 */
export default function PortalStudentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const { data: student, isLoading, error } = useAsync(() => portalApi.student(id), [id]);
  const { data: courses } = useAsync(() => portalApi.courses(id), [id]);

  if (isLoading) return <Spinner label="Loading student" />;
  if (error) return <Alert tone="danger">Failed to load student: {error.message}</Alert>;
  if (!student) return null;

  return (
    <div className="flex flex-col gap-4">
      <PortalStudentHeader student={student} />

      <div>
        <h2 className="mb-3 text-section-title font-semibold text-slate-900">My Courses</h2>
        {!courses ? (
          <Spinner label="Loading courses" />
        ) : courses.length === 0 ? (
          <EmptyState message="No courses assigned yet for this section." />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {courses.map((course) => (
              <Link key={course.id} href={`/portal/students/${id}/courses/${course.id}`}>
                <Card className="h-full transition-shadow hover:shadow-md">
                  <CardHeader className="flex-row items-center gap-3 space-y-0 border-b-0 pb-0">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
                      <BookOpen className="size-5" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <CardTitle className="truncate">{course.subject.name}</CardTitle>
                      <p className="truncate text-xs text-slate-500">
                        {course.teacher ? course.teacher.fullName : "No teacher assigned"}
                      </p>
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-slate-400" aria-hidden="true" />
                  </CardHeader>
                  <CardContent className="pt-2">
                    <p className="text-xs text-slate-500">
                      {course.section.schoolClass.name} - {course.section.name}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
