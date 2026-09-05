"use client";

import { StaffProfileTabs } from "@/components/domain/StaffProfileTabs";
import { t } from "@/lib/i18n";

export default function DashboardProfilePage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <div>
        <h1 className="text-page-title font-semibold text-slate-900">{t("auth.profileTitle")}</h1>
        <p className="text-sm text-slate-500">{t("auth.profileSubtitle")}</p>
      </div>
      <StaffProfileTabs />
    </div>
  );
}
