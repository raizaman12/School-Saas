"use client";

import Link from "next/link";
import { KeyRound, Menu } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useAsync } from "@/lib/hooks/useAsync";
import { staffApi } from "@/lib/resources/staff";
import { Button } from "@/components/ui";
import { ProfileMenu } from "@/components/layout/ProfileMenu";
import { t } from "@/lib/i18n";

export function Topbar({ onMenuClick }: { onMenuClick?: () => void }) {
  const { user, tenant } = useAuth();
  // 404s silently for a role with no StaffProfile — not expected on the
  // dashboard (PARENT/STUDENT are redirected to /portal before this ever
  // renders, see the dashboard layout), but kept defensive rather than
  // assuming.
  const { data: staffProfile } = useAsync(() => staffApi.me(), [user?.id]);

  return (
    <header className="flex h-16 items-center justify-between bg-primary-700 px-4 md:px-6">
      <div className="flex items-center gap-2">
        {onMenuClick && (
          <button
            type="button"
            onClick={onMenuClick}
            aria-label="Open navigation menu"
            className="focus-ring -ml-1 flex size-11 items-center justify-center rounded-lg text-primary-100 hover:bg-white/10 hover:text-white md:hidden"
          >
            <Menu className="size-5" aria-hidden="true" />
          </button>
        )}
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-white">{tenant?.name ?? "—"}</span>
          {user && <span className="text-xs text-primary-100">{user.role.replace("_", " ")}</span>}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <span className="hidden text-sm text-primary-100 sm:inline">{user?.fullName}</span>
        <Link href="/dashboard/change-password">
          <Button variant="outline" size="sm">
            <KeyRound className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">{t("nav.changePassword")}</span>
          </Button>
        </Link>
        <ProfileMenu photoUrl={staffProfile?.photoUrl} profileHref="/dashboard/profile" />
      </div>
    </header>
  );
}
