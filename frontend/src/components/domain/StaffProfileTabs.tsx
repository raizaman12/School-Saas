"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { User, IdCard } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { updateProfileSchema, updateStaffContactSchema } from "@/lib/auth/schemas";
import type { UpdateProfileFormValues, UpdateStaffContactFormValues } from "@/lib/auth/schemas";
import { ApiError } from "@/lib/api";
import { useAsync } from "@/lib/hooks/useAsync";
import { staffApi } from "@/lib/resources/staff";
import { ImageUploadButton } from "@/components/domain/ImageUploadButton";
import { Button, Input, Alert, Card, CardContent, Spinner } from "@/components/ui";
import { t } from "@/lib/i18n";

type TabKey = "about" | "bioData";

const TABS: { key: TabKey; label: string; icon: typeof User }[] = [
  { key: "about", label: "About", icon: User },
  { key: "bioData", label: "Bio Data", icon: IdCard },
];

const GENDER_LABELS: Record<string, string> = { MALE: "Male", FEMALE: "Female", OTHER: "Other" };

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <span className="text-sm text-slate-900">{value || "—"}</span>
    </div>
  );
}

/**
 * Staff dashboard's "My Profile" — used for every staff-side role
 * (TEACHER/SCHOOL_ADMIN/ACCOUNTANT/FRONT_DESK all get a StaffProfile at
 * creation/signup). ABOUT: self-editable contact info (email/phone via
 * PATCH /api/auth/me, address/emergency contact + photo via PATCH
 * /api/staff/me). BIO DATA: read-only personal detail — CNIC, date of
 * birth, gender — admin/front-desk-entered, never self-editable (per
 * product decision: official records stay admin-controlled).
 */
export function StaffProfileTabs() {
  const { user, updateProfile } = useAuth();
  const [tab, setTab] = useState<TabKey>("about");
  const { data: profile, isLoading, error, refetch } = useAsync(() => staffApi.me(), [user?.id]);

  const [contactFormError, setContactFormError] = useState<string | null>(null);
  const [contactSuccess, setContactSuccess] = useState(false);
  const {
    register: registerEmail,
    handleSubmit: handleEmailSubmit,
    formState: { errors: emailErrors, isSubmitting: isEmailSubmitting },
  } = useForm<UpdateProfileFormValues>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: { email: user?.email ?? "", phone: user?.phone ?? "" },
  });

  const [staffContactError, setStaffContactError] = useState<string | null>(null);
  const [staffContactSuccess, setStaffContactSuccess] = useState(false);
  const {
    register: registerStaffContact,
    handleSubmit: handleStaffContactSubmit,
    reset: resetStaffContact,
    formState: { errors: staffContactErrors, isSubmitting: isStaffContactSubmitting },
  } = useForm<UpdateStaffContactFormValues>({ resolver: zodResolver(updateStaffContactSchema) });

  useEffect(() => {
    if (profile) resetStaffContact({ address: profile.address ?? "", emergencyContact: profile.emergencyContact ?? "" });
  }, [profile, resetStaffContact]);

  const onSubmitEmailPhone = async (values: UpdateProfileFormValues) => {
    setContactFormError(null);
    setContactSuccess(false);
    try {
      await updateProfile({ email: values.email, phone: values.phone || undefined });
      setContactSuccess(true);
    } catch (err) {
      setContactFormError(err instanceof ApiError ? err.message : t("auth.profileSaveError"));
    }
  };

  const onSubmitStaffContact = async (values: UpdateStaffContactFormValues) => {
    setStaffContactError(null);
    setStaffContactSuccess(false);
    try {
      await staffApi.updateMe({ address: values.address || undefined, emergencyContact: values.emergencyContact || undefined });
      setStaffContactSuccess(true);
      refetch();
    } catch (err) {
      setStaffContactError(err instanceof ApiError ? err.message : t("auth.profileSaveError"));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === key
                ? "border-primary-600 text-primary-600"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            <Icon className="size-4" aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      {tab === "about" && (
        <div className="flex flex-col gap-4">
          {!error && (
            <Card>
              <CardContent className="flex items-center gap-4">
                <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary-50 text-primary-600">
                  {profile?.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={profile.photoUrl} alt="Profile" className="size-full object-cover" />
                  ) : (
                    <span className="text-lg font-semibold">{user?.fullName?.charAt(0)}</span>
                  )}
                </div>
                <ImageUploadButton
                  label={profile?.photoUrl ? "Change photo" : "Upload photo"}
                  onUploaded={(url) => staffApi.updateMe({ photoUrl: url }).then(() => refetch())}
                />
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent>
              <h3 className="mb-3 text-sm font-semibold text-slate-900">Contact Information</h3>
              <form onSubmit={handleEmailSubmit(onSubmitEmailPhone)} noValidate className="flex flex-col gap-4">
                {contactFormError && <Alert tone="danger">{contactFormError}</Alert>}
                {contactSuccess && <Alert tone="success">{t("auth.profileSaveSuccess")}</Alert>}
                <Input
                  label={t("auth.email")}
                  type="email"
                  required
                  autoComplete="email"
                  error={emailErrors.email?.message}
                  {...registerEmail("email")}
                />
                <Input
                  label={t("auth.phone")}
                  autoComplete="tel"
                  error={emailErrors.phone?.message}
                  {...registerEmail("phone")}
                />
                <div className="flex justify-end pt-2">
                  <Button type="submit" isLoading={isEmailSubmitting}>
                    {t("common.save")}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {!error && (
            <Card>
              <CardContent>
                <h3 className="mb-3 text-sm font-semibold text-slate-900">Address & Emergency Contact</h3>
                <form
                  onSubmit={handleStaffContactSubmit(onSubmitStaffContact)}
                  noValidate
                  className="flex flex-col gap-4"
                >
                  {staffContactError && <Alert tone="danger">{staffContactError}</Alert>}
                  {staffContactSuccess && <Alert tone="success">{t("auth.profileSaveSuccess")}</Alert>}
                  <Input
                    label="Present Address"
                    error={staffContactErrors.address?.message}
                    {...registerStaffContact("address")}
                  />
                  <Input
                    label="Emergency Contact"
                    placeholder="e.g. Sister - 03001234567"
                    error={staffContactErrors.emergencyContact?.message}
                    {...registerStaffContact("emergencyContact")}
                  />
                  <div className="flex justify-end pt-2">
                    <Button type="submit" isLoading={isStaffContactSubmitting}>
                      {t("common.save")}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {tab === "bioData" && (
        <Card>
          <CardContent className="flex flex-col gap-4">
            <h3 className="text-sm font-semibold text-slate-900">Personal Detail</h3>
            {isLoading && <Spinner label="Loading bio data" />}
            {!isLoading && error && (
              <p className="text-sm text-slate-500">No bio data has been recorded for this account yet.</p>
            )}
            {profile && (
              <>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <DetailRow label="Date of Birth" value={profile.dateOfBirth ? new Date(profile.dateOfBirth).toLocaleDateString() : ""} />
                  <DetailRow label="Gender" value={profile.gender ? GENDER_LABELS[profile.gender] ?? profile.gender : ""} />
                  <DetailRow label="CNIC" value={profile.cnic ?? ""} />
                  <DetailRow label="Employee Code" value={profile.employeeCode} />
                </div>
                <p className="text-xs text-slate-500">
                  These details are entered and updated by the school office — get in touch with admin/front-desk to
                  correct anything here.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
