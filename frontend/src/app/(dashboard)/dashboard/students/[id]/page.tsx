"use client";

import { use, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { UserPlus, Copy, Check, Printer, FileDown, FileOutput, Pencil, ShieldAlert, HeartHandshake, MessageSquarePlus, HeartPulse, Save } from "lucide-react";
import { useAsync } from "@/lib/hooks/useAsync";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useRouter } from "next/navigation";
import { studentsApi, type PortalLogin } from "@/lib/resources/students";
import { guardiansApi } from "@/lib/resources/guardians";
import { feesApi } from "@/lib/resources/fees";
import { attendanceApi } from "@/lib/resources/attendance";
import {
  disciplineApi,
  DISCIPLINE_CATEGORY_LABEL,
  DISCIPLINE_ACTION_LABEL,
  type DisciplineSeverity,
} from "@/lib/resources/discipline";
import {
  transferCertificatesApi,
  type TransferCertificateReason,
} from "@/lib/resources/transferCertificates";
import {
  supportNeedsApi,
  SUPPORT_NEED_CATEGORY_LABEL,
  SUPPORT_NEED_STATUS_LABEL,
  type SupportNeedStatus,
} from "@/lib/resources/supportNeeds";
import { healthApi, BLOOD_GROUP_LABEL, HEALTH_LOG_OUTCOME_LABEL } from "@/lib/resources/health";
import { customFieldsApi } from "@/lib/resources/customFields";
import { ResetPasswordButton } from "@/components/domain/ResetPasswordButton";
import { ImageUploadButton } from "@/components/domain/ImageUploadButton";
import { ApiError, downloadFile } from "@/lib/api";
import {
  Button,
  Input,
  Select,
  Textarea,
  Badge,
  Alert,
  Spinner,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
  EmptyState,
  ConfirmButton,
} from "@/components/ui";

const editProfileSchema = z.object({
  fullName: z.string().min(2, "Required").max(150),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]),
  dateOfBirth: z.string().min(1, "Required"),
  bFormOrCnic: z
    .string()
    .regex(/^\d{5}-\d{7}-\d$/, "Expected format: 35202-1234567-1")
    .optional()
    .or(z.literal("")),
  contactPhone: z.string().max(30).optional().or(z.literal("")),
  address: z.string().max(255).optional().or(z.literal("")),
  emergencyContact: z.string().max(100).optional().or(z.literal("")),
  city: z.string().max(100).optional().or(z.literal("")),
  rollNumber: z.string().max(20).optional().or(z.literal("")),
  status: z.enum(["ACTIVE", "INACTIVE", "GRADUATED", "TRANSFERRED_OUT", "EXPELLED"]),
});
type EditProfileFormValues = z.infer<typeof editProfileSchema>;

const emailSchema = z.object({ email: z.string().email("Enter a valid email") });
type EmailFormValues = z.infer<typeof emailSchema>;

const guardianSchema = z.object({
  fullName: z.string().min(2, "Required").max(150),
  relationship: z.enum(["FATHER", "MOTHER", "GUARDIAN"]),
  phone: z.string().min(7, "Required").max(30),
  email: z.string().email().optional().or(z.literal("")),
});
type GuardianFormValues = z.infer<typeof guardianSchema>;

const disciplineSchema = z.object({
  incidentDate: z.string().min(1, "Required"),
  category: z.enum([
    "UNIFORM_VIOLATION",
    "LATE_ARRIVAL",
    "MISSED_HOMEWORK",
    "DISRUPTIVE_BEHAVIOR",
    "DISRESPECT_TO_STAFF",
    "BULLYING",
    "FIGHTING",
    "CHEATING",
    "PROPERTY_DAMAGE",
    "UNAUTHORIZED_ABSENCE",
    "MOBILE_PHONE_VIOLATION",
    "OTHER",
  ]),
  severity: z.enum(["MINOR", "MODERATE", "MAJOR"]),
  description: z.string().min(2, "Required").max(2000),
  actionTaken: z
    .enum([
      "NONE",
      "VERBAL_WARNING",
      "WRITTEN_WARNING",
      "DETENTION",
      "PARENT_CALLED",
      "PARENT_MEETING_REQUIRED",
      "SUSPENSION",
      "REFERRED_TO_PRINCIPAL",
    ])
    .optional(),
  notifyGuardianNow: z.boolean().optional(),
});
type DisciplineFormValues = z.infer<typeof disciplineSchema>;

const SEVERITY_TONE: Record<DisciplineSeverity, "default" | "warning" | "danger"> = {
  MINOR: "default",
  MODERATE: "warning",
  MAJOR: "danger",
};

const supportNeedSchema = z.object({
  category: z.enum([
    "LEARNING_SUPPORT",
    "ATTENTION_FOCUS_SUPPORT",
    "SPEECH_LANGUAGE_SUPPORT",
    "HEARING_SUPPORT",
    "VISION_SUPPORT",
    "MOBILITY_PHYSICAL_SUPPORT",
    "SOCIAL_EMOTIONAL_SUPPORT",
    "AUTISM_SPECTRUM_SUPPORT",
    "INTELLECTUAL_DEVELOPMENTAL_SUPPORT",
    "GIFTED_TALENTED_SUPPORT",
    "OTHER",
  ]),
  description: z.string().min(2, "Required").max(2000),
  identifiedDate: z.string().min(1, "Required"),
  supportProvided: z.string().min(2, "Required").max(2000),
  examAccommodations: z.string().max(1000).optional(),
  nextReviewDate: z.string().optional(),
});
type SupportNeedFormValues = z.infer<typeof supportNeedSchema>;

const supportNeedReviewSchema = z.object({
  reviewDate: z.string().min(1, "Required"),
  notes: z.string().min(2, "Required").max(2000),
  // .or(z.literal("")) — the "Leave unchanged" option submits an empty
  // string, which z.enum(...).optional() alone would reject (it only
  // treats `undefined` as absent, not ""), silently blocking the form.
  updatedStatus: z.enum(["ACTIVE", "UNDER_REVIEW", "RESOLVED", "DISCONTINUED"]).optional().or(z.literal("")),
});
type SupportNeedReviewFormValues = z.infer<typeof supportNeedReviewSchema>;

const SUPPORT_NEED_STATUS_TONE: Record<SupportNeedStatus, "default" | "warning" | "success" | "danger"> = {
  ACTIVE: "default",
  UNDER_REVIEW: "warning",
  RESOLVED: "success",
  DISCONTINUED: "danger",
};

const healthProfileSchema = z.object({
  // .or(z.literal("")) — the "Not recorded" option submits an empty
  // string, which z.enum(...).optional() alone would reject (it only
  // treats `undefined` as absent, not ""), silently blocking the form.
  bloodGroup: z
    .enum(["A_POSITIVE", "A_NEGATIVE", "B_POSITIVE", "B_NEGATIVE", "AB_POSITIVE", "AB_NEGATIVE", "O_POSITIVE", "O_NEGATIVE", "UNKNOWN"])
    .optional()
    .or(z.literal("")),
  allergies: z.string().max(1000).optional(),
  chronicConditions: z.string().max(1000).optional(),
  currentMedications: z.string().max(1000).optional(),
  emergencyMedicalNotes: z.string().max(2000).optional(),
  emergencyContactName: z.string().max(150).optional(),
  emergencyContactPhone: z.string().max(30).optional(),
  doctorName: z.string().max(150).optional(),
  doctorPhone: z.string().max(30).optional(),
});
type HealthProfileFormValues = z.infer<typeof healthProfileSchema>;

const healthLogSchema = z.object({
  visitDate: z.string().min(1, "Required"),
  complaint: z.string().min(2, "Required").max(1000),
  actionTaken: z.string().min(2, "Required").max(1000),
  outcome: z.enum(["RETURNED_TO_CLASS", "SENT_HOME", "TAKEN_TO_HOSPITAL", "PARENT_CALLED_TO_COLLECT"]).optional(),
  notifyGuardianNow: z.boolean().optional(),
});
type HealthLogFormValues = z.infer<typeof healthLogSchema>;

const tcSchema = z.object({
  reason: z.enum(["PARENT_REQUEST", "RELOCATION", "ACADEMIC", "DISCIPLINARY", "GRADUATED", "OTHER"]),
  lastAttendanceDate: z.string().optional(),
  conduct: z.string().max(50).optional(),
  remarks: z.string().max(500).optional(),
});
type TcFormValues = z.infer<typeof tcSchema>;

const TC_REASON_LABEL: Record<TransferCertificateReason, string> = {
  PARENT_REQUEST: "Parent request",
  RELOCATION: "Relocation",
  ACADEMIC: "Academic",
  DISCIPLINARY: "Disciplinary",
  GRADUATED: "Graduated",
  OTHER: "Other",
};

/** Inline edit-in-place for a guardian's (parent's) email — also updates their portal login email if they have one. */
function GuardianEmailCell({
  guardianId,
  email,
  canEdit,
  onSaved,
}: {
  guardianId: string;
  email: string | null;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState(email ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  if (!isEditing) {
    return (
      <span className="flex items-center gap-2">
        {email ?? "—"}
        {canEdit && (
          <button type="button" className="text-primary-600 hover:underline" onClick={() => { setValue(email ?? ""); setError(null); setIsEditing(true); }}>
            Edit
          </button>
        )}
      </span>
    );
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSaving(true);
    try {
      await guardiansApi.update(guardianId, { email: value });
      setIsEditing(false);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save email.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <input
          type="email"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="focus-ring w-48 rounded-md border border-slate-300 px-2 py-1 text-sm"
          required
        />
        <Button type="submit" size="sm" isLoading={isSaving}>
          Save
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setIsEditing(false)}>
          Cancel
        </Button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </form>
  );
}

/** Inline "add a periodic review" form for one learning support plan — mirrors the standalone support-needs page's AddReviewForm. */
function SupportNeedReviewForm({
  supportNeedId,
  onAdded,
  onCancel,
}: {
  supportNeedId: string;
  onAdded: () => void;
  onCancel: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SupportNeedReviewFormValues>({
    resolver: zodResolver(supportNeedReviewSchema),
    defaultValues: { reviewDate: new Date().toISOString().slice(0, 10) },
  });

  const onSubmit = async (values: SupportNeedReviewFormValues) => {
    setError(null);
    try {
      await supportNeedsApi.addReview(supportNeedId, {
        ...values,
        updatedStatus: values.updatedStatus || undefined,
      });
      onAdded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add this review.");
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-3 rounded-lg border border-slate-200 p-3">
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input
          label="Review date"
          type="date"
          required
          error={errors.reviewDate?.message}
          {...register("reviewDate")}
        />
        <Select label="Update status to" {...register("updatedStatus")}>
          <option value="">Leave unchanged</option>
          {Object.entries(SUPPORT_NEED_STATUS_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </div>
      <Textarea label="Review notes" required error={errors.notes?.message} {...register("notes")} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" isLoading={isSubmitting}>
          Add review
        </Button>
      </div>
    </form>
  );
}

/**
 * Self-contained (fetches and saves on its own) rather than threaded
 * through the parent page's state — the set of fields is dynamic
 * (school-defined), so there's no fixed zod schema to register into the
 * page's own react-hook-form the way the other cards do. Local state
 * keyed by fieldDefinitionId instead, saved as one bulk PUT.
 */
function CustomFieldsCard({ studentId, canEdit }: { studentId: string; canEdit: boolean }) {
  const { data: rows, isLoading, refetch } = useAsync(() => customFieldsApi.getStudentValues(studentId), [studentId]);
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const isEditing = draft !== null;

  const startEditing = () => {
    setSaved(false);
    setError(null);
    setDraft(Object.fromEntries((rows ?? []).map((r) => [r.fieldDefinitionId, r.value ?? ""])));
  };

  const onSave = async () => {
    if (!draft) return;
    setError(null);
    setIsSaving(true);
    try {
      await customFieldsApi.saveStudentValues(
        studentId,
        Object.entries(draft).map(([fieldDefinitionId, value]) => ({ fieldDefinitionId, value })),
      );
      setDraft(null);
      setSaved(true);
      refetch();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save these fields.");
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Custom fields</CardTitle>
        </CardHeader>
        <CardContent>
          <Spinner label="Loading custom fields" />
        </CardContent>
      </Card>
    );
  }

  // No fields defined for this school at all — don't show an empty card;
  // there's nothing useful to say beyond "go to Custom Fields in the nav".
  if (!rows || rows.length === 0) return null;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Custom fields</CardTitle>
        {canEdit && !isEditing && (
          <Button variant="outline" size="sm" onClick={startEditing}>
            <Pencil className="size-4" aria-hidden="true" />
            Edit
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error && <Alert tone="danger">{error}</Alert>}
        {saved && !isEditing && <Alert tone="success">Custom fields saved.</Alert>}

        {isEditing ? (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {rows.map((row) => {
                const value = draft[row.fieldDefinitionId] ?? "";
                const setValue = (v: string) => setDraft({ ...draft, [row.fieldDefinitionId]: v });
                const label = `${row.label}${row.active ? "" : " (retired field)"}`;
                if (row.fieldType === "BOOLEAN") {
                  return (
                    <Select
                      key={row.fieldDefinitionId}
                      label={label}
                      required={row.required}
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                    >
                      <option value="">Not recorded</option>
                      <option value="true">Yes</option>
                      <option value="false">No</option>
                    </Select>
                  );
                }
                if (row.fieldType === "SELECT") {
                  return (
                    <Select
                      key={row.fieldDefinitionId}
                      label={label}
                      required={row.required}
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                    >
                      <option value="">Not recorded</option>
                      {(row.options ?? []).map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </Select>
                  );
                }
                return (
                  <Input
                    key={row.fieldDefinitionId}
                    label={label}
                    required={row.required}
                    type={row.fieldType === "NUMBER" ? "number" : row.fieldType === "DATE" ? "date" : "text"}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                  />
                );
              })}
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setDraft(null)}>
                Cancel
              </Button>
              <Button type="button" size="sm" isLoading={isSaving} onClick={onSave}>
                Save
              </Button>
            </div>
          </>
        ) : (
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {rows.map((row) => (
              <div key={row.fieldDefinitionId}>
                <dt className="text-slate-500">{row.label}</dt>
                <dd className="text-slate-900">
                  {row.value === null
                    ? "—"
                    : row.fieldType === "BOOLEAN"
                      ? row.value === "true"
                        ? "Yes"
                        : "No"
                      : row.value}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

export default function StudentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useAuth();
  const router = useRouter();
  // Only these roles may issue a transfer certificate — mirrors the
  // backend's WRITE_ROLES in transferCertificates.ts.
  const canIssueTc = user?.role === "SCHOOL_ADMIN" || user?.role === "FRONT_DESK";
  // Editing profile fields/email uses the same backend WRITE_ROLES; delete
  // is restricted further, to SCHOOL_ADMIN only (see backend DELETE_ROLES).
  const canEdit = user?.role === "SCHOOL_ADMIN" || user?.role === "FRONT_DESK";
  const canDelete = user?.role === "SCHOOL_ADMIN";
  // Matches discipline.ts's WRITE_ROLES — a different set from canEdit
  // above (FRONT_DESK edits the student's own profile fields but doesn't
  // log conduct incidents; that's a teacher/admin judgment call).
  const canLogDiscipline = user?.role === "SCHOOL_ADMIN" || user?.role === "TEACHER";
  // Matches supportNeeds.ts's WRITE_ROLES — same role set as discipline,
  // but recall the READ side is tighter (no FRONT_DESK) since this data is
  // more sensitive.
  const canLogSupportNeed = user?.role === "SCHOOL_ADMIN" || user?.role === "TEACHER";
  // Matches health.ts's PROFILE_WRITE_ROLES / LOG_WRITE_ROLES — the health
  // *profile* (blood group/allergies/emergency contacts) is office-
  // maintained (no TEACHER write); a first-aid *visit log entry* can be
  // written by whoever attended to the student, including a TEACHER.
  const canEditHealthProfile = user?.role === "SCHOOL_ADMIN" || user?.role === "FRONT_DESK";
  // Matches customFields.ts's VALUE_WRITE_ROLES.
  const canEditCustomFields = user?.role === "SCHOOL_ADMIN" || user?.role === "FRONT_DESK";
  const canLogHealthVisit = user?.role === "SCHOOL_ADMIN" || user?.role === "FRONT_DESK" || user?.role === "TEACHER";
  const { data: student, isLoading, error, refetch } = useAsync(() => studentsApi.get(id), [id]);
  const { data: ledger } = useAsync(() => feesApi.studentLedger(id), [id]);
  const { data: attendance } = useAsync(() => attendanceApi.studentHistory(id), [id]);
  const {
    data: transferCertificates,
    refetch: refetchTcs,
  } = useAsync(() => transferCertificatesApi.listForStudent(id), [id]);
  const { data: disciplineRecords, refetch: refetchDiscipline } = useAsync(
    () => disciplineApi.list({ studentId: id, limit: 50 }).then((r) => r.data),
    [id],
  );
  const { data: supportNeeds, refetch: refetchSupportNeeds } = useAsync(
    () => supportNeedsApi.list({ studentId: id, limit: 50 }).then((r) => r.data),
    [id],
  );
  const { data: healthProfile, refetch: refetchHealthProfile } = useAsync(() => healthApi.getProfile(id), [id]);
  const { data: healthLogEntries, refetch: refetchHealthLog } = useAsync(
    () => healthApi.listLogEntries({ studentId: id, limit: 10 }).then((r) => r.data),
    [id],
  );
  // The list is ordered newest-first (see backend) — the first not-yet-
  // voided entry is the only one the "Undo this transfer" action may void.
  const latestVoidableTc = transferCertificates?.find((tc) => !tc.voidedAt) ?? null;

  const [showGuardianForm, setShowGuardianForm] = useState(false);
  const [guardianError, setGuardianError] = useState<string | null>(null);
  const [newGuardianLogin, setNewGuardianLogin] = useState<PortalLogin | null>(null);
  const [copied, setCopied] = useState(false);

  const [showEditForm, setShowEditForm] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const {
    register: registerEdit,
    handleSubmit: handleEditSubmit,
    reset: resetEdit,
    formState: { errors: editErrors, isSubmitting: isEditSubmitting },
  } = useForm<EditProfileFormValues>({ resolver: zodResolver(editProfileSchema) });

  const openEditForm = () => {
    // The trigger button is already hidden once ARCHIVED (see canEdit's
    // usage below) — this guard just keeps the status field's type honest,
    // since editProfileSchema's status enum deliberately has no ARCHIVED
    // option to reset the form into.
    if (!student || student.status === "ARCHIVED") return;
    resetEdit({
      fullName: student.fullName,
      gender: student.gender,
      dateOfBirth: student.dateOfBirth.slice(0, 10),
      bFormOrCnic: student.bFormOrCnic ?? "",
      contactPhone: student.contactPhone ?? "",
      address: student.address ?? "",
      emergencyContact: student.emergencyContact ?? "",
      city: student.city ?? "",
      rollNumber: student.rollNumber ?? "",
      status: student.status,
    });
    setEditError(null);
    setShowEditForm(true);
  };

  const onEditProfile = async (values: EditProfileFormValues) => {
    setEditError(null);
    try {
      await studentsApi.update(id, {
        fullName: values.fullName,
        gender: values.gender,
        dateOfBirth: values.dateOfBirth,
        bFormOrCnic: values.bFormOrCnic || undefined,
        contactPhone: values.contactPhone || undefined,
        address: values.address || undefined,
        emergencyContact: values.emergencyContact || undefined,
        city: values.city || undefined,
        rollNumber: values.rollNumber || undefined,
        status: values.status,
      });
      setShowEditForm(false);
      refetch();
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : "Could not save changes.");
    }
  };

  const [showEmailForm, setShowEmailForm] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const {
    register: registerEmail,
    handleSubmit: handleEmailSubmit,
    reset: resetEmail,
    formState: { errors: emailErrors, isSubmitting: isEmailSubmitting },
  } = useForm<EmailFormValues>({ resolver: zodResolver(emailSchema) });

  const onEditEmail = async (values: EmailFormValues) => {
    setEmailError(null);
    try {
      await studentsApi.update(id, { email: values.email });
      setShowEmailForm(false);
      refetch();
    } catch (err) {
      setEmailError(err instanceof ApiError ? err.message : "Could not save email.");
    }
  };

  const [photoError, setPhotoError] = useState<string | null>(null);
  const onPhotoUploaded = async (url: string) => {
    setPhotoError(null);
    try {
      await studentsApi.update(id, { photoUrl: url });
      refetch();
    } catch (err) {
      setPhotoError(err instanceof ApiError ? err.message : "Could not save the photo.");
    }
  };

  const [deleteError, setDeleteError] = useState<string | null>(null);
  const onDelete = async () => {
    setDeleteError(null);
    try {
      await studentsApi.remove(id);
      router.push("/dashboard/students");
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : "Could not archive student.");
      throw err;
    }
  };

  const [isPrintingAdmissionForm, setIsPrintingAdmissionForm] = useState(false);
  const [attendanceFrom, setAttendanceFrom] = useState("");
  const [attendanceTo, setAttendanceTo] = useState("");
  const [isPrintingAttendance, setIsPrintingAttendance] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);

  const [showDisciplineForm, setShowDisciplineForm] = useState(false);
  const [disciplineError, setDisciplineError] = useState<string | null>(null);
  const {
    register: registerDiscipline,
    handleSubmit: handleDisciplineSubmit,
    reset: resetDiscipline,
    formState: { errors: disciplineErrors, isSubmitting: isDisciplineSubmitting },
  } = useForm<DisciplineFormValues>({
    resolver: zodResolver(disciplineSchema),
    defaultValues: { severity: "MINOR", category: "OTHER", incidentDate: new Date().toISOString().slice(0, 10) },
  });

  const onLogDiscipline = async (values: DisciplineFormValues) => {
    setDisciplineError(null);
    try {
      await disciplineApi.create({ ...values, studentId: id });
      resetDiscipline({ severity: "MINOR", category: "OTHER", incidentDate: new Date().toISOString().slice(0, 10) });
      setShowDisciplineForm(false);
      refetchDiscipline();
    } catch (err) {
      setDisciplineError(err instanceof ApiError ? err.message : "Could not log this incident.");
    }
  };

  const markDisciplineResolved = async (recordId: string) => {
    setDisciplineError(null);
    try {
      await disciplineApi.update(recordId, { resolved: true });
      refetchDiscipline();
    } catch (err) {
      setDisciplineError(err instanceof ApiError ? err.message : "Could not update this record.");
    }
  };

  const [showSupportNeedForm, setShowSupportNeedForm] = useState(false);
  const [supportNeedError, setSupportNeedError] = useState<string | null>(null);
  const [reviewingSupportNeedId, setReviewingSupportNeedId] = useState<string | null>(null);
  const {
    register: registerSupportNeed,
    handleSubmit: handleSupportNeedSubmit,
    reset: resetSupportNeed,
    formState: { errors: supportNeedErrors, isSubmitting: isSupportNeedSubmitting },
  } = useForm<SupportNeedFormValues>({
    resolver: zodResolver(supportNeedSchema),
    defaultValues: { category: "LEARNING_SUPPORT", identifiedDate: new Date().toISOString().slice(0, 10) },
  });

  const onLogSupportNeed = async (values: SupportNeedFormValues) => {
    setSupportNeedError(null);
    try {
      await supportNeedsApi.create({
        ...values,
        studentId: id,
        examAccommodations: values.examAccommodations || undefined,
        nextReviewDate: values.nextReviewDate || undefined,
      });
      resetSupportNeed({ category: "LEARNING_SUPPORT", identifiedDate: new Date().toISOString().slice(0, 10) });
      setShowSupportNeedForm(false);
      refetchSupportNeeds();
    } catch (err) {
      setSupportNeedError(err instanceof ApiError ? err.message : "Could not save this learning support plan.");
    }
  };

  const [showHealthProfileForm, setShowHealthProfileForm] = useState(false);
  const [healthProfileError, setHealthProfileError] = useState<string | null>(null);
  const [healthProfileSaved, setHealthProfileSaved] = useState(false);
  const {
    register: registerHealthProfile,
    handleSubmit: handleHealthProfileSubmit,
    formState: { isSubmitting: isHealthProfileSubmitting },
  } = useForm<HealthProfileFormValues>({ resolver: zodResolver(healthProfileSchema) });

  const onSaveHealthProfile = async (values: HealthProfileFormValues) => {
    setHealthProfileError(null);
    try {
      await healthApi.saveProfile(id, {
        ...values,
        bloodGroup: values.bloodGroup || undefined,
        allergies: values.allergies || undefined,
        chronicConditions: values.chronicConditions || undefined,
        currentMedications: values.currentMedications || undefined,
        emergencyMedicalNotes: values.emergencyMedicalNotes || undefined,
        emergencyContactName: values.emergencyContactName || undefined,
        emergencyContactPhone: values.emergencyContactPhone || undefined,
        doctorName: values.doctorName || undefined,
        doctorPhone: values.doctorPhone || undefined,
      });
      setHealthProfileSaved(true);
      refetchHealthProfile();
    } catch (err) {
      setHealthProfileError(err instanceof ApiError ? err.message : "Could not save this health profile.");
    }
  };

  const [showHealthLogForm, setShowHealthLogForm] = useState(false);
  const [healthLogError, setHealthLogError] = useState<string | null>(null);
  const {
    register: registerHealthLog,
    handleSubmit: handleHealthLogSubmit,
    reset: resetHealthLog,
    formState: { errors: healthLogErrors, isSubmitting: isHealthLogSubmitting },
  } = useForm<HealthLogFormValues>({
    resolver: zodResolver(healthLogSchema),
    defaultValues: { visitDate: new Date().toISOString().slice(0, 10) },
  });

  const onLogHealthVisit = async (values: HealthLogFormValues) => {
    setHealthLogError(null);
    try {
      await healthApi.createLogEntry({ ...values, studentId: id });
      resetHealthLog({ visitDate: new Date().toISOString().slice(0, 10) });
      setShowHealthLogForm(false);
      refetchHealthLog();
    } catch (err) {
      setHealthLogError(err instanceof ApiError ? err.message : "Could not log this visit.");
    }
  };

  const [showTcForm, setShowTcForm] = useState(false);
  const [tcError, setTcError] = useState<string | null>(null);
  const [isPrintingTc, setIsPrintingTc] = useState<string | null>(null);
  const {
    register: registerTc,
    handleSubmit: handleTcSubmit,
    reset: resetTc,
    formState: { errors: tcErrors, isSubmitting: isTcSubmitting },
  } = useForm<TcFormValues>({ resolver: zodResolver(tcSchema), defaultValues: { reason: "PARENT_REQUEST" } });

  const onIssueTc = async (values: TcFormValues) => {
    setTcError(null);
    try {
      await transferCertificatesApi.issue(id, {
        reason: values.reason,
        lastAttendanceDate: values.lastAttendanceDate || undefined,
        conduct: values.conduct || undefined,
        remarks: values.remarks || undefined,
      });
      resetTc();
      setShowTcForm(false);
      refetchTcs();
      refetch();
    } catch (err) {
      setTcError(err instanceof ApiError ? err.message : "Could not issue the transfer certificate.");
    }
  };

  const printTc = async (tcId: string, tcNumber: string) => {
    setTcError(null);
    setIsPrintingTc(tcId);
    try {
      await downloadFile(`/api/transfer-certificates/${tcId}/pdf`, `${tcNumber}.pdf`);
    } catch (err) {
      setTcError(err instanceof ApiError ? err.message : "Could not generate the transfer certificate.");
    } finally {
      setIsPrintingTc(null);
    }
  };

  const onVoidTc = async (tcId: string) => {
    setTcError(null);
    try {
      await transferCertificatesApi.void(tcId);
      refetchTcs();
      refetch();
    } catch (err) {
      setTcError(err instanceof ApiError ? err.message : "Could not undo this transfer certificate.");
      throw err; // keeps ConfirmButton's own inline error panel open too
    }
  };

  const printAdmissionForm = async () => {
    setPrintError(null);
    setIsPrintingAdmissionForm(true);
    try {
      await downloadFile(`/api/students/${id}/admission-form/pdf`, `admission-form-${id}.pdf`);
    } catch (err) {
      setPrintError(err instanceof ApiError ? err.message : "Could not generate the admission form.");
    } finally {
      setIsPrintingAdmissionForm(false);
    }
  };

  const printAttendance = async () => {
    setPrintError(null);
    setIsPrintingAttendance(true);
    try {
      const qs = new URLSearchParams(
        Object.entries({ from: attendanceFrom, to: attendanceTo }).filter(([, v]) => v) as [string, string][],
      ).toString();
      await downloadFile(`/api/attendance/student/${id}/pdf${qs ? `?${qs}` : ""}`, `attendance-${id}.pdf`);
    } catch (err) {
      setPrintError(err instanceof ApiError ? err.message : "Could not generate the attendance report.");
    } finally {
      setIsPrintingAttendance(false);
    }
  };
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<GuardianFormValues>({ resolver: zodResolver(guardianSchema), defaultValues: { relationship: "FATHER" } });

  const onAddGuardian = async (values: GuardianFormValues) => {
    setGuardianError(null);
    try {
      const res = await studentsApi.createGuardian({
        ...values,
        email: values.email || undefined,
        studentId: id,
        isPrimary: true,
      });
      reset();
      setShowGuardianForm(false);
      setNewGuardianLogin(res.portalLogin ?? null);
      setCopied(false);
      refetch();
    } catch (err) {
      setGuardianError(err instanceof ApiError ? err.message : "Could not add guardian.");
    }
  };

  if (isLoading) return <Spinner label="Loading student" />;
  if (error) return <Alert tone="danger">Failed to load student: {error.message}</Alert>;
  if (!student) return null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-page-title font-semibold text-slate-900">{student.fullName}</h1>
          <p className="text-sm text-slate-500">{student.studentCode}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={student.status === "ACTIVE" ? "success" : student.status === "ARCHIVED" ? "danger" : "default"}>
            {student.status}
          </Badge>
          <Button variant="outline" size="sm" onClick={printAdmissionForm} isLoading={isPrintingAdmissionForm}>
            <FileDown className="size-4" aria-hidden="true" />
            Admission form
          </Button>
          {canDelete && student.status !== "ARCHIVED" && (
            <ConfirmButton
              triggerLabel="Archive"
              confirmLabel="Archive student"
              title="Archive this student?"
              description="Their profile, attendance, fee, exam, homework, discipline, learning-support, and health records all stay intact — this only removes them from the regular Students list (find them again later under Previous Data) and disables their portal login."
              onConfirm={onDelete}
            />
          )}
        </div>
      </div>

      {printError && <Alert tone="danger">{printError}</Alert>}
      {deleteError && <Alert tone="danger">{deleteError}</Alert>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Profile</CardTitle>
            {/* Archived is only reachable via the dedicated archive action
                above (Previous Data browses these read-only) — the edit
                form's own status dropdown deliberately has no ARCHIVED
                option to switch back to, matching the backend's
                updateStudentSchema. */}
            {canEdit && !showEditForm && student.status !== "ARCHIVED" && (
              <Button size="sm" variant="outline" onClick={openEditForm}>
                <Pencil className="size-4" aria-hidden="true" />
                Edit
              </Button>
            )}
          </CardHeader>
          <CardContent>
            <div className="mb-4 flex items-center gap-4">
              {student.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- external/self-hosted upload URL, not a local static asset next/image can optimize
                <img
                  src={student.photoUrl}
                  alt={student.fullName}
                  className="size-16 rounded-full border border-slate-200 object-cover"
                />
              ) : (
                <div
                  className="flex size-16 items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-lg font-semibold text-slate-400"
                  aria-hidden="true"
                >
                  {student.fullName.charAt(0).toUpperCase()}
                </div>
              )}
              {canEdit && (
                <div>
                  <ImageUploadButton
                    label={student.photoUrl ? "Change photo" : "Upload photo"}
                    onUploaded={onPhotoUploaded}
                  />
                  {photoError && <p className="mt-1 text-xs text-red-600">{photoError}</p>}
                </div>
              )}
            </div>
            {showEditForm ? (
              <form onSubmit={handleEditSubmit(onEditProfile)} noValidate className="flex flex-col gap-3">
                {editError && <Alert tone="danger">{editError}</Alert>}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Input label="Full name" required error={editErrors.fullName?.message} {...registerEdit("fullName")} />
                  <Select label="Gender" required {...registerEdit("gender")}>
                    <option value="MALE">Male</option>
                    <option value="FEMALE">Female</option>
                    <option value="OTHER">Other</option>
                  </Select>
                  <Input
                    label="Date of birth"
                    type="date"
                    required
                    error={editErrors.dateOfBirth?.message}
                    {...registerEdit("dateOfBirth")}
                  />
                  <Select label="Status" required {...registerEdit("status")}>
                    <option value="ACTIVE">Active</option>
                    <option value="INACTIVE">Inactive</option>
                    <option value="GRADUATED">Graduated</option>
                    <option value="TRANSFERRED_OUT">Transferred out</option>
                    <option value="EXPELLED">Expelled</option>
                  </Select>
                  <Input
                    label="B-Form / CNIC"
                    placeholder="35202-1234567-1"
                    error={editErrors.bFormOrCnic?.message}
                    {...registerEdit("bFormOrCnic")}
                  />
                  <Input label="Contact phone" error={editErrors.contactPhone?.message} {...registerEdit("contactPhone")} />
                  <Input label="Roll number" error={editErrors.rollNumber?.message} {...registerEdit("rollNumber")} />
                  <Input label="City" error={editErrors.city?.message} {...registerEdit("city")} />
                  <Input
                    label="Address"
                    className="sm:col-span-2"
                    error={editErrors.address?.message}
                    {...registerEdit("address")}
                  />
                  <Input
                    label="Emergency contact"
                    placeholder="e.g. Uncle Tariq - 03001234567"
                    className="sm:col-span-2"
                    error={editErrors.emergencyContact?.message}
                    {...registerEdit("emergencyContact")}
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setShowEditForm(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" size="sm" isLoading={isEditSubmitting}>
                    Save changes
                  </Button>
                </div>
              </form>
            ) : (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <div>
                  <dt className="text-slate-500">Gender</dt>
                  <dd className="text-slate-900">{student.gender}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Date of birth</dt>
                  <dd className="text-slate-900">{new Date(student.dateOfBirth).toLocaleDateString()}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Section</dt>
                  <dd className="text-slate-900">
                    {student.currentSection
                      ? `${student.currentSection.schoolClass.name} - ${student.currentSection.name}`
                      : "Not enrolled"}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Admission date</dt>
                  <dd className="text-slate-900">{new Date(student.admissionDate).toLocaleDateString()}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">B-Form / CNIC</dt>
                  <dd className="text-slate-900">{student.bFormOrCnic ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Contact phone</dt>
                  <dd className="text-slate-900">{student.contactPhone ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Roll number</dt>
                  <dd className="text-slate-900">{student.rollNumber ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Address</dt>
                  <dd className="text-slate-900">
                    {[student.address, student.city].filter(Boolean).join(", ") || "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Emergency contact</dt>
                  <dd className="text-slate-900">{student.emergencyContact ?? "—"}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-slate-500">Portal login</dt>
                  <dd className="text-slate-900">
                    {showEmailForm ? (
                      <form onSubmit={handleEmailSubmit(onEditEmail)} noValidate className="mt-1 flex flex-wrap items-start gap-2">
                        <Input
                          type="email"
                          placeholder="student@example.com"
                          error={emailErrors.email?.message}
                          {...registerEmail("email")}
                        />
                        <Button type="submit" size="sm" isLoading={isEmailSubmitting}>
                          Save
                        </Button>
                        <Button type="button" variant="outline" size="sm" onClick={() => setShowEmailForm(false)}>
                          Cancel
                        </Button>
                      </form>
                    ) : (
                      <span className="flex items-center gap-2">
                        {student.user
                          ? (student.user.email ?? `Login ID: ${student.studentCode}`)
                          : "No portal login yet"}
                        {canEdit && student.user && (
                          <button
                            type="button"
                            className="text-primary-600 hover:underline"
                            onClick={() => {
                              setEmailError(null);
                              resetEmail({ email: student.user?.email ?? "" });
                              setShowEmailForm(true);
                            }}
                          >
                            {student.user.email ? "Edit" : "Add email"}
                          </button>
                        )}
                      </span>
                    )}
                    {emailError && !showEmailForm && <p className="mt-1 text-sm text-red-600">{emailError}</p>}
                  </dd>
                </div>
                {canEdit && student.user && (
                  <div className="col-span-2">
                    <dt className="text-slate-500">Forgot password?</dt>
                    <dd className="mt-1">
                      <ResetPasswordButton userId={student.user.id} />
                    </dd>
                  </div>
                )}
              </dl>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Fee ledger</CardTitle>
          </CardHeader>
          <CardContent>
            {ledger ? (
              <dl className="flex flex-col gap-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-slate-500">Total billed</dt>
                  <dd className="font-medium text-slate-900">Rs {ledger.summary.totalBilled.toLocaleString()}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Total paid</dt>
                  <dd className="font-medium text-slate-900">Rs {ledger.summary.totalPaid.toLocaleString()}</dd>
                </div>
                <div className="flex justify-between border-t border-slate-100 pt-2">
                  <dt className="text-slate-500">Balance</dt>
                  <dd className={`font-semibold ${ledger.summary.balance > 0 ? "text-red-600" : "text-emerald-600"}`}>
                    Rs {ledger.summary.balance.toLocaleString()}
                  </dd>
                </div>
              </dl>
            ) : (
              <Spinner label="Loading ledger" />
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Guardians</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setShowGuardianForm((v) => !v)}>
            <UserPlus className="size-4" aria-hidden="true" />
            Add guardian
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {newGuardianLogin && (
            <Alert tone="success" title="Guardian portal login created">
              <div className="flex flex-col gap-2">
                <p>
                  Credentials were emailed to <span className="font-medium">{newGuardianLogin.email}</span>. You can
                  also share the temporary password below directly.
                </p>
                <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm">
                  <span className="flex-1 select-all">{newGuardianLogin.tempPassword}</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard?.writeText(newGuardianLogin.tempPassword);
                      setCopied(true);
                    }}
                  >
                    {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
                    {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
              </div>
            </Alert>
          )}
          {showGuardianForm && (
            <form onSubmit={handleSubmit(onAddGuardian)} noValidate className="rounded-lg border border-slate-200 p-4">
              {guardianError && (
                <Alert tone="danger" className="mb-3">
                  {guardianError}
                </Alert>
              )}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Input label="Full name" required error={errors.fullName?.message} {...register("fullName")} />
                <Select label="Relationship" required {...register("relationship")}>
                  <option value="FATHER">Father</option>
                  <option value="MOTHER">Mother</option>
                  <option value="GUARDIAN">Guardian</option>
                </Select>
                <Input label="Phone" required error={errors.phone?.message} {...register("phone")} />
                <Input label="Email" type="email" error={errors.email?.message} {...register("email")} />
              </div>
              <div className="mt-3 flex justify-end">
                <Button type="submit" size="sm" isLoading={isSubmitting}>
                  Save guardian
                </Button>
              </div>
            </form>
          )}

          {student.guardians.length === 0 ? (
            <EmptyState message="No guardians linked yet." />
          ) : (
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Name</TableHeaderCell>
                  <TableHeaderCell>Relationship</TableHeaderCell>
                  <TableHeaderCell>Phone</TableHeaderCell>
                  <TableHeaderCell>Email</TableHeaderCell>
                  {canEdit && <TableHeaderCell>Login</TableHeaderCell>}
                </TableRow>
              </TableHead>
              <TableBody>
                {student.guardians.map((g) => (
                  <TableRow key={g.guardian.id}>
                    <TableCell>
                      {g.guardian.fullName} {g.isPrimary && <Badge tone="info">Primary</Badge>}
                    </TableCell>
                    <TableCell>{g.guardian.relationship}</TableCell>
                    <TableCell>{g.guardian.phone}</TableCell>
                    <TableCell>
                      <GuardianEmailCell
                        guardianId={g.guardian.id}
                        email={g.guardian.email}
                        canEdit={canEdit}
                        onSaved={refetch}
                      />
                    </TableCell>
                    {canEdit && (
                      <TableCell>
                        {g.guardian.userId ? (
                          <ResetPasswordButton userId={g.guardian.userId} />
                        ) : (
                          <span className="text-slate-400">No login yet</span>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Transfer certificate</CardTitle>
          {canIssueTc && student.status !== "TRANSFERRED_OUT" && (
            <Button size="sm" variant="outline" onClick={() => setShowTcForm((v) => !v)}>
              <FileOutput className="size-4" aria-hidden="true" />
              Issue transfer certificate
            </Button>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {tcError && <Alert tone="danger">{tcError}</Alert>}

          {student.status === "TRANSFERRED_OUT" && (
            <Alert tone="warning" title="This student has already been transferred out.">
              {canIssueTc && latestVoidableTc && (
                <div className="mt-2">
                  <p className="mb-2">
                    Issued by mistake? Undo it — this reverts the student back to Active and voids the certificate
                    (kept in the history below, marked Voided).
                  </p>
                  <ConfirmButton
                    triggerLabel="Undo this transfer"
                    confirmLabel="Yes, undo the transfer"
                    title="Undo this transfer certificate?"
                    description="The certificate will be marked Voided and the student's status reverts to Active. This can't be undone again."
                    onConfirm={() => onVoidTc(latestVoidableTc.id)}
                  />
                </div>
              )}
            </Alert>
          )}

          {showTcForm && (
            <form
              onSubmit={handleTcSubmit(onIssueTc)}
              noValidate
              className="rounded-lg border border-slate-200 p-4"
            >
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Select label="Reason" required {...registerTc("reason")}>
                  <option value="PARENT_REQUEST">Parent request</option>
                  <option value="RELOCATION">Relocation</option>
                  <option value="ACADEMIC">Academic</option>
                  <option value="DISCIPLINARY">Disciplinary</option>
                  <option value="GRADUATED">Graduated</option>
                  <option value="OTHER">Other</option>
                </Select>
                <Input label="Last attendance date" type="date" {...registerTc("lastAttendanceDate")} />
                <Input label="Conduct" placeholder="e.g. Good" error={tcErrors.conduct?.message} {...registerTc("conduct")} />
                <Input label="Remarks" error={tcErrors.remarks?.message} {...registerTc("remarks")} />
              </div>
              <div className="mt-3 flex justify-end">
                <Button type="submit" size="sm" isLoading={isTcSubmitting}>
                  Issue certificate
                </Button>
              </div>
            </form>
          )}

          {!transferCertificates || transferCertificates.length === 0 ? (
            <EmptyState message="No transfer certificate has been issued for this student." />
          ) : (
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>TC number</TableHeaderCell>
                  <TableHeaderCell>Issue date</TableHeaderCell>
                  <TableHeaderCell>Reason</TableHeaderCell>
                  <TableHeaderCell>Conduct</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Actions</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {transferCertificates.map((tc) => (
                  <TableRow key={tc.id}>
                    <TableCell className="font-medium text-slate-900">{tc.tcNumber}</TableCell>
                    <TableCell>{new Date(tc.issueDate).toLocaleDateString()}</TableCell>
                    <TableCell>{TC_REASON_LABEL[tc.reason]}</TableCell>
                    <TableCell>{tc.conduct ?? "—"}</TableCell>
                    <TableCell>
                      {tc.voidedAt ? <Badge tone="danger">Voided</Badge> : <Badge tone="success">Active</Badge>}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => printTc(tc.id, tc.tcNumber)}
                        isLoading={isPrintingTc === tc.id}
                      >
                        <Printer className="size-4" aria-hidden="true" />
                        Print
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Discipline records</CardTitle>
          {canLogDiscipline && (
            <Button size="sm" variant="outline" onClick={() => setShowDisciplineForm((v) => !v)}>
              <ShieldAlert className="size-4" aria-hidden="true" />
              Log incident
            </Button>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {disciplineError && <Alert tone="danger">{disciplineError}</Alert>}

          {showDisciplineForm && (
            <form
              onSubmit={handleDisciplineSubmit(onLogDiscipline)}
              noValidate
              className="rounded-lg border border-slate-200 p-4"
            >
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Input
                  label="Incident date"
                  type="date"
                  required
                  error={disciplineErrors.incidentDate?.message}
                  {...registerDiscipline("incidentDate")}
                />
                <Select label="Severity" required {...registerDiscipline("severity")}>
                  <option value="MINOR">Minor</option>
                  <option value="MODERATE">Moderate</option>
                  <option value="MAJOR">Major</option>
                </Select>
                <Select label="Category" required {...registerDiscipline("category")}>
                  {Object.entries(DISCIPLINE_CATEGORY_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
                <Select label="Action taken" {...registerDiscipline("actionTaken")}>
                  {Object.entries(DISCIPLINE_ACTION_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="mt-3">
                <Input
                  label="What happened"
                  required
                  error={disciplineErrors.description?.message}
                  {...registerDiscipline("description")}
                />
              </div>
              <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" className="rounded border-slate-300" {...registerDiscipline("notifyGuardianNow")} />
                Also message the guardian(s) now
              </label>
              <div className="mt-3 flex justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setShowDisciplineForm(false)}>
                  Cancel
                </Button>
                <Button type="submit" size="sm" isLoading={isDisciplineSubmitting}>
                  Log incident
                </Button>
              </div>
            </form>
          )}

          {!disciplineRecords || disciplineRecords.length === 0 ? (
            <EmptyState message="No discipline records for this student." />
          ) : (
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Date</TableHeaderCell>
                  <TableHeaderCell>Category</TableHeaderCell>
                  <TableHeaderCell>Severity</TableHeaderCell>
                  <TableHeaderCell>Action taken</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  {canLogDiscipline && <TableHeaderCell>Actions</TableHeaderCell>}
                </TableRow>
              </TableHead>
              <TableBody>
                {disciplineRecords.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{new Date(r.incidentDate).toLocaleDateString()}</TableCell>
                    <TableCell>{DISCIPLINE_CATEGORY_LABEL[r.category]}</TableCell>
                    <TableCell>
                      <Badge tone={SEVERITY_TONE[r.severity]}>{r.severity}</Badge>
                    </TableCell>
                    <TableCell>{DISCIPLINE_ACTION_LABEL[r.actionTaken]}</TableCell>
                    <TableCell>
                      <Badge tone={r.resolved ? "success" : "warning"}>{r.resolved ? "Resolved" : "Open"}</Badge>
                    </TableCell>
                    {canLogDiscipline && (
                      <TableCell>
                        {!r.resolved && (
                          <Button variant="outline" size="sm" onClick={() => markDisciplineResolved(r.id)}>
                            Mark resolved
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Learning support plans</CardTitle>
          {canLogSupportNeed && (
            <Button size="sm" variant="outline" onClick={() => setShowSupportNeedForm((v) => !v)}>
              <HeartHandshake className="size-4" aria-hidden="true" />
              Log plan
            </Button>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-xs text-slate-500">
            Informal, school-level support plans — not a legal special-education process.
          </p>
          {supportNeedError && <Alert tone="danger">{supportNeedError}</Alert>}

          {showSupportNeedForm && (
            <form
              onSubmit={handleSupportNeedSubmit(onLogSupportNeed)}
              noValidate
              className="rounded-lg border border-slate-200 p-4"
              data-testid="log-support-need-form"
            >
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Select label="Category" required {...registerSupportNeed("category")}>
                  {Object.entries(SUPPORT_NEED_CATEGORY_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
                <Input
                  label="Identified date"
                  type="date"
                  required
                  error={supportNeedErrors.identifiedDate?.message}
                  {...registerSupportNeed("identifiedDate")}
                />
                <Input label="Next review date" type="date" {...registerSupportNeed("nextReviewDate")} />
              </div>
              <div className="mt-3 flex flex-col gap-3">
                <Textarea
                  label="What was observed"
                  required
                  error={supportNeedErrors.description?.message}
                  {...registerSupportNeed("description")}
                />
                <Textarea
                  label="Support being provided"
                  required
                  error={supportNeedErrors.supportProvided?.message}
                  {...registerSupportNeed("supportProvided")}
                />
                <Textarea label="Exam accommodations (if any)" {...registerSupportNeed("examAccommodations")} />
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setShowSupportNeedForm(false)}>
                  Cancel
                </Button>
                <Button type="submit" size="sm" isLoading={isSupportNeedSubmitting}>
                  Save plan
                </Button>
              </div>
            </form>
          )}

          {!supportNeeds || supportNeeds.length === 0 ? (
            <EmptyState message="No learning support plans for this student." />
          ) : (
            <div className="flex flex-col gap-3">
              {supportNeeds.map((sn) => (
                <div key={sn.id} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-slate-900">{SUPPORT_NEED_CATEGORY_LABEL[sn.category]}</p>
                      <p className="text-xs text-slate-500">
                        Identified {new Date(sn.identifiedDate).toLocaleDateString()}
                      </p>
                    </div>
                    <Badge tone={SUPPORT_NEED_STATUS_TONE[sn.status]}>{SUPPORT_NEED_STATUS_LABEL[sn.status]}</Badge>
                  </div>
                  <p className="mt-2 text-sm text-slate-700">{sn.description}</p>
                  <p className="mt-1 text-sm text-slate-500">
                    <span className="font-medium text-slate-700">Support provided: </span>
                    {sn.supportProvided}
                  </p>
                  {sn.examAccommodations && (
                    <p className="mt-1 text-sm text-slate-500">
                      <span className="font-medium text-slate-700">Exam accommodations: </span>
                      {sn.examAccommodations}
                    </p>
                  )}

                  {sn.reviews.length > 0 && (
                    <ul className="mt-2 flex flex-col gap-1 text-xs text-slate-500">
                      {sn.reviews.map((r) => (
                        <li key={r.id}>
                          {new Date(r.reviewDate).toLocaleDateString()}: {r.notes}
                          {r.updatedStatus ? ` (status → ${SUPPORT_NEED_STATUS_LABEL[r.updatedStatus]})` : ""}
                        </li>
                      ))}
                    </ul>
                  )}

                  {canLogSupportNeed &&
                    (reviewingSupportNeedId === sn.id ? (
                      <div className="mt-2">
                        <SupportNeedReviewForm
                          supportNeedId={sn.id}
                          onAdded={() => {
                            setReviewingSupportNeedId(null);
                            refetchSupportNeeds();
                          }}
                          onCancel={() => setReviewingSupportNeedId(null)}
                        />
                      </div>
                    ) : (
                      <div className="mt-2 flex justify-end">
                        <Button variant="outline" size="sm" onClick={() => setReviewingSupportNeedId(sn.id)}>
                          <MessageSquarePlus className="size-4" aria-hidden="true" />
                          Add review
                        </Button>
                      </div>
                    ))}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Health</CardTitle>
          <div className="flex items-center gap-2">
            {canEditHealthProfile && !showHealthProfileForm && (
              <Button size="sm" variant="outline" onClick={() => setShowHealthProfileForm(true)}>
                <Pencil className="size-4" aria-hidden="true" />
                {healthProfile ? "Edit profile" : "Add profile"}
              </Button>
            )}
            {canLogHealthVisit && (
              <Button size="sm" variant="outline" onClick={() => setShowHealthLogForm((v) => !v)}>
                <HeartPulse className="size-4" aria-hidden="true" />
                Log visit
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-xs text-slate-500">
            Blood group, allergies, and emergency contacts — an office quick-reference card, not a clinical record.
          </p>

          {showHealthProfileForm ? (
            <form
              onSubmit={handleHealthProfileSubmit(onSaveHealthProfile)}
              noValidate
              className="rounded-lg border border-slate-200 p-4"
              data-testid="health-profile-form"
            >
              {healthProfileError && <Alert tone="danger">{healthProfileError}</Alert>}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Select label="Blood group" defaultValue={healthProfile?.bloodGroup ?? ""} {...registerHealthProfile("bloodGroup")}>
                  <option value="">Not recorded</option>
                  {Object.entries(BLOOD_GROUP_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
                <Input
                  label="Emergency contact name"
                  defaultValue={healthProfile?.emergencyContactName ?? ""}
                  {...registerHealthProfile("emergencyContactName")}
                />
                <Input
                  label="Emergency contact phone"
                  defaultValue={healthProfile?.emergencyContactPhone ?? ""}
                  {...registerHealthProfile("emergencyContactPhone")}
                />
                <Input label="Doctor name" defaultValue={healthProfile?.doctorName ?? ""} {...registerHealthProfile("doctorName")} />
                <Input label="Doctor phone" defaultValue={healthProfile?.doctorPhone ?? ""} {...registerHealthProfile("doctorPhone")} />
              </div>
              <div className="mt-3 flex flex-col gap-3">
                <Textarea label="Allergies" defaultValue={healthProfile?.allergies ?? ""} {...registerHealthProfile("allergies")} />
                <Textarea
                  label="Chronic conditions"
                  defaultValue={healthProfile?.chronicConditions ?? ""}
                  {...registerHealthProfile("chronicConditions")}
                />
                <Textarea
                  label="Current medications"
                  defaultValue={healthProfile?.currentMedications ?? ""}
                  {...registerHealthProfile("currentMedications")}
                />
                <Textarea
                  label="Emergency medical notes"
                  defaultValue={healthProfile?.emergencyMedicalNotes ?? ""}
                  {...registerHealthProfile("emergencyMedicalNotes")}
                />
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setShowHealthProfileForm(false)}>
                  Cancel
                </Button>
                <Button type="submit" size="sm" isLoading={isHealthProfileSubmitting}>
                  <Save className="size-4" aria-hidden="true" />
                  Save profile
                </Button>
              </div>
            </form>
          ) : healthProfile ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <div>
                <dt className="text-slate-500">Blood group</dt>
                <dd className="text-slate-900">{healthProfile.bloodGroup ? BLOOD_GROUP_LABEL[healthProfile.bloodGroup] : "—"}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Emergency contact</dt>
                <dd className="text-slate-900">
                  {healthProfile.emergencyContactName ?? "—"}
                  {healthProfile.emergencyContactPhone ? ` (${healthProfile.emergencyContactPhone})` : ""}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-slate-500">Allergies</dt>
                <dd className="text-slate-900">{healthProfile.allergies ?? "—"}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-slate-500">Chronic conditions</dt>
                <dd className="text-slate-900">{healthProfile.chronicConditions ?? "—"}</dd>
              </div>
            </dl>
          ) : (
            <EmptyState message="No health profile recorded yet for this student." />
          )}
          {healthProfileSaved && !showHealthProfileForm && <Alert tone="success">Health profile saved.</Alert>}

          {showHealthLogForm && (
            <form
              onSubmit={handleHealthLogSubmit(onLogHealthVisit)}
              noValidate
              className="rounded-lg border border-slate-200 p-4"
              data-testid="log-visit-form"
            >
              {healthLogError && <Alert tone="danger">{healthLogError}</Alert>}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Input
                  label="Visit date"
                  type="date"
                  required
                  error={healthLogErrors.visitDate?.message}
                  {...registerHealthLog("visitDate")}
                />
                <Select label="Outcome" {...registerHealthLog("outcome")}>
                  {Object.entries(HEALTH_LOG_OUTCOME_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="mt-3 flex flex-col gap-3">
                <Textarea
                  label="Complaint"
                  required
                  error={healthLogErrors.complaint?.message}
                  {...registerHealthLog("complaint")}
                />
                <Textarea
                  label="Action taken"
                  required
                  error={healthLogErrors.actionTaken?.message}
                  {...registerHealthLog("actionTaken")}
                />
              </div>
              <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" className="rounded border-slate-300" {...registerHealthLog("notifyGuardianNow")} />
                Also message the guardian(s) now
              </label>
              <div className="mt-3 flex justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setShowHealthLogForm(false)}>
                  Cancel
                </Button>
                <Button type="submit" size="sm" isLoading={isHealthLogSubmitting}>
                  Log visit
                </Button>
              </div>
            </form>
          )}

          {!healthLogEntries || healthLogEntries.length === 0 ? (
            <EmptyState message="No clinic visits logged for this student." />
          ) : (
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Date</TableHeaderCell>
                  <TableHeaderCell>Complaint</TableHeaderCell>
                  <TableHeaderCell>Outcome</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {healthLogEntries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>{new Date(entry.visitDate).toLocaleDateString()}</TableCell>
                    <TableCell>{entry.complaint}</TableCell>
                    <TableCell>
                      <Badge tone={entry.outcome === "RETURNED_TO_CLASS" ? "default" : "warning"}>
                        {HEALTH_LOG_OUTCOME_LABEL[entry.outcome]}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <CustomFieldsCard studentId={id} canEdit={canEditCustomFields} />

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Recent attendance</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <Input
              label="From"
              type="date"
              value={attendanceFrom}
              onChange={(e) => setAttendanceFrom(e.target.value)}
            />
            <Input label="To" type="date" value={attendanceTo} onChange={(e) => setAttendanceTo(e.target.value)} />
            <Button variant="outline" size="sm" onClick={printAttendance} isLoading={isPrintingAttendance}>
              <Printer className="size-4" aria-hidden="true" />
              Print attendance
            </Button>
            <p className="w-full text-xs text-slate-500">
              Leave both dates empty to print the full attendance history — from a single day up to a whole
              academic year.
            </p>
          </div>
          {!attendance ? (
            <Spinner label="Loading attendance" />
          ) : attendance.length === 0 ? (
            <EmptyState message="No attendance records yet." />
          ) : (
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Date</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Remarks</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {attendance.slice(0, 10).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{new Date(r.date).toLocaleDateString()}</TableCell>
                    <TableCell>{r.status}</TableCell>
                    <TableCell>{r.remarks ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
