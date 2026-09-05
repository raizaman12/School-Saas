"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { GraduationCap, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { navItemsForRole } from "./nav";
import type { UserRole } from "@/lib/auth/types";
import { t } from "@/lib/i18n";

function SidebarNav({ role, onNavigate }: { role: UserRole | undefined; onNavigate?: () => void }) {
  const pathname = usePathname();
  const items = navItemsForRole(role);

  return (
    <nav aria-label="Primary" className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
      {items.map((item) => {
        const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
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

// The school's own chosen color, applied boldly here (a solid-colored
// sidebar + header, not just a thin accent line) so the portal reads as
// "this school's" rather than a generic light-blue default — see
// PortalSidebar.tsx for the identical treatment on the student/parent side
// and Topbar.tsx for the header half of the same look.
function BrandMark() {
  return (
    <div className="flex h-16 items-center gap-2 border-b border-primary-500/40 bg-primary-800 px-5">
      <div className="flex size-8 items-center justify-center rounded-lg bg-white/15 text-white">
        <GraduationCap className="size-5" aria-hidden="true" />
      </div>
      <span className="font-semibold text-white">{t("app.name")}</span>
    </div>
  );
}

/**
 * Always-visible desktop rail. Hidden below the md breakpoint — mobile
 * users get MobileSidebar instead.
 *
 * `sticky top-0 h-screen` pins this to the viewport as the main content
 * scrolls — without it, the sidebar was just another item in the page's
 * own flex flow, so scrolling down a long page (a big table, a long form)
 * scrolled the nav away with it. `sticky` (not `fixed`) is what lets it
 * keep sitting in the flex row's normal layout position — no separate
 * width/offset math needed to keep the main content from sliding under it.
 */
export function Sidebar({ role }: { role: UserRole | undefined }) {
  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-primary-700 md:flex">
      <BrandMark />
      <SidebarNav role={role} />
    </aside>
  );
}

/**
 * Slide-in drawer shown only below the md breakpoint, toggled by Topbar's
 * menu button. Without this, staff on phones (the common case for teachers
 * and front-desk users in this app's target market) would have no way to
 * navigate beyond whatever page they landed on — the desktop Sidebar is
 * `hidden` there entirely.
 */
export function MobileSidebar({
  role,
  open,
  onClose,
}: {
  role: UserRole | undefined;
  open: boolean;
  onClose: () => void;
}) {
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
        <SidebarNav role={role} onNavigate={onClose} />
      </aside>
    </div>
  );
}
