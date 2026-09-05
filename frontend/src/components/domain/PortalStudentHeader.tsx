import { Badge } from "@/components/ui";
import type { PortalStudentSummary } from "@/lib/resources/portal";

/**
 * The "whose page is this" strip shown at the top of every one of a
 * student's portal pages (Overview, Timetable, Attendance, Results, Fees,
 * Discipline, Learning Support, Health — one route per section, see
 * PortalSidebar). Deliberately presentational (no fetch of its own): each
 * page already loads the student record to gate its own render, so this
 * just takes that same data rather than re-fetching it a second time.
 *
 * Matters most for a PARENT with more than one child — each page is
 * reached by its own link, not by scrolling one long page, so re-stating
 * the child's name/section/status here is what tells them which child
 * they're currently looking at.
 */
export function PortalStudentHeader({ student }: { student: PortalStudentSummary }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h1 className="text-page-title font-semibold text-slate-900">{student.fullName}</h1>
        <p className="text-sm text-slate-500">
          {student.studentCode}
          {student.currentSection
            ? ` · ${student.currentSection.schoolClass.name} - ${student.currentSection.name}`
            : " · Not enrolled"}
        </p>
      </div>
      <Badge tone={student.status === "ACTIVE" ? "success" : "default"}>{student.status}</Badge>
    </div>
  );
}
