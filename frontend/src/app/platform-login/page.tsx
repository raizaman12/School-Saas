"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ShieldCheck } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { ApiError } from "@/lib/api";
import { platformLoginSchema, type PlatformLoginFormValues } from "@/lib/auth/schemas";
import { Button, Input, Alert } from "@/components/ui";
import { t } from "@/lib/i18n";

/**
 * A separate sign-in path for platform staff (SUPER_ADMIN) — those
 * accounts have no tenant/school, so the regular /login form (which
 * always asks for a school URL first) can never authenticate them. This
 * was a real gap: the Super Admin backend and dashboard pages existed,
 * but there was no way to actually reach them from the browser.
 */
export default function PlatformLoginPage() {
  const { platformLogin } = useAuth();
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<PlatformLoginFormValues>({ resolver: zodResolver(platformLoginSchema) });

  const onSubmit = async (values: PlatformLoginFormValues) => {
    setFormError(null);
    try {
      await platformLogin(values);
      router.push("/dashboard/platform/overview");
    } catch (err) {
      if (err instanceof ApiError) {
        setFormError(err.status === 401 ? t("auth.invalidCredentials") : err.message);
      } else {
        setFormError("Something went wrong. Please try again.");
      }
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <ShieldCheck className="mx-auto mb-2 size-8 text-primary-600" aria-hidden="true" />
          <h1 className="text-auth-title font-semibold text-slate-900">{t("auth.platformLoginTitle")}</h1>
          <p className="mt-1 text-sm text-slate-500">{t("auth.platformLoginSubtitle")}</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
            {formError && <Alert tone="danger">{formError}</Alert>}

            <Input
              label={t("auth.email")}
              type="email"
              required
              error={errors.email?.message}
              {...register("email")}
            />
            <Input
              label={t("auth.password")}
              type="password"
              required
              error={errors.password?.message}
              {...register("password")}
            />

            <Button type="submit" isLoading={isSubmitting} className="mt-2 w-full">
              {t("auth.loginButton")}
            </Button>
          </form>
        </div>

        <p className="mt-4 text-center text-sm text-slate-500">
          <Link href="/login" className="font-medium text-primary-600 hover:underline">
            {t("auth.backToSchoolLogin")}
          </Link>
        </p>
      </div>
    </main>
  );
}
