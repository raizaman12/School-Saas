"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, Copy, BookOpen, Clock, User as UserIcon } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { navItemsForRole } from "@/components/layout/nav";
import { buildTenantLoginUrl } from "@/lib/subdomain";
import { useAsync } from "@/lib/hooks/useAsync";
import { academicsApi, formatSlotTime, type DayOfWeek } from "@/lib/resources/academics";
import { staffApi } from "@/lib/resources/staff";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Button,
  Spinner,
  EmptyState,
} from "@/components/ui";

const APP_DOMAIN = process.env.NEXT_PUBLIC_APP_DOMAIN;

const DAY_LABELS: Record<DayOfWeek, string> = {
  MONDAY: "Mon",
  TUESDAY: "Tue",
  WEDNESDAY: "Wed",
  THURSDAY: "Thu",
  FRIDAY: "Fri",
  SATURDAY: "Sat",
  SUNDAY: "Sun",
};

function SchoolLoginLinkCard({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);
  if (!APP_DOMAIN) return null;

  const isLocal = APP_DOMAIN.startsWith("localhost");
  const url = buildTenantLoginUrl(slug, APP_DOMAIN, isLocal ? "http" : "https");

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable (e.g. insecure context) — the URL is
      // still visible and selectable, so this is a soft failure.
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your school&apos;s login page</CardTitle>
        <CardDescription>
          Share this link with staff, parents, and students — it takes them straight to your school&apos;s sign-in
          form.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center gap-2">
          <code className="flex-1 truncate rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">{url}</code>
          <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
            {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * TEACHER's dashboard home: their own photo/details, then a course-card
 * grid (one card per section-subject they're assigned to teach) mirroring
 * the student/parent portal's course-card pattern — see GET
 * /api/section-subjects/me. Each card links into the teacher-facing
 * "manage this course" page for posting announcements, sharing material,
 * and setting assessments.
 */
function TeacherCourseCards() {
  const { user } = useAuth();
  // 404s for a TEACHER only in the impossible case they have no StaffProfile
  // at all — staffApi.me() throwing just means the photo/designation block
  // renders with fallbacks below.
  const { data: profile } = useAsync(() => staffApi.me(), []);
  const { data: courses, isLoading: coursesLoading } = useAsync(() => academicsApi.mySectionSubjects(), []);

  return (
    <>
      <Card>
        <CardContent className="flex items-center gap-4">
          <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary-50 text-primary-600">
            {profile?.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profile.photoUrl}
                alt={user?.fullName ?? "Profile photo"}
                className="size-full object-cover"
              />
            ) : (
              <UserIcon className="size-8" aria-hidden="true" />
            )}
          </div>
          <div>
            <h1 className="text-page-title font-semibold text-slate-900">{user?.fullName}</h1>
            <p className="text-sm text-slate-500">
              {profile?.designation ?? "Teacher"}
              {profile?.employeeCode ? ` · ${profile.employeeCode}` : ""}
            </p>
          </div>
        </CardContent>
      </Card>

      <div>
        <h2 className="mb-3 text-section-title font-semibold text-slate-900">My Courses</h2>
        {coursesLoading ? (
          <Spinner label="Loading courses" />
        ) : !courses || courses.length === 0 ? (
          <EmptyState message="No courses assigned to you yet — ask the school admin to assign you as a subject teacher." />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {courses.map((course) => (
              <Link key={course.id} href={`/dashboard/academics/courses/${course.id}`}>
                <Card className="h-full transition-shadow hover:shadow-md">
                  <CardHeader className="flex-row items-center gap-3 space-y-0 border-b-0 pb-0">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
                      <BookOpen className="size-5" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <CardTitle className="truncate">{course.subject.name}</CardTitle>
                      <p className="truncate text-xs text-slate-500">
                        {course.section.schoolClass.name} - {course.section.name}
                      </p>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-2">
                    {course.timetableSlots.length === 0 ? (
                      <p className="text-xs text-slate-400">No timetable slot set</p>
                    ) : (
                      <div className="flex flex-col gap-1">
                        {course.timetableSlots.map((slot) => (
                          <p key={slot.id} className="flex items-center gap-1.5 text-xs text-slate-500">
                            <Clock className="size-3.5" aria-hidden="true" />
                            {DAY_LABELS[slot.dayOfWeek]} {formatSlotTime(slot.startTime)}–{formatSlotTime(slot.endTime)}
                          </p>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

export default function DashboardHomePage() {
  const { user, tenant } = useAuth();
  const isTeacher = user?.role === "TEACHER";
  const quickLinks = navItemsForRole(user?.role).filter((item) => item.href !== "/dashboard");

  return (
    <div className="flex flex-col gap-6">
      {isTeacher ? (
        <TeacherCourseCards />
      ) : (
        <div>
          <h1 className="text-page-title font-semibold text-slate-900">
            Welcome back{user?.fullName ? `, ${user.fullName.split(" ")[0]}` : ""}
          </h1>
          <p className="text-sm text-slate-500">
            {tenant ? `${tenant.name} — ` : ""}
            Here&apos;s where you can jump into the modules available to your role.
          </p>
        </div>
      )}

      {user?.role === "SCHOOL_ADMIN" && tenant && <SchoolLoginLinkCard slug={tenant.slug} />}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {quickLinks.map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href}>
              <Card className="h-full transition-shadow hover:shadow-md">
                <CardHeader className="flex-row items-center gap-3 space-y-0 border-b-0 pb-0">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
                    <Icon className="size-5" aria-hidden="true" />
                  </div>
                  <CardTitle>{item.label}</CardTitle>
                </CardHeader>
                <CardContent className="pt-2">
                  <CardDescription>Open {item.label.toLowerCase()}</CardDescription>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
