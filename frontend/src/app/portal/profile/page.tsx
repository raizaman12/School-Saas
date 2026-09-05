"use client";

import { useAuth } from "@/lib/auth/AuthProvider";
import { ProfileForm } from "@/components/domain/ProfileForm";
import { StudentProfileTabs } from "@/components/domain/StudentProfileTabs";
import { t } from "@/lib/i18n";

export default function PortalProfilePage() {
  const { user } = useAuth();

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <div>
        <h1 className="text-page-title font-semibold text-slate-900">{t("auth.profileTitle")}</h1>
        <p className="text-sm text-slate-500">{t("auth.profileSubtitle")}</p>
      </div>
      {/* STUDENT gets the tabbed About/Bio Data profile; PARENT keeps the
          simple email/phone form — Guardian has no address/CNIC/etc. self-
          service fields to build a Bio Data tab out of, and this feature
          was scoped to student+teacher only (see StudentProfileTabs' doc
          comment). */}
      {user?.role === "STUDENT" ? <StudentProfileTabs /> : <ProfileForm />}
    </div>
  );
}
