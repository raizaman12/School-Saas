import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Users,
  BookOpen,
  CalendarCheck,
  GraduationCap,
  Wallet,
  Briefcase,
  Banknote,
  Bell,
  Megaphone,
  Building2,
  Layers,
  BarChart3,
  Settings,
  CalendarOff,
  CalendarClock,
  ShieldAlert,
  FileQuestion,
  HeartHandshake,
  HeartPulse,
  LineChart,
  ListPlus,
  Contact,
  Archive,
} from "lucide-react";
import type { UserRole } from "@/lib/auth/types";
import { t } from "@/lib/i18n";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  roles: UserRole[];
}

const STAFF_ROLES: UserRole[] = ["SCHOOL_ADMIN", "TEACHER", "ACCOUNTANT", "FRONT_DESK"];

export const NAV_ITEMS: NavItem[] = [
  { label: t("nav.dashboard"), href: "/dashboard", icon: LayoutDashboard, roles: STAFF_ROLES },
  {
    label: t("nav.analytics"),
    href: "/dashboard/analytics",
    icon: LineChart,
    // Matches analytics.ts's READ_ROLES — spans financial, academic, and
    // attendance data all at once, so it's reserved for SCHOOL_ADMIN
    // the same way the fee-defaulter list and platform stats are.
    roles: ["SCHOOL_ADMIN"],
  },
  {
    label: t("nav.students"),
    href: "/dashboard/students",
    icon: Users,
    roles: ["SCHOOL_ADMIN", "FRONT_DESK", "TEACHER", "ACCOUNTANT"],
  },
  {
    label: t("nav.academics"),
    href: "/dashboard/academics",
    icon: BookOpen,
    roles: ["SCHOOL_ADMIN", "TEACHER"],
  },
  {
    label: t("nav.timetable"),
    href: "/dashboard/timetable",
    icon: CalendarClock,
    // Matches GET /api/timetable/me's own TEACHER-only gate — a
    // SCHOOL_ADMIN can't be assigned as a section-subject's teacher (see
    // assertTeacherRole on the backend), so there's no "own timetable" for
    // them to have.
    roles: ["TEACHER"],
  },
  {
    label: t("nav.attendance"),
    href: "/dashboard/attendance",
    icon: CalendarCheck,
    roles: ["SCHOOL_ADMIN", "FRONT_DESK", "TEACHER"],
  },
  {
    label: t("nav.exams"),
    href: "/dashboard/exams",
    icon: GraduationCap,
    roles: ["SCHOOL_ADMIN", "TEACHER", "FRONT_DESK", "ACCOUNTANT"],
  },
  {
    label: t("nav.examGenerator"),
    href: "/dashboard/exam-generator",
    icon: FileQuestion,
    // Question-bank contribution is open to every TEACHER; actually
    // *generating* a paper is further gated per (Class, Subject) by an
    // ExamPaperAccessGrant, enforced server-side — see the backend's
    // examGenerator module.
    roles: ["SCHOOL_ADMIN", "TEACHER"],
  },
  {
    label: t("nav.fees"),
    href: "/dashboard/fees",
    icon: Wallet,
    roles: ["SCHOOL_ADMIN", "ACCOUNTANT", "FRONT_DESK"],
  },
  { label: t("nav.staff"), href: "/dashboard/staff", icon: Briefcase, roles: ["SCHOOL_ADMIN", "ACCOUNTANT"] },
  {
    label: t("nav.guardians"),
    href: "/dashboard/guardians",
    icon: Contact,
    // Matches guardians.ts's READ_ROLES — a TEACHER's results there are
    // already scoped server-side to their own students' guardians only.
    roles: ["SCHOOL_ADMIN", "FRONT_DESK", "TEACHER", "ACCOUNTANT"],
  },
  {
    label: t("nav.payroll"),
    href: "/dashboard/staff/payroll",
    icon: Banknote,
    roles: ["SCHOOL_ADMIN", "ACCOUNTANT"],
  },
  { label: t("nav.notifications"), href: "/dashboard/notifications", icon: Bell, roles: STAFF_ROLES },
  { label: t("nav.notices"), href: "/dashboard/notices", icon: Megaphone, roles: STAFF_ROLES },
  {
    label: t("nav.discipline"),
    href: "/dashboard/discipline",
    icon: ShieldAlert,
    // Matches discipline.ts's READ_ROLES — ACCOUNTANT has no reason to see
    // conduct records (unlike attendance/fees, this isn't billing-relevant).
    roles: ["SCHOOL_ADMIN", "FRONT_DESK", "TEACHER"],
  },
  {
    label: t("nav.supportNeeds"),
    href: "/dashboard/support-needs",
    icon: HeartHandshake,
    // Matches supportNeeds.ts's READ_ROLES — tighter than discipline: no
    // FRONT_DESK, since a learning-support plan is disability/learning-need
    // adjacent and more sensitive than a conduct note.
    roles: ["SCHOOL_ADMIN", "TEACHER"],
  },
  {
    label: t("nav.health"),
    href: "/dashboard/health",
    icon: HeartPulse,
    // Matches health.ts's READ_ROLES — same broad staff visibility as
    // discipline (a teacher needs to know a student's allergies).
    roles: ["SCHOOL_ADMIN", "FRONT_DESK", "TEACHER"],
  },
  {
    label: t("nav.leaveRequests"),
    href: "/dashboard/leave-requests",
    icon: CalendarOff,
    roles: STAFF_ROLES,
  },
  {
    label: t("nav.customFields"),
    href: "/dashboard/custom-fields",
    icon: ListPlus,
    // Schema-config action (defining what extra fields exist at all) —
    // same tier as Settings. Everyone who can already see a student's
    // custom-field values reads them straight from the student page, not
    // from here.
    roles: ["SCHOOL_ADMIN"],
  },
  {
    label: t("nav.previousData"),
    href: "/dashboard/previous-data",
    icon: Archive,
    // Browse-only: students/staff who left, were transferred, or were
    // archived, plus past academic years' exam results — matches the
    // Students/Staff/Exams READ_ROLES this page's tabs actually call.
    roles: ["SCHOOL_ADMIN", "FRONT_DESK"],
  },
  { label: t("nav.settings"), href: "/dashboard/settings", icon: Settings, roles: ["SCHOOL_ADMIN"] },
  {
    label: t("nav.platformOverview"),
    href: "/dashboard/platform/overview",
    icon: BarChart3,
    roles: ["SUPER_ADMIN"],
  },
  {
    label: t("nav.platformTenants"),
    href: "/dashboard/platform/tenants",
    icon: Building2,
    roles: ["SUPER_ADMIN"],
  },
  { label: t("nav.platformPlans"), href: "/dashboard/platform/plans", icon: Layers, roles: ["SUPER_ADMIN"] },
];

export function navItemsForRole(role: UserRole | undefined): NavItem[] {
  if (!role) return [];
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}
