"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { User, IdCard } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { updateStudentContactSchema } from "@/lib/auth/schemas";
import type { UpdateStudentContactFormValues } from "@/lib/auth/schemas";
import { ApiError } from "@/lib/api";
import { useAsync } from "@/lib/hooks/useAsync";
import { studentsApi } from "@/lib/resources/students";
import { Button, Input, Alert, Card, CardContent, Spinner, Badge } from "@/components/ui";
import { t } from "@/lib/i18n";

type TabKey = "about" | "bioData";

const TABS: { key: TabKey; label: string; icon: typeof User }[] = [
  { key: "about", label: "About", icon: User },
  { key: "bioData", label: "Bio Data", icon: IdCard },
];

const GENDER_LABELS: Record<string, string> = { MALE: "Male", FEMALE: "Female", OTHER: "Other" };
const RELATIONSHIP_LABELS: Record<string, string> = { FATHER: "Father", MOTHER: "Mother", GUARDIAN: "Guardian" };

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <span className="text-sm text-slate-900">{value || "—"}</span>
    </div>
  );
}

/**
 * Student portal's "My Profile". ABOUT: self-editable contact info — email,
 * phone, address, emergency contact — all via a single PATCH /api/auth/me
 * call (see updateMeSchema's doc comment for why address/emergencyContact
 * are STUDENT-only). BIO DATA: read-only personal detail (gender, DOB,
 * CNIC/B-Form, blood group) and family detail (guardians) from GET
 * /api/students/me — official records stay admin/front-desk-managed, per
 * product decision.
 */
export function StudentProfileTabs() {
  const { user, updateProfile } = useAuth();
  const [tab, setTab] = useState<TabKey>("about");
  const { data: student, isLoading, error } = useAsync(() => studentsApi.me(), [user?.id]);

  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<UpdateStudentContactFormValues>({
    resolver: zodResolver(updateStudentContactSchema),
    defaultValues: { email: user?.email ?? "", phone: "", address: "", emergencyContact: "" },
  });

  // Reset once the student's own record has loaded — a plain
  // `defaultValues` (rather than RHF's live-syncing `values` option) so
  // the form doesn't fight the user's typing on every re-render; see
  // StaffProfileTabs' staff-contact form for the same pattern.
  useEffect(() => {
    if (student) {
      reset({
        email: user?.email ?? "",
        phone: student.contactPhone ?? "",
        address: student.address ?? "",
        emergencyContact: student.emergencyContact ?? "",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student]);

  const onSubmit = async (values: UpdateStudentContactFormValues) => {
    setFormError(null);
    setSuccess(false);
    try {
      await updateProfile({
        email: values.email,
        phone: values.phone || undefined,
        address: values.address || undefined,
        emergencyContact: values.emergencyContact || undefined,
      });
      setSuccess(true);
      reset(values);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t("auth.profileSaveError"));
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
        <Card>
          <CardContent>
            <h3 className="mb-3 text-sm font-semibold text-slate-900">Contact Information</h3>
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
              <Input label={t("auth.phone")} autoComplete="tel" error={errors.phone?.message} {...register("phone")} />
              <Input label="Emergency Contact" placeholder="e.g. Uncle Tariq - 03001234567" error={errors.emergencyContact?.message} {...register("emergencyContact")} />
              <Input label="Present Address" error={errors.address?.message} {...register("address")} />
              <div className="flex justify-end pt-2">
                <Button type="submit" isLoading={isSubmitting}>
                  {t("common.save")}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {tab === "bioData" && (
        <div className="flex flex-col gap-4">
          {isLoading && <Spinner label="Loading bio data" />}
          {!isLoading && error && <p className="text-sm text-slate-500">No bio data available.</p>}
          {student && (
            <>
              <Card>
                <CardContent className="flex flex-col gap-4">
                  <h3 className="text-sm font-semibold text-slate-900">Personal Detail</h3>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <DetailRow label="Gender" value={GENDER_LABELS[student.gender] ?? student.gender} />
                    <DetailRow label="Date of Birth" value={new Date(student.dateOfBirth).toLocaleDateString()} />
                    <DetailRow label="CNIC / B-Form" value={student.bFormOrCnic ?? ""} />
                    <DetailRow label="Blood Group" value={student.healthProfile?.bloodGroup ?? ""} />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="flex flex-col gap-3">
                  <h3 className="text-sm font-semibold text-slate-900">Family Detail</h3>
                  {student.guardians.length === 0 && (
                    <p className="text-sm text-slate-500">No guardian on record yet.</p>
                  )}
                  {student.guardians.map((g) => (
                    <div key={g.guardian.id} className="flex flex-col gap-2 rounded-lg border border-slate-100 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-slate-900">{g.guardian.fullName}</span>
                        <Badge tone="default">{RELATIONSHIP_LABELS[g.guardian.relationship] ?? g.guardian.relationship}</Badge>
                        {g.isPrimary && <Badge tone="success">Primary</Badge>}
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <DetailRow label="Phone" value={g.guardian.phone} />
                        <DetailRow label="CNIC" value={g.guardian.cnic ?? ""} />
                      </div>
                    </div>
                  ))}
                  <p className="text-xs text-slate-500">
                    Personal and family details are entered and updated by the school office — get in touch with
                    admin/front-desk to correct anything here.
                  </p>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      )}
    </div>
  );
}
