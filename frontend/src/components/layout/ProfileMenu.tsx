"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LogOut, UserCog } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { t } from "@/lib/i18n";

/**
 * Header profile-photo dropdown — the avatar in the top-right corner of
 * both the dashboard (staff) and portal (student/parent) headers, opening
 * onto exactly two options: My Profile and Log out. Replaces what used to
 * be two always-visible buttons with the pattern from the reference
 * university-portal screenshots (click the photo, a small menu opens).
 *
 * `photoUrl` is whichever source the caller has on hand for the signed-in
 * user (Student.photoUrl for a student, StaffProfile.photoUrl for staff) —
 * null falls back to an initial-letter avatar, same fallback ProfileForm's
 * StaffPhotoSection already uses elsewhere.
 */
export function ProfileMenu({ photoUrl, profileHref }: { photoUrl?: string | null; profileHref: string }) {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  const handleLogout = async () => {
    await logout();
    router.push("/login");
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("nav.myProfile")}
        className="focus-ring flex size-10 items-center justify-center overflow-hidden rounded-full bg-primary-50 text-primary-700 transition-colors hover:ring-2 hover:ring-primary-200"
      >
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl} alt="Profile" className="size-full object-cover" />
        ) : (
          <span className="text-sm font-semibold">{user?.fullName?.charAt(0) ?? "?"}</span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-12 z-50 w-48 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
        >
          <div className="border-b border-slate-100 px-3 py-2">
            <p className="truncate text-sm font-medium text-slate-900">{user?.fullName}</p>
            <p className="truncate text-xs text-slate-500">{user?.email}</p>
          </div>
          <Link
            href={profileHref}
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-primary-50 hover:text-primary-700"
          >
            <UserCog className="size-4" aria-hidden="true" />
            {t("nav.myProfile")}
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={handleLogout}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-primary-50 hover:text-primary-700"
          >
            <LogOut className="size-4" aria-hidden="true" />
            {t("nav.logout")}
          </button>
        </div>
      )}
    </div>
  );
}
