"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthProvider";
import { Sidebar, MobileSidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { FullPageSpinner } from "@/components/ui";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    if (user.role === "PARENT" || user.role === "STUDENT") {
      router.replace("/portal");
    }
  }, [isLoading, user, router]);

  // Close the mobile drawer automatically whenever the route changes (e.g.
  // after tapping a nav link), so it never lingers open over the new page.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  if (isLoading || !user || user.role === "PARENT" || user.role === "STUDENT") {
    return <FullPageSpinner label="Loading your dashboard" />;
  }

  return (
    <div className="flex min-h-screen">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[60] focus:rounded-lg focus:bg-primary-600 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
      >
        Skip to main content
      </a>
      <Sidebar role={user.role} />
      <MobileSidebar role={user.role} open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
      <div className="flex flex-1 flex-col">
        <Topbar onMenuClick={() => setMobileNavOpen(true)} />
        <main id="main-content" className="flex-1 bg-slate-50 p-4 md:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
