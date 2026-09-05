"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ApiError } from "@/lib/api";
import { passwordResetApi } from "@/lib/resources/passwordReset";
import { extractTenantSlugFromHost } from "@/lib/subdomain";
import {
  forgotPasswordSchema,
  resetPasswordCodeSchema,
  type ForgotPasswordFormValues,
  type ResetPasswordCodeFormValues,
} from "@/lib/auth/schemas";
import { Button, Input, Alert } from "@/components/ui";
import { t } from "@/lib/i18n";

function RequestCodeStep({ onSent }: { onSent: (args: { slug: string; debugToken?: string }) => void }) {
  const [detectedSlug, setDetectedSlug] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    const appDomain = process.env.NEXT_PUBLIC_APP_DOMAIN;
    if (!appDomain) return;
    setDetectedSlug(extractTenantSlugFromHost(window.location.host, appDomain));
  }, []);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordFormValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { slug: detectedSlug ?? "" },
  });

  useEffect(() => {
    if (detectedSlug) setValue("slug", detectedSlug);
  }, [detectedSlug, setValue]);

  const onSubmit = async (values: ForgotPasswordFormValues) => {
    setFormError(null);
    try {
      const res = await passwordResetApi.forgot(values);
      onSent({ slug: values.slug, debugToken: res.debugToken });
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t("auth.forgotPasswordError"));
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
      {formError && <Alert tone="danger">{formError}</Alert>}
      <Input
        label={t("auth.schoolSlug")}
        placeholder="your-school"
        hint="Ask your school for this if you're not sure — it's not your personal login."
        required
        error={errors.slug?.message}
        {...register("slug")}
      />
      <Input label={t("auth.email")} type="email" required error={errors.email?.message} {...register("email")} />
      <Button type="submit" isLoading={isSubmitting} className="mt-2 w-full">
        {t("auth.forgotPasswordSendButton")}
      </Button>
    </form>
  );
}

function EnterCodeStep({ slug, debugToken }: { slug: string; debugToken?: string }) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordCodeFormValues>({
    resolver: zodResolver(resetPasswordCodeSchema),
    defaultValues: { token: debugToken ?? "" },
  });

  const onSubmit = async (values: ResetPasswordCodeFormValues) => {
    setFormError(null);
    try {
      await passwordResetApi.reset({ slug, token: values.token, newPassword: values.newPassword });
      setSuccess(true);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t("auth.resetPasswordError"));
    }
  };

  if (success) {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="success">{t("auth.resetPasswordSuccess")}</Alert>
        <Button type="button" onClick={() => router.push("/login")} className="w-full">
          {t("auth.loginButton")}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Alert tone="success" title={t("auth.forgotPasswordSentTitle")}>
        {t("auth.forgotPasswordSentMessage")}
      </Alert>
      {debugToken && (
        <Alert tone="info">
          Dev mode — no real email is sent yet, so here&apos;s your code directly: <strong>{debugToken}</strong>
        </Alert>
      )}
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
        {formError && <Alert tone="danger">{formError}</Alert>}
        <Input
          label={t("auth.resetCode")}
          required
          error={errors.token?.message}
          {...register("token")}
        />
        <Input
          label={t("auth.newPassword")}
          type="password"
          required
          autoComplete="new-password"
          error={errors.newPassword?.message}
          {...register("newPassword")}
        />
        <Input
          label={t("auth.confirmNewPassword")}
          type="password"
          required
          autoComplete="new-password"
          error={errors.confirmNewPassword?.message}
          {...register("confirmNewPassword")}
        />
        <Button type="submit" isLoading={isSubmitting} className="mt-2 w-full">
          {t("auth.resetPasswordButton")}
        </Button>
      </form>
    </div>
  );
}

function ForgotPasswordForm() {
  const [sent, setSent] = useState<{ slug: string; debugToken?: string } | null>(null);

  return sent ? (
    <EnterCodeStep slug={sent.slug} debugToken={sent.debugToken} />
  ) : (
    <RequestCodeStep onSent={setSent} />
  );
}

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-auth-title font-semibold text-slate-900">{t("auth.forgotPasswordTitle")}</h1>
          <p className="mt-1 text-sm text-slate-500">{t("auth.forgotPasswordSubtitle")}</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <Suspense fallback={null}>
            <ForgotPasswordForm />
          </Suspense>
        </div>

        <p className="mt-4 text-center text-sm text-slate-500">
          <Link href="/login" className="font-medium text-primary-600 hover:underline">
            {t("auth.backToLogin")}
          </Link>
        </p>
      </div>
    </main>
  );
}
