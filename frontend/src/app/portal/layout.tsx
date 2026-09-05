"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { CalendarOff, GraduationCap, KeyRound, Megaphone, Menu } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useAsync } from "@/lib/hooks/useAsync";
import { studentsApi } from "@/lib/resources/students";
import { Button, FullPageSpinner } from "@/components/ui";
import { ProfileMenu } from "@/components/layout/ProfileMenu";
import { PortalSidebar, PortalMobileSidebar } from "@/components/layout/PortalSidebar";
import { t } from "@/lib/i18n";

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const { user, tenant, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Close the mobile drawer automatically whenever the route changes (e.g.
  // after tapping a sidebar link), so it never lingers open over the new page.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  // Only a STUDENT has a photo to show here — PARENT/Guardian has no
  // photoUrl field (see schema.prisma's Guardian model), so this simply
  // never resolves for a parent and ProfileMenu falls back to the
  // initial-letter avatar for them.
  const { data: studentMe } = useAsync(
    () => (user?.role === "STUDENT" ? studentsApi.me() : Promise.resolve(null)),
    [user?.id, user?.role],
  );

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    if (user.role !== "PARENT" && user.role !== "STUDENT") {
      router.replace("/dashboard");
    }
  }, [isLoading, user, router]);

  if (isLoading || !user || (user.role !== "PARENT" && user.role !== "STUDENT")) {
    return <FullPageSpinner label="Loading your portal" />;
  }

  return (
    <div className="flex min-h-screen">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[60] focus:rounded-lg focus:bg-primary-600 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
      >
        Skip to main content
      </a>
      <PortalSidebar />
      <PortalMobileSidebar open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
      <div className="flex flex-1 flex-col">
        <header className="flex h-16 items-center justify-between bg-primary-700 px-4 md:px-6">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation menu"
              className="focus-ring -ml-1 flex size-11 items-center justify-center rounded-lg text-primary-100 hover:bg-white/10 hover:text-white md:hidden"
            >
              <Menu className="size-5" aria-hidden="true" />
            </button>
            <div className="flex size-8 items-center justify-center rounded-lg bg-white/15 text-white md:hidden">
              <GraduationCap className="size-5" aria-hidden="true" />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-white">{tenant?.name ?? t("app.name")}</span>
              <span className="text-xs text-primary-100">{t("nav.portal")}</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-primary-100 sm:inline">{user.fullName}</span>
            <Link href="/portal/notices">
              <Button variant="outline" size="sm">
                <Megaphone className="size-4" aria-hidden="true" />
                <span className="hidden sm:inline">{t("nav.noticeBoard")}</span>
              </Button>
            </Link>
            {user.role === "PARENT" && (
              <Link href="/portal/leave-requests">
                <Button variant="outline" size="sm">
                  <CalendarOff className="size-4" aria-hidden="true" />
                  <span className="hidden sm:inline">{t("nav.leaveRequests")}</span>
                </Button>
              </Link>
            )}
            <Link href="/portal/change-password">
              <Button variant="outline" size="sm">
                <KeyRound className="size-4" aria-hidden="true" />
                <span className="hidden sm:inline">{t("nav.changePassword")}</span>
              </Button>
            </Link>
            <ProfileMenu photoUrl={studentMe?.photoUrl} profileHref="/portal/profile" />
          </div>
        </header>
        <main id="main-content" className="flex-1 bg-slate-50 p-4 md:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
