"use client";

import { useState } from "react";
import { Plus, Save } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAsync } from "@/lib/hooks/useAsync";
import { useDebouncedValue } from "@/lib/hooks/useDebouncedValue";
import { useAuth } from "@/lib/auth/AuthProvider";
import { studentsApi } from "@/lib/resources/students";
import {
  healthApi,
  BLOOD_GROUP_LABEL,
  HEALTH_LOG_OUTCOME_LABEL,
  type HealthLogOutcome,
} from "@/lib/resources/health";
import { ApiError } from "@/lib/api";
import {
  Button,
  Input,
  Select,
  Textarea,
  Badge,
  Alert,
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
  Spinner,
} from "@/components/ui";

const profileSchema = z.object({
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
type ProfileFormValues = z.infer<typeof profileSchema>;

const logSchema = z.object({
  studentId: z.string().uuid("Choose a student"),
  visitDate: z.string().min(1, "Required"),
  complaint: z.string().min(2, "Required").max(1000),
  actionTaken: z.string().min(2, "Required").max(1000),
  outcome: z.enum(["RETURNED_TO_CLASS", "SENT_HOME", "TAKEN_TO_HOSPITAL", "PARENT_CALLED_TO_COLLECT"]).optional(),
  notifyGuardianNow: z.boolean().optional(),
});
type LogFormValues = z.infer<typeof logSchema>;

/** Minimal type-to-search, single-pick student selector — mirrors discipline/page.tsx's. */
function StudentSearchSelect({
  value,
  onChange,
}: {
  value: { id: string; label: string } | null;
  onChange: (student: { id: string; label: string } | null) => void;
}) {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const { data, isLoading } = useAsync(async () => {
    if (!debouncedSearch) return [];
    const res = await studentsApi.list({ page: 1, limit: 8, search: debouncedSearch });
    return res.data;
  }, [debouncedSearch]);

  if (value) {
    return (
      <div className="flex items-center gap-2">
        <Badge tone="info">{value.label}</Badge>
        <button type="button" className="text-xs text-primary-600 hover:underline" onClick={() => onChange(null)}>
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <Input
        label="Student"
        required
        placeholder="Search by name or admission code..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {search && (
        <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200">
          {isLoading && (
            <div className="p-2">
              <Spinner label="Searching" />
            </div>
          )}
          {!isLoading && data?.length === 0 && <p className="p-2 text-xs text-slate-500">No students found.</p>}
          {!isLoading &&
            data?.map((s) => (
              <button
                key={s.id}
                type="button"
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                onClick={() => {
                  onChange({ id: s.id, label: `${s.fullName} (${s.studentCode})` });
                  setSearch("");
                }}
              >
                {s.fullName} ({s.studentCode})
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

function HealthProfileLookup({ canEditProfile }: { canEditProfile: boolean }) {
  const [student, setStudent] = useState<{ id: string; label: string } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const { data: profile, isLoading, refetch } = useAsync(
    () => (student ? healthApi.getProfile(student.id) : Promise.resolve(null)),
    [student?.id],
  );

  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<ProfileFormValues>({ resolver: zodResolver(profileSchema) });

  const openFor = (s: { id: string; label: string } | null) => {
    setStudent(s);
    setSaved(false);
    setSaveError(null);
  };

  const onSubmit = async (values: ProfileFormValues) => {
    if (!student) return;
    setSaveError(null);
    try {
      await healthApi.saveProfile(student.id, {
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
      setSaved(true);
      refetch();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Could not save this health profile.");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Student health profile</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-xs text-slate-500">
          Blood group, allergies, chronic conditions, and emergency contacts — the office&apos;s quick-reference
          card, not a clinical record.
        </p>
        <StudentSearchSelect value={student} onChange={openFor} />

        {student && isLoading && <Spinner label="Loading health profile" />}

        {student && !isLoading && (
          <form
            onSubmit={handleSubmit(onSubmit)}
            noValidate
            className="flex flex-col gap-3"
            data-testid="health-profile-form"
            key={profile?.id ?? "new"}
          >
            {saveError && <Alert tone="danger">{saveError}</Alert>}
            {saved && <Alert tone="success">Health profile saved.</Alert>}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Select
                label="Blood group"
                disabled={!canEditProfile}
                defaultValue={profile?.bloodGroup ?? ""}
                {...register("bloodGroup")}
              >
                <option value="">Not recorded</option>
                {Object.entries(BLOOD_GROUP_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
              <Input
                label="Emergency contact name"
                disabled={!canEditProfile}
                defaultValue={profile?.emergencyContactName ?? ""}
                {...register("emergencyContactName")}
              />
              <Input
                label="Emergency contact phone"
                disabled={!canEditProfile}
                defaultValue={profile?.emergencyContactPhone ?? ""}
                {...register("emergencyContactPhone")}
              />
              <Input
                label="Doctor name"
                disabled={!canEditProfile}
                defaultValue={profile?.doctorName ?? ""}
                {...register("doctorName")}
              />
              <Input
                label="Doctor phone"
                disabled={!canEditProfile}
                defaultValue={profile?.doctorPhone ?? ""}
                {...register("doctorPhone")}
              />
            </div>
            <Textarea
              label="Allergies"
              disabled={!canEditProfile}
              defaultValue={profile?.allergies ?? ""}
              {...register("allergies")}
            />
            <Textarea
              label="Chronic conditions"
              disabled={!canEditProfile}
              defaultValue={profile?.chronicConditions ?? ""}
              {...register("chronicConditions")}
            />
            <Textarea
              label="Current medications"
              disabled={!canEditProfile}
              defaultValue={profile?.currentMedications ?? ""}
              {...register("currentMedications")}
            />
            <Textarea
              label="Emergency medical notes"
              disabled={!canEditProfile}
              defaultValue={profile?.emergencyMedicalNotes ?? ""}
              {...register("emergencyMedicalNotes")}
            />

            {canEditProfile && (
              <div className="flex justify-end">
                <Button type="submit" size="sm" isLoading={isSubmitting}>
                  <Save className="size-4" aria-hidden="true" />
                  Save profile
                </Button>
              </div>
            )}
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function LogVisitForm({ onLogged, onCancel }: { onLogged: () => void; onCancel: () => void }) {
  const [student, setStudent] = useState<{ id: string; label: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<LogFormValues>({
    resolver: zodResolver(logSchema),
    defaultValues: { visitDate: new Date().toISOString().slice(0, 10) },
  });

  const onSubmit = async (values: LogFormValues) => {
    setError(null);
    try {
      await healthApi.createLogEntry(values);
      reset({ visitDate: new Date().toISOString().slice(0, 10) });
      setStudent(null);
      onLogged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not log this visit.");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Log a clinic / first-aid visit</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={handleSubmit(onSubmit)}
          noValidate
          className="flex flex-col gap-3"
          data-testid="log-visit-form"
        >
          {error && <Alert tone="danger">{error}</Alert>}

          <StudentSearchSelect
            value={student}
            onChange={(s) => {
              setStudent(s);
              setValue("studentId", s?.id ?? "", { shouldValidate: true });
            }}
          />
          {errors.studentId && <p className="text-xs text-red-600">{errors.studentId.message}</p>}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input label="Visit date" type="date" required error={errors.visitDate?.message} {...register("visitDate")} />
            <Select label="Outcome" {...register("outcome")}>
              {Object.entries(HEALTH_LOG_OUTCOME_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>

          <Textarea label="Complaint" required error={errors.complaint?.message} {...register("complaint")} />
          <Textarea label="Action taken" required error={errors.actionTaken?.message} {...register("actionTaken")} />

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" className="rounded border-slate-300" {...register("notifyGuardianNow")} />
            Also message the guardian(s) now
          </label>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" size="sm" isLoading={isSubmitting}>
              Log visit
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export default function HealthPage() {
  const { user } = useAuth();
  // Matches health.ts's PROFILE_WRITE_ROLES — a TEACHER can view the
  // profile but not edit it (the office maintains official medical facts).
  const canEditProfile = user?.role === "SCHOOL_ADMIN" || user?.role === "FRONT_DESK";

  const [showLogForm, setShowLogForm] = useState(false);
  const [page, setPage] = useState(1);
  const [outcome, setOutcome] = useState("");

  const { data, isLoading, error, refetch } = useAsync(
    () =>
      healthApi.listLogEntries({
        page,
        limit: 20,
        outcome: (outcome || undefined) as HealthLogOutcome | undefined,
      }),
    [page, outcome],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-page-title font-semibold text-slate-900">Health records</h1>
        <Button size="sm" onClick={() => setShowLogForm((v) => !v)}>
          <Plus className="size-4" aria-hidden="true" />
          Log visit
        </Button>
      </div>

      <HealthProfileLookup canEditProfile={canEditProfile} />

      {showLogForm && (
        <LogVisitForm
          onLogged={() => {
            setShowLogForm(false);
            refetch();
          }}
          onCancel={() => setShowLogForm(false)}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>Clinic / first-aid visit log</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <Select
              label="Outcome"
              value={outcome}
              onChange={(e) => {
                setPage(1);
                setOutcome(e.target.value);
              }}
              className="w-56"
            >
              <option value="">All outcomes</option>
              {Object.entries(HEALTH_LOG_OUTCOME_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>

          {isLoading && <Spinner label="Loading visit log" />}
          {error && <p className="text-sm text-red-600">Failed to load visit log: {error.message}</p>}

          {data && (
            <>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>Date</TableHeaderCell>
                    <TableHeaderCell>Student</TableHeaderCell>
                    <TableHeaderCell>Complaint</TableHeaderCell>
                    <TableHeaderCell>Action taken</TableHeaderCell>
                    <TableHeaderCell>Outcome</TableHeaderCell>
                    <TableHeaderCell>Guardian notified</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.data.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell>{new Date(entry.visitDate).toLocaleDateString()}</TableCell>
                      <TableCell>
                        {entry.student.fullName}{" "}
                        <span className="text-xs text-slate-400">({entry.student.studentCode})</span>
                      </TableCell>
                      <TableCell>{entry.complaint}</TableCell>
                      <TableCell>{entry.actionTaken}</TableCell>
                      <TableCell>
                        <Badge tone={entry.outcome === "RETURNED_TO_CLASS" ? "default" : "warning"}>
                          {HEALTH_LOG_OUTCOME_LABEL[entry.outcome]}
                        </Badge>
                      </TableCell>
                      <TableCell>{entry.guardianNotified ? "Yes" : "No"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {data.data.length === 0 && <EmptyState message="No clinic visits logged." />}

              <div className="flex items-center justify-between text-sm text-slate-500">
                <span>
                  Page {data.meta.page} of {data.meta.totalPages} — {data.meta.total} total
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= data.meta.totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
