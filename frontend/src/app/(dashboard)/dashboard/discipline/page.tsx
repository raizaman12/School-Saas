"use client";

import { useState } from "react";
import { Plus, Check, X as XIcon } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAsync } from "@/lib/hooks/useAsync";
import { useDebouncedValue } from "@/lib/hooks/useDebouncedValue";
import { studentsApi } from "@/lib/resources/students";
import {
  disciplineApi,
  DISCIPLINE_CATEGORY_LABEL,
  DISCIPLINE_ACTION_LABEL,
  type DisciplineSeverity,
} from "@/lib/resources/discipline";
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

const SEVERITY_TONE: Record<DisciplineSeverity, "default" | "warning" | "danger"> = {
  MINOR: "default",
  MODERATE: "warning",
  MAJOR: "danger",
};

const createSchema = z.object({
  studentId: z.string().uuid("Choose a student"),
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
  actionNotes: z.string().max(1000).optional(),
  notifyGuardianNow: z.boolean().optional(),
});
type CreateFormValues = z.infer<typeof createSchema>;

/** Minimal type-to-search, single-pick student selector for the create form. */
function StudentSearchSelect({
  value,
  onChange,
}: {
  value: { id: string; label: string } | null;
  onChange: (student: { id: string; label: string } | null) => void;
}) {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const { data, isLoading } = useAsync(
    async () => {
      if (!debouncedSearch) return [];
      const res = await studentsApi.list({ page: 1, limit: 8, search: debouncedSearch });
      return res.data;
    },
    [debouncedSearch],
  );

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

function LogIncidentForm({ onLogged, onCancel }: { onLogged: () => void; onCancel: () => void }) {
  const [student, setStudent] = useState<{ id: string; label: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<CreateFormValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { severity: "MINOR", category: "OTHER", incidentDate: new Date().toISOString().slice(0, 10) },
  });

  const onSubmit = async (values: CreateFormValues) => {
    setError(null);
    try {
      await disciplineApi.create({
        ...values,
        actionNotes: values.actionNotes || undefined,
      });
      reset({ severity: "MINOR", category: "OTHER", incidentDate: new Date().toISOString().slice(0, 10) });
      setStudent(null);
      onLogged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not log this incident.");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Log a discipline incident</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={handleSubmit(onSubmit)}
          noValidate
          className="flex flex-col gap-3"
          data-testid="log-incident-form"
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
            <Input label="Incident date" type="date" required error={errors.incidentDate?.message} {...register("incidentDate")} />
            <Select label="Severity" required {...register("severity")}>
              <option value="MINOR">Minor</option>
              <option value="MODERATE">Moderate</option>
              <option value="MAJOR">Major</option>
            </Select>
            <Select label="Category" required {...register("category")}>
              {Object.entries(DISCIPLINE_CATEGORY_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
            <Select label="Action taken" {...register("actionTaken")}>
              {Object.entries(DISCIPLINE_ACTION_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>

          <Textarea
            label="What happened"
            required
            error={errors.description?.message}
            {...register("description")}
          />
          <Textarea label="Action notes" {...register("actionNotes")} />

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" className="rounded border-slate-300" {...register("notifyGuardianNow")} />
            Also message the guardian(s) now
          </label>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" size="sm" isLoading={isSubmitting}>
              Log incident
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export default function DisciplinePage() {
  const [showForm, setShowForm] = useState(false);
  const [page, setPage] = useState(1);
  const [severity, setSeverity] = useState("");
  const [resolvedFilter, setResolvedFilter] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useAsync(
    () =>
      disciplineApi.list({
        page,
        limit: 20,
        severity: (severity || undefined) as DisciplineSeverity | undefined,
        resolved: resolvedFilter === "" ? undefined : resolvedFilter === "true",
      }),
    [page, severity, resolvedFilter],
  );

  const markResolved = async (id: string) => {
    setActionError(null);
    try {
      await disciplineApi.update(id, { resolved: true });
      refetch();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not update this record.");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-page-title font-semibold text-slate-900">Discipline records</h1>
        <Button size="sm" onClick={() => setShowForm((v) => !v)}>
          <Plus className="size-4" aria-hidden="true" />
          Log incident
        </Button>
      </div>

      {showForm && (
        <LogIncidentForm
          onLogged={() => {
            setShowForm(false);
            refetch();
          }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {actionError && <Alert tone="danger">{actionError}</Alert>}

      <div className="flex flex-wrap items-end gap-3">
        <Select
          label="Severity"
          value={severity}
          onChange={(e) => {
            setPage(1);
            setSeverity(e.target.value);
          }}
          className="w-48"
        >
          <option value="">All severities</option>
          <option value="MINOR">Minor</option>
          <option value="MODERATE">Moderate</option>
          <option value="MAJOR">Major</option>
        </Select>
        <Select
          label="Status"
          value={resolvedFilter}
          onChange={(e) => {
            setPage(1);
            setResolvedFilter(e.target.value);
          }}
          className="w-48"
        >
          <option value="">All</option>
          <option value="false">Unresolved</option>
          <option value="true">Resolved</option>
        </Select>
      </div>

      {isLoading && <Spinner label="Loading discipline records" />}
      {error && <p className="text-sm text-red-600">Failed to load discipline records: {error.message}</p>}

      {data && (
        <>
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Date</TableHeaderCell>
                <TableHeaderCell>Student</TableHeaderCell>
                <TableHeaderCell>Category</TableHeaderCell>
                <TableHeaderCell>Severity</TableHeaderCell>
                <TableHeaderCell>Action taken</TableHeaderCell>
                <TableHeaderCell>Guardian notified</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Actions</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.data.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{new Date(r.incidentDate).toLocaleDateString()}</TableCell>
                  <TableCell>
                    {r.student.fullName} <span className="text-xs text-slate-400">({r.student.studentCode})</span>
                  </TableCell>
                  <TableCell>{DISCIPLINE_CATEGORY_LABEL[r.category]}</TableCell>
                  <TableCell>
                    <Badge tone={SEVERITY_TONE[r.severity]}>{r.severity}</Badge>
                  </TableCell>
                  <TableCell>{DISCIPLINE_ACTION_LABEL[r.actionTaken]}</TableCell>
                  <TableCell>
                    {r.guardianNotified ? (
                      <Check className="size-4 text-emerald-600" aria-hidden="true" />
                    ) : (
                      <XIcon className="size-4 text-slate-300" aria-hidden="true" />
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge tone={r.resolved ? "success" : "warning"}>{r.resolved ? "Resolved" : "Open"}</Badge>
                  </TableCell>
                  <TableCell>
                    {!r.resolved && (
                      <Button variant="outline" size="sm" onClick={() => markResolved(r.id)}>
                        Mark resolved
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {data.data.length === 0 && <EmptyState message="No discipline records found." />}

          <div className="flex items-center justify-between text-sm text-slate-500">
            <span>
              Page {data.meta.page} of {data.meta.totalPages} — {data.meta.total} total
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
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
    </div>
  );
}
