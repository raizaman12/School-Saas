"use client";

import { ChangePasswordForm } from "@/components/domain/ChangePasswordForm";
import { t } from "@/lib/i18n";

export default function PortalChangePasswordPage() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4">
      <div>
        <h1 className="text-page-title font-semibold text-slate-900">{t("auth.changePasswordTitle")}</h1>
        <p className="text-sm text-slate-500">{t("auth.changePasswordSubtitle")}</p>
      </div>
      <ChangePasswordForm loginHref="/login" />
    </div>
  );
}
