"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Copy, Check } from "lucide-react";
import { staffApi } from "@/lib/resources/staff";
import { ApiError } from "@/lib/api";
import { ImageUploadButton } from "@/components/domain/ImageUploadButton";
import { Button, Input, Select, Alert, Card, CardContent } from "@/components/ui";

const schema = z
  .object({
    fullName: z.string().min(2, "Required").max(150),
    // Optional for every role except SCHOOL_ADMIN (see the refine below) —
    // a TEACHER/ACCOUNTANT/FRONT_DESK now logs in with their own staff ID
    // instead, no email needed at all.
    email: z.string().email("Enter a valid email").optional().or(z.literal("")),
    phone: z.string().max(30).optional(),
    role: z.enum(["TEACHER", "ACCOUNTANT", "FRONT_DESK", "SCHOOL_ADMIN"]),
    designation: z.string().min(1, "Required").max(100),
    department: z.string().max(100).optional(),
    employmentType: z.enum(["FULL_TIME", "PART_TIME", "CONTRACT"]),
    joiningDate: z.string().min(1, "Required"),
    cnic: z.string().max(30).optional(),
    dateOfBirth: z.string().optional().or(z.literal("")),
    gender: z.enum(["MALE", "FEMALE", "OTHER"]).optional().or(z.literal("")),
    address: z.string().max(300).optional(),
    emergencyContact: z.string().max(100).optional(),
    monthlySalary: z.coerce.number().positive("Must be greater than 0"),
  })
  .refine((data) => data.role !== "SCHOOL_ADMIN" || !!data.email, {
    message: "An email is required for the School Admin role",
    path: ["email"],
  });
type FormValues = z.infer<typeof schema>;

export default function NewStaffPage() {
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<{
    id: string;
    fullName: string;
    tempPassword: string;
    email: string | null;
    loginId: string | null;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  // Kept outside the react-hook-form schema, same as MaterialsTab's
  // pendingFile — an uploaded image URL, not a typed/validated form field.
  // This is what was actually missing before: the form had nowhere to even
  // pick a photo, so createStaffSchema on the backend had no photoUrl to
  // receive, so a newly-added staff member's photo could never show up on
  // the admin's own Staff Detail page — only the staff member's own
  // self-service "My Profile" upload (a completely separate flow) worked.
  const [pendingPhotoUrl, setPendingPhotoUrl] = useState<string | null>(null);
  // Tracked separately from react-hook-form's own state (rather than via
  // its watch()) purely so the Email field's required/hint can react to
  // it — watch() returns a function the React Compiler can't safely
  // memoize, which isn't worth the tradeoff for one derived boolean.
  const [role, setRole] = useState<FormValues["role"]>("TEACHER");
  const isSchoolAdmin = role === "SCHOOL_ADMIN";

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof schema>, unknown, FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { role: "TEACHER", employmentType: "FULL_TIME" },
  });

  const onSubmit = async (values: FormValues) => {
    setFormError(null);
    try {
      const res = await staffApi.create({
        ...values,
        email: values.email || undefined,
        // The Gender <select> has a blank "not specified" option (it's
        // Bio Data — often unknown/skipped at hiring) — "" isn't a valid
        // Gender for the backend, so it's normalized to "not provided"
        // here rather than sent through.
        dateOfBirth: values.dateOfBirth || undefined,
        gender: values.gender || undefined,
        photoUrl: pendingPhotoUrl ?? undefined,
      });
      setCreated({
        id: res.data.id,
        fullName: res.data.user.fullName,
        tempPassword: res.tempPassword,
        email: res.data.user.email,
        // Shown as the human-readable employeeCode (e.g. "EDU-EMP-000001"),
        // not the normalized loginId it's matched against — dashes/case
        // don't matter at login time (see lib/loginId.ts), so this is
        // easier to read and hand to the new staff member.
        loginId: res.data.user.loginId ? res.data.employeeCode : null,
      });
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    }
  };

  if (created) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-page-title font-semibold text-slate-900">Staff added</h1>
        <Card>
          <CardContent className="flex flex-col gap-4">
            <Alert tone="success" title={`${created.fullName} has been added`}>
              {created.loginId
                ? "Share their login ID and this one-time temporary password so they can log in. Neither will be shown again."
                : "Share this one-time temporary password with them so they can log in. It will not be shown again."}
            </Alert>
            {created.loginId && (
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-slate-700">Login ID</span>
                <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 font-mono text-sm">
                  <span className="flex-1 select-all">{created.loginId}</span>
                </div>
                {created.email && (
                  <p className="text-xs text-slate-500">
                    They can also log in with their email, {created.email}.
                  </p>
                )}
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-slate-700">Temporary password</span>
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 font-mono text-sm">
                <span className="flex-1 select-all">{created.tempPassword}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    navigator.clipboard?.writeText(created.tempPassword);
                    setCopied(true);
                  }}
                >
                  {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Link href="/dashboard/staff">
                <Button type="button" variant="outline">
                  Back to staff list
                </Button>
              </Link>
              <Link href={`/dashboard/staff/${created.id}`}>
                <Button type="button">View staff profile</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-page-title font-semibold text-slate-900">Add staff</h1>

      <Card>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
            {formError && <Alert tone="danger">{formError}</Alert>}

            <div className="flex items-center gap-4">
              {pendingPhotoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- self-hosted upload URL, not a local static asset next/image can optimize
                <img
                  src={pendingPhotoUrl}
                  alt="Staff"
                  className="size-16 rounded-full border border-slate-200 object-cover"
                />
              ) : (
                <div
                  className="flex size-16 items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-lg font-semibold text-slate-400"
                  aria-hidden="true"
                >
                  ?
                </div>
              )}
              <ImageUploadButton
                label={pendingPhotoUrl ? "Change photo" : "Upload photo (optional)"}
                onUploaded={setPendingPhotoUrl}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input label="Full name" required error={errors.fullName?.message} {...register("fullName")} />
              <Input
                label="Email"
                type="text"
                required={isSchoolAdmin}
                hint={
                  isSchoolAdmin
                    ? undefined
                    : "Optional — leave blank and they'll log in with their staff ID instead"
                }
                error={errors.email?.message}
                {...register("email")}
              />
              <Input label="Phone" {...register("phone")} />
              <Select
                label="Role"
                required
                error={errors.role?.message}
                {...register("role", { onChange: (e) => setRole(e.target.value as FormValues["role"]) })}
              >
                <option value="TEACHER">Teacher</option>
                <option value="ACCOUNTANT">Accountant</option>
                <option value="FRONT_DESK">Front desk</option>
                <option value="SCHOOL_ADMIN">School admin</option>
              </Select>
              <Input label="Designation" required error={errors.designation?.message} {...register("designation")} />
              <Input label="Department" {...register("department")} />
              <Select label="Employment type" required {...register("employmentType")}>
                <option value="FULL_TIME">Full time</option>
                <option value="PART_TIME">Part time</option>
                <option value="CONTRACT">Contract</option>
              </Select>
              <Input
                label="Joining date"
                type="date"
                required
                error={errors.joiningDate?.message}
                {...register("joiningDate")}
              />
              <Input
                label="Monthly salary (Rs)"
                type="number"
                required
                error={errors.monthlySalary?.message}
                {...register("monthlySalary")}
              />
              <Input label="CNIC" {...register("cnic")} />
              <Input label="Date of birth" type="date" {...register("dateOfBirth")} />
              <Select label="Gender" {...register("gender")}>
                <option value="">Not specified</option>
                <option value="MALE">Male</option>
                <option value="FEMALE">Female</option>
                <option value="OTHER">Other</option>
              </Select>
              <Input label="Address" {...register("address")} />
              <Input label="Emergency contact" {...register("emergencyContact")} />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Link href="/dashboard/staff">
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </Link>
              <Button type="submit" isLoading={isSubmitting}>
                Save staff
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
