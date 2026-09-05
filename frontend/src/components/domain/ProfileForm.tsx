"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAuth } from "@/lib/auth/AuthProvider";
import { updateProfileSchema, type UpdateProfileFormValues } from "@/lib/auth/schemas";
import { ApiError } from "@/lib/api";
import { useAsync } from "@/lib/hooks/useAsync";
import { staffApi } from "@/lib/resources/staff";
import { ImageUploadButton } from "@/components/domain/ImageUploadButton";
import { Button, Input, Alert, Card, CardContent } from "@/components/ui";
import { t } from "@/lib/i18n";

/**
 * Staff-only "my profile photo" block — fetches the caller's own
 * StaffProfile (404s silently for PARENT/STUDENT, who never have one) and
 * lets them replace their photo via the same upload endpoint used for
 * student photos. Shown above the email/phone form so it reads as one
 * profile page rather than two unrelated ones.
 */
function StaffPhotoSection() {
  const { data: profile, error, refetch } = useAsync(() => staffApi.me(), []);
  // A 404 here just means this role has no StaffProfile (PARENT/STUDENT) —
  // render nothing rather than an error.
  if (error) return null;
  if (!profile) return null;

  return (
    <Card>
      <CardContent className="flex items-center gap-4">
        <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary-50 text-primary-600">
          {profile.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.photoUrl} alt="Profile" className="size-full object-cover" />
          ) : (
            <span className="text-lg font-semibold">{profile.user.fullName.charAt(0)}</span>
          )}
        </div>
        <ImageUploadButton
          label={profile.photoUrl ? "Change photo" : "Upload photo"}
          onUploaded={(url) => staffApi.updateMyPhoto(url).then(() => refetch())}
        />
      </CardContent>
    </Card>
  );
}

/**
 * Shared "edit my own email/phone" form — same endpoint/behavior for
 * every role (staff via /dashboard/profile, PARENT/STUDENT via
 * /portal/profile), since PATCH /api/auth/me branches by role server-side
 * to land "phone" on the right underlying record. Whatever is saved here
 * shows up in the admin's view immediately — no separate sync step.
 */
export function ProfileForm() {
  const { user, updateProfile } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<UpdateProfileFormValues>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: { email: user?.email ?? "", phone: user?.phone ?? "" },
  });

  const onSubmit = async (values: UpdateProfileFormValues) => {
    setFormError(null);
    setSuccess(false);
    try {
      await updateProfile({ email: values.email, phone: values.phone || undefined });
      setSuccess(true);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t("auth.profileSaveError"));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <StaffPhotoSection />

      <Card>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
            {formError && <Alert tone="danger">{formError}</Alert>}
            {success && <Alert tone="success">{t("auth.profileSaveSuccess")}</Alert>}

            <Input
              label={t("auth.email")}
              type="email"
              required
              autoComplete="email"
              error={errors.email?.message}
              {...register("email")}
            />
            <Input
              label={t("auth.phone")}
              autoComplete="tel"
              error={errors.phone?.message}
              {...register("phone")}
            />

            <div className="flex justify-end pt-2">
              <Button type="submit" isLoading={isSubmitting}>
                {t("common.save")}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
