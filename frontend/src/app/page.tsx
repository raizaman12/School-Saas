import Link from "next/link";
import { GraduationCap } from "lucide-react";
import { Button } from "@/components/ui";
import { t } from "@/lib/i18n";

export default function LandingPage() {
  return (
    <main className="flex min-h-screen flex-1 flex-col items-center justify-center bg-slate-50 px-4">
      <div className="flex max-w-lg flex-col items-center gap-6 text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-primary-600 text-white">
          <GraduationCap className="size-7" aria-hidden="true" />
        </div>

        <div className="flex flex-col gap-2">
          <h1 className="text-brand-title font-semibold text-slate-900">{t("app.name")}</h1>
          <p className="text-slate-500">{t("app.tagline")}</p>
        </div>

        <div className="flex w-full flex-col gap-3 sm:flex-row sm:justify-center">
          <Link href="/signup" className="w-full sm:w-auto">
            <Button className="w-full">{t("auth.registerLink")}</Button>
          </Link>
          <Link href="/login" className="w-full sm:w-auto">
            <Button variant="outline" className="w-full">
              {t("auth.loginLink")}
            </Button>
          </Link>
        </div>
      </div>
    </main>
  );
}
