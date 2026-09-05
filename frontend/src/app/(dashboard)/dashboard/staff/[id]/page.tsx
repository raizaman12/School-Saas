"use client";

import { use, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Pencil } from "lucide-react";
import { useAsync } from "@/lib/hooks/useAsync";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useRouter } from "next/navigation";
import { staffApi } from "@/lib/resources/staff";
import { ResetPasswordButton } from "@/components/domain/ResetPasswordButton";
import { ImageUploadButton } from "@/components/domain/ImageUploadButton";
import { ApiError } from "@/lib/api";
import {
  Button,
  Input,
  Select,
  Badge,
  Alert,
  Spinner,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  ConfirmButton,
} from "@/components/ui";

const editSchema = z.object({
  fullName: z.string().min(2, "Required").max(150),
  // Optional here too — a non-SCHOOL_ADMIN staff member may have no email
  // at all (they log in with their staff ID instead, see staff/new's
  // schema), so leaving this blank must not block saving the rest of the
  // form.
  email: z.string().email("Enter a valid email").optional().or(z.literal("")),
  phone: z.string().max(30).optional(),
  designation: z.string().min(1, "Required").max(100),
  department: z.string().max(100).optional(),
  employmentType: z.enum(["FULL_TIME", "PART_TIME", "CONTRACT"]),
  status: z.enum(["ACTIVE", "ON_LEAVE", "TERMINATED"]),
  monthlySalary: z.coerce.number().positive("Must be greater than 0"),
  cnic: z.string().max(30).optional(),
  dateOfBirth: z.string().optional().or(z.literal("")),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]).optional().or(z.literal("")),
  address: z.string().max(300).optional(),
  emergencyContact: z.string().max(100).optional(),
});
type EditFormValues = z.infer<typeof editSchema>;

const GENDER_LABELS: Record<string, string> = { MALE: "Male", FEMALE: "Female", OTHER: "Other" };

const STATUS_TONE: Record<string, "success" | "default" | "warning" | "danger"> = {
  ACTIVE: "success",
  ON_LEAVE: "warning",
  TERMINATED: "danger",
};

export default function StaffDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user: currentUser } = useAuth();
  const router = useRouter();
  // Matches the backend's PROVISION_ROLES for the reset-password route —
  // stricter than staff PATCH (SCHOOL_ADMIN only) doesn't apply here since
  // this is a different action.
  const canResetPassword = currentUser?.role === "SCHOOL_ADMIN" || currentUser?.role === "FRONT_DESK";
  // Matches the backend's DELETE_ROLES — stricter than PATCH, SCHOOL_ADMIN
  // only, since a hard-delete is irreversible (see staff.ts's doc comment
  // on why this is guarded rather than a plain cascade).
  const canDelete = currentUser?.role === "SCHOOL_ADMIN";
  // Matches the backend's WRITE_ROLES for staff PATCH (staff/staff.ts) —
  // ACCOUNTANT could view this page (payroll needs it) but had no gate at
  // all stopping them from opening the edit form, unlike Delete/reset-
  // password above which were already correctly gated.
  const canEdit = currentUser?.role === "SCHOOL_ADMIN";
  // Matches the backend's SALARY_WRITE_ROLES (PATCH /:id/salary) — a
  // narrower grant than canEdit above: an Accountant sets pay rates as
  // routine work, but shouldn't thereby get the full-edit form's power
  // over a colleague's name/status/Bio Data. SCHOOL_ADMIN doesn't need
  // this separate control since the full Edit form above already covers
  // salary.
  const canEditSalaryOnly = currentUser?.role === "ACCOUNTANT";
  const { data: staff, isLoading, error, refetch } = useAsync(() => staffApi.get(id), [id]);
  const [isEditing, setIsEditing] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isEditingSalary, setIsEditingSalary] = useState(false);
  const [salaryDraft, setSalaryDraft] = useState("");
  const [salaryError, setSalaryError] = useState<string | null>(null);
  const [isSavingSalary, setIsSavingSalary] = useState(false);

  const startEditingSalary = () => {
    if (!staff) return;
    setSalaryDraft(String(Number(staff.monthlySalary)));
    setSalaryError(null);
    setIsEditingSalary(true);
  };

  const saveSalary = async () => {
    const value = Number(salaryDraft);
    if (!Number.isFinite(value) || value <= 0) {
      setSalaryError("Enter a valid amount greater than 0.");
      return;
    }
    setIsSavingSalary(true);
    setSalaryError(null);
    try {
      await staffApi.updateSalary(id, value);
      setIsEditingSalary(false);
      refetch();
    } catch (err) {
      setSalaryError(err instanceof ApiError ? err.message : "Could not save the salary.");
    } finally {
      setIsSavingSalary(false);
    }
  };
  // Saves immediately on upload (not gated behind the Edit form / Save
  // changes button) — same pattern as the student detail page's own photo
  // control, and as the staff member's own self-service "My Profile"
  // upload. Real bug this fixes: neither this page nor the Add Staff form
  // ever let an admin set a staff member's photo at all before now, even
  // though the backend's PATCH /api/staff/:id has accepted photoUrl for a
  // while — nothing in the UI was ever wired up to send it.
  const [photoError, setPhotoError] = useState<string | null>(null);
  const onPhotoUploaded = async (url: string) => {
    setPhotoError(null);
    try {
      await staffApi.update(id, { photoUrl: url });
      refetch();
    } catch (err) {
      setPhotoError(err instanceof ApiError ? err.message : "Could not save the photo.");
    }
  };

  const onDelete = async () => {
    setDeleteError(null);
    try {
      await staffApi.remove(id);
      router.push("/dashboard/staff");
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : "Could not delete this staff member.");
      throw err; // keeps ConfirmButton's own inline error panel open too
    }
  };

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof editSchema>, unknown, EditFormValues>({ resolver: zodResolver(editSchema) });

  const startEditing = () => {
    if (!staff) return;
    reset({
      fullName: staff.user.fullName,
      email: staff.user.email ?? "",
      phone: staff.user.phone ?? "",
      designation: staff.designation,
      department: staff.department ?? "",
      employmentType: staff.employmentType,
      status: staff.status,
      monthlySalary: Number(staff.monthlySalary),
      cnic: staff.cnic ?? "",
      dateOfBirth: staff.dateOfBirth ? staff.dateOfBirth.slice(0, 10) : "",
      gender: staff.gender ?? "",
      address: staff.address ?? "",
      emergencyContact: staff.emergencyContact ?? "",
    });
    setEditError(null);
    setIsEditing(true);
  };

  const onSubmit = async (values: EditFormValues) => {
    setEditError(null);
    try {
      await staffApi.update(id, {
        ...values,
        // A blank email here just means "leave it as-is" (or "still none
        // on file" for an ID-only login) — never sent as an empty string,
        // which the backend's optional-but-validated-when-present email
        // field would reject.
        email: values.email || undefined,
        // Gender has a blank "not specified" option (Bio Data, often
        // unknown) — "" isn't a valid Gender for the backend.
        dateOfBirth: values.dateOfBirth || undefined,
        gender: values.gender || undefined,
      });
      setIsEditing(false);
      refetch();
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : "Could not save changes.");
    }
  };

  if (isLoading) return <Spinner label="Loading staff" />;
  if (error) return <Alert tone="danger">Failed to load staff: {error.message}</Alert>;
  if (!staff) return null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-page-title font-semibold text-slate-900">{staff.user.fullName}</h1>
          <p className="text-sm text-slate-500">
            {staff.employeeCode}
            {staff.user.email ? ` · ${staff.user.email}` : " · Login ID (no email on file)"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={STATUS_TONE[staff.status] ?? "default"}>{staff.status}</Badge>
          {canDelete && (
            <ConfirmButton
              triggerLabel="Delete"
              confirmLabel="Delete permanently"
              title="Delete this staff member?"
              description="This permanently removes their staff record and portal login. This cannot be undone. If they've authored other records (homework, notices, materials, ...), the delete will be blocked — use the Status field above to mark them Terminated instead."
              onConfirm={onDelete}
            />
          )}
        </div>
      </div>

      {deleteError && <Alert tone="danger">{deleteError}</Alert>}

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Profile</CardTitle>
          {canEdit && !isEditing && (
            <Button size="sm" variant="outline" onClick={startEditing}>
              <Pencil className="size-4" aria-hidden="true" />
              Edit
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex items-center gap-4">
            {staff.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- self-hosted upload URL, not a local static asset next/image can optimize
              <img
                src={staff.photoUrl}
                alt={staff.user.fullName}
                className="size-16 rounded-full border border-slate-200 object-cover"
              />
            ) : (
              <div
                className="flex size-16 items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-lg font-semibold text-slate-400"
                aria-hidden="true"
              >
                {staff.user.fullName.charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <ImageUploadButton
                label={staff.photoUrl ? "Change photo" : "Upload photo"}
                onUploaded={onPhotoUploaded}
              />
              {photoError && <p className="mt-1 text-xs text-red-600">{photoError}</p>}
            </div>
          </div>
          {isEditing ? (
            <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
              {editError && <Alert tone="danger">{editError}</Alert>}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input label="Full name" required error={errors.fullName?.message} {...register("fullName")} />
                <Input
                  label="Email"
                  type="text"
                  hint={staff.user.loginId ? "Optional — this staff member can also log in with their staff ID" : undefined}
                  error={errors.email?.message}
                  {...register("email")}
                />
                <Input label="Phone" {...register("phone")} />
                <Input label="Designation" required error={errors.designation?.message} {...register("designation")} />
                <Input label="Department" {...register("department")} />
                <Select label="Employment type" required {...register("employmentType")}>
                  <option value="FULL_TIME">Full time</option>
                  <option value="PART_TIME">Part time</option>
                  <option value="CONTRACT">Contract</option>
                </Select>
                <Select label="Status" required {...register("status")}>
                  <option value="ACTIVE">Active</option>
                  <option value="ON_LEAVE">On leave</option>
                  <option value="TERMINATED">Terminated</option>
                </Select>
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
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setIsEditing(false)}>
                  Cancel
                </Button>
                <Button type="submit" isLoading={isSubmitting}>
                  Save changes
                </Button>
              </div>
            </form>
          ) : (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <div>
                <dt className="text-slate-500">Role</dt>
                <dd className="text-slate-900">{staff.user.role}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Phone</dt>
                <dd className="text-slate-900">{staff.user.phone ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Designation</dt>
                <dd className="text-slate-900">{staff.designation}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Department</dt>
                <dd className="text-slate-900">{staff.department ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Employment type</dt>
                <dd className="text-slate-900">{staff.employmentType.replace("_", " ")}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Joining date</dt>
                <dd className="text-slate-900">{new Date(staff.joiningDate).toLocaleDateString()}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Monthly salary</dt>
                {isEditingSalary ? (
                  <dd className="mt-1 flex flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={1}
                        step="0.01"
                        className="w-32"
                        aria-label="Monthly salary (Rs)"
                        value={salaryDraft}
                        onChange={(e) => setSalaryDraft(e.target.value)}
                      />
                      <Button size="sm" onClick={saveSalary} isLoading={isSavingSalary}>
                        Save
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={isSavingSalary}
                        onClick={() => setIsEditingSalary(false)}
                      >
                        Cancel
                      </Button>
                    </div>
                    {salaryError && <p className="text-xs text-red-600">{salaryError}</p>}
                  </dd>
                ) : (
                  <dd className="flex items-center gap-1.5 text-slate-900">
                    Rs {Number(staff.monthlySalary).toLocaleString()}
                    {canEditSalaryOnly && (
                      <button
                        type="button"
                        aria-label="Edit salary"
                        className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                        onClick={startEditingSalary}
                      >
                        <Pencil className="size-3.5" aria-hidden="true" />
                      </button>
                    )}
                  </dd>
                )}
              </div>
              <div>
                <dt className="text-slate-500">Last login</dt>
                <dd className="text-slate-900">
                  {staff.user.lastLoginAt ? new Date(staff.user.lastLoginAt).toLocaleString() : "Never"}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">CNIC</dt>
                <dd className="text-slate-900">{staff.cnic ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Date of birth</dt>
                <dd className="text-slate-900">
                  {staff.dateOfBirth ? new Date(staff.dateOfBirth).toLocaleDateString() : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Gender</dt>
                <dd className="text-slate-900">{staff.gender ? GENDER_LABELS[staff.gender] ?? staff.gender : "—"}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Address</dt>
                <dd className="text-slate-900">{staff.address ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Emergency contact</dt>
                <dd className="text-slate-900">{staff.emergencyContact ?? "—"}</dd>
              </div>
              {canResetPassword && (
                <div className="col-span-2">
                  <dt className="text-slate-500">Forgot password?</dt>
                  <dd className="mt-1">
                    <ResetPasswordButton userId={staff.user.id} />
                  </dd>
                </div>
              )}
            </dl>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
