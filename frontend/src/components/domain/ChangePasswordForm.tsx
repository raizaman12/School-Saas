"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAuth } from "@/lib/auth/AuthProvider";
import { changePasswordSchema, type ChangePasswordFormValues } from "@/lib/auth/schemas";
import { ApiError } from "@/lib/api";
import { Button, Input, Alert, Card, CardContent } from "@/components/ui";
import { t } from "@/lib/i18n";

/**
 * Shared "change my password" form — same endpoint/behavior for every
 * role (staff via /dashboard/change-password, PARENT/STUDENT via
 * /portal/change-password), since the password lives on the shared User
 * model regardless of role. The login email/ID never changes here.
 */
export function ChangePasswordForm({ loginHref }: { loginHref: string }) {
  const { changePassword } = useAuth();
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordFormValues>({ resolver: zodResolver(changePasswordSchema) });

  const onSubmit = async (values: ChangePasswordFormValues) => {
    setFormError(null);
    try {
      await changePassword(values);
      setSuccess(true);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t("auth.changePasswordError"));
    }
  };

  if (success) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-4">
          <Alert tone="success">{t("auth.changePasswordSuccess")}</Alert>
          <div className="flex justify-end">
            <Button type="button" onClick={() => router.push(loginHref)}>
              {t("auth.loginButton")}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
          {formError && <Alert tone="danger">{formError}</Alert>}

          <Input
            label={t("auth.currentPassword")}
            type="password"
            required
            autoComplete="current-password"
            error={errors.currentPassword?.message}
            {...register("currentPassword")}
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

          <div className="flex justify-end pt-2">
            <Button type="submit" isLoading={isSubmitting}>
              {t("auth.changePasswordButton")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
