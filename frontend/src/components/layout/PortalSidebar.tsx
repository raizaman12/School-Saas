"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  GraduationCap,
  X,
  LayoutDashboard,
  CalendarCheck,
  CalendarClock,
  Trophy,
  Wallet,
  Megaphone,
  CalendarOff,
  KeyRound,
  UserCircle,
  ShieldAlert,
  HeartHandshake,
  HeartPulse,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useAsync } from "@/lib/hooks/useAsync";
import { portalApi } from "@/lib/resources/portal";
import { t } from "@/lib/i18n";

/**
 * Resolves which student's overview page the sidebar's quick links should
 * point at: a STUDENT always has exactly one (their own — see
 * portalApi.me()), while a PARENT only has one once they've actually
 * opened a child's page (the URL itself, /portal/students/[id], is the
 * source of truth there — a parent with several children hasn't "picked"
 * one anywhere else). Returns null before that resolves, in which case
 * the section-specific links (Timetable/Attendance/Results/Fees/...) are
 * hidden rather than pointing nowhere.
 */
function usePortalStudentId(): string | null {
  const pathname = usePathname();
  const { user } = useAuth();
  const { data: me } = useAsync(() => portalApi.me(), [user?.id]);

  const fromUrl = pathname.match(/^\/portal\/students\/([^/]+)/)?.[1];
  if (fromUrl) return fromUrl;
  if (me?.role === "STUDENT") return me.student.id;
  return null;
}

interface PortalNavItem {
  key: string;
  label: string;
  href: string;
  icon: typeof LayoutDashboard;
}

function useNavItems(): PortalNavItem[] {
  const { user } = useAuth();
  const studentId = usePortalStudentId();

  // "Overview" IS the student's course list (see
  // portal/students/[id]/page.tsx) — there is no separate "My Courses"
  // link anymore, since that would just be a second link to the exact
  // same page. Every other section now has its own dedicated route
  // (rather than an anchor into one long page all sections used to share)
  // so opening one from the sidebar shows only that section.
  const items: PortalNavItem[] = [
    {
      key: "overview",
      label: "Overview",
      href: studentId ? `/portal/students/${studentId}` : "/portal",
      icon: LayoutDashboard,
    },
  ];

  if (studentId) {
    items.push(
      { key: "timetable", label: "Timetable", href: `/portal/students/${studentId}/timetable`, icon: CalendarClock },
      { key: "attendance", label: "Attendance", href: `/portal/students/${studentId}/attendance`, icon: CalendarCheck },
      { key: "results", label: "Results", href: `/portal/students/${studentId}/results`, icon: Trophy },
      { key: "fees", label: "Fees", href: `/portal/students/${studentId}/fees`, icon: Wallet },
      { key: "discipline", label: "Discipline", href: `/portal/students/${studentId}/discipline`, icon: ShieldAlert },
      {
        key: "supportNeeds",
        label: "Learning Support",
        href: `/portal/students/${studentId}/support-needs`,
        icon: HeartHandshake,
      },
      { key: "health", label: "Health", href: `/portal/students/${studentId}/health`, icon: HeartPulse },
    );
  }

  items.push({ key: "notices", label: t("nav.noticeBoard"), href: "/portal/notices", icon: Megaphone });
  if (user?.role === "PARENT") {
    items.push({ key: "leave", label: t("nav.leaveRequests"), href: "/portal/leave-requests", icon: CalendarOff });
  }
  items.push(
    { key: "password", label: t("nav.changePassword"), href: "/portal/change-password", icon: KeyRound },
    { key: "profile", label: t("nav.myProfile"), href: "/portal/profile", icon: UserCircle },
  );

  return items;
}

function PortalSidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const items = useNavItems();

  return (
    <nav aria-label="Portal navigation" className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
      {items.map((item) => {
        const isActive = pathname === item.href;
        const Icon = item.icon;
        return (
          <Link
            key={item.key}
            href={item.href}
            onClick={onNavigate}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "focus-ring flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "bg-white text-primary-700 shadow-sm"
                : "text-primary-100 hover:bg-white/10 hover:text-white",
            )}
          >
            <Icon className="size-5 shrink-0" aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

// Same bold, solid-colored treatment as the staff dashboard's Sidebar.tsx —
// the school's own chosen color, applied to the whole rail and header, so
// the portal reads as "this school's" for parents/students too, not just
// staff.
function BrandMark() {
  return (
    <div className="flex h-16 items-center gap-2 border-b border-primary-500/40 bg-primary-800 px-5">
      <div className="flex size-8 items-center justify-center rounded-lg bg-white/15 text-white">
        <GraduationCap className="size-5" aria-hidden="true" />
      </div>
      <div className="flex flex-col">
        <span className="font-semibold text-white">{t("app.name")}</span>
        <span className="text-xs text-primary-100">{t("nav.portal")}</span>
      </div>
    </div>
  );
}

/**
 * Always-visible desktop rail for the student/parent portal. Hidden below
 * md — PortalMobileSidebar covers phones. `sticky top-0 h-screen` keeps it
 * pinned to the viewport while the page scrolls — see Sidebar.tsx's
 * matching doc comment for why `sticky` rather than `fixed`.
 */
export function PortalSidebar() {
  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-primary-700 md:flex">
      <BrandMark />
      <PortalSidebarNav />
    </aside>
  );
}

/** Slide-in drawer for phones — the common device for parents/students in this app's target market. */
export function PortalMobileSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation menu">
      <button
        type="button"
        aria-label="Close navigation menu"
        className="absolute inset-0 bg-slate-900/40"
        onClick={onClose}
      />
      <aside className="relative flex h-full w-72 max-w-[80vw] flex-col bg-primary-700 shadow-xl">
        <div className="flex h-16 items-center justify-between border-b border-primary-500/40 bg-primary-800 pr-3">
          <BrandMark />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation menu"
            className="focus-ring flex size-11 items-center justify-center rounded-lg text-primary-100 hover:bg-white/10 hover:text-white"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
        <PortalSidebarNav onNavigate={onClose} />
      </aside>
    </div>
  );
}
