"use client";

import { useState } from "react";
import { Plus, MessageSquarePlus } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAsync } from "@/lib/hooks/useAsync";
import { useDebouncedValue } from "@/lib/hooks/useDebouncedValue";
import { studentsApi } from "@/lib/resources/students";
import {
  supportNeedsApi,
  SUPPORT_NEED_CATEGORY_LABEL,
  SUPPORT_NEED_STATUS_LABEL,
  type SupportNeedStatus,
} from "@/lib/resources/supportNeeds";
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

const STATUS_TONE: Record<SupportNeedStatus, "default" | "warning" | "success" | "danger"> = {
  ACTIVE: "default",
  UNDER_REVIEW: "warning",
  RESOLVED: "success",
  DISCONTINUED: "danger",
};

const createSchema = z.object({
  studentId: z.string().uuid("Choose a student"),
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
type CreateFormValues = z.infer<typeof createSchema>;

const reviewSchema = z.object({
  reviewDate: z.string().min(1, "Required"),
  notes: z.string().min(2, "Required").max(2000),
  // .or(z.literal("")) — the "Leave unchanged" option submits an empty
  // string, which z.enum(...).optional() alone would reject (it only
  // treats `undefined` as absent, not ""), silently blocking the form.
  updatedStatus: z.enum(["ACTIVE", "UNDER_REVIEW", "RESOLVED", "DISCONTINUED"]).optional().or(z.literal("")),
});
type ReviewFormValues = z.infer<typeof reviewSchema>;

/** Minimal type-to-search, single-pick student selector for the create form — mirrors discipline/page.tsx's. */
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

function LogSupportNeedForm({ onLogged, onCancel }: { onLogged: () => void; onCancel: () => void }) {
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
    defaultValues: { category: "LEARNING_SUPPORT", identifiedDate: new Date().toISOString().slice(0, 10) },
  });

  const onSubmit = async (values: CreateFormValues) => {
    setError(null);
    try {
      await supportNeedsApi.create({
        ...values,
        examAccommodations: values.examAccommodations || undefined,
        nextReviewDate: values.nextReviewDate || undefined,
      });
      reset({ category: "LEARNING_SUPPORT", identifiedDate: new Date().toISOString().slice(0, 10) });
      setStudent(null);
      onLogged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save this learning support plan.");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Log a learning support plan</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={handleSubmit(onSubmit)}
          noValidate
          className="flex flex-col gap-3"
          data-testid="log-support-need-form"
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
            <Select label="Category" required {...register("category")}>
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
              error={errors.identifiedDate?.message}
              {...register("identifiedDate")}
            />
            <Input label="Next review date" type="date" {...register("nextReviewDate")} />
          </div>

          <Textarea
            label="What was observed"
            required
            error={errors.description?.message}
            {...register("description")}
          />
          <Textarea
            label="Support being provided"
            required
            error={errors.supportProvided?.message}
            {...register("supportProvided")}
          />
          <Textarea label="Exam accommodations (if any)" {...register("examAccommodations")} />

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" size="sm" isLoading={isSubmitting}>
              Save plan
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function AddReviewForm({
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
  } = useForm<ReviewFormValues>({
    resolver: zodResolver(reviewSchema),
    defaultValues: { reviewDate: new Date().toISOString().slice(0, 10) },
  });

  const onSubmit = async (values: ReviewFormValues) => {
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

export default function SupportNeedsPage() {
  const [showForm, setShowForm] = useState(false);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useAsync(
    () =>
      supportNeedsApi.list({
        page,
        limit: 20,
        status: (status || undefined) as SupportNeedStatus | undefined,
      }),
    [page, status],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-page-title font-semibold text-slate-900">Learning support plans</h1>
          <p className="text-sm text-slate-500">
            Informal, school-level support plans — not a legal special-education process.
          </p>
        </div>
        <Button size="sm" onClick={() => setShowForm((v) => !v)}>
          <Plus className="size-4" aria-hidden="true" />
          Log plan
        </Button>
      </div>

      {showForm && (
        <LogSupportNeedForm
          onLogged={() => {
            setShowForm(false);
            refetch();
          }}
          onCancel={() => setShowForm(false)}
        />
      )}

      <div className="flex flex-wrap items-end gap-3">
        <Select
          label="Status"
          value={status}
          onChange={(e) => {
            setPage(1);
            setStatus(e.target.value);
          }}
          className="w-48"
        >
          <option value="">All statuses</option>
          {Object.entries(SUPPORT_NEED_STATUS_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </div>

      {isLoading && <Spinner label="Loading learning support plans" />}
      {error && <p className="text-sm text-red-600">Failed to load learning support plans: {error.message}</p>}

      {data && (
        <>
          {data.data.length === 0 ? (
            <EmptyState message="No learning support plans found." />
          ) : (
            <div className="flex flex-col gap-3">
              {data.data.map((sn) => (
                <Card key={sn.id}>
                  <CardContent className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-slate-900">
                          {sn.student.fullName}{" "}
                          <span className="text-xs text-slate-400">({sn.student.studentCode})</span>
                        </p>
                        <p className="text-sm text-slate-500">{SUPPORT_NEED_CATEGORY_LABEL[sn.category]}</p>
                      </div>
                      <Badge tone={STATUS_TONE[sn.status]}>{SUPPORT_NEED_STATUS_LABEL[sn.status]}</Badge>
                    </div>
                    <p className="text-sm text-slate-700">{sn.description}</p>
                    <p className="text-sm text-slate-500">
                      <span className="font-medium text-slate-700">Support provided: </span>
                      {sn.supportProvided}
                    </p>
                    {sn.examAccommodations && (
                      <p className="text-sm text-slate-500">
                        <span className="font-medium text-slate-700">Exam accommodations: </span>
                        {sn.examAccommodations}
                      </p>
                    )}

                    {sn.reviews.length > 0 && (
                      <Table>
                        <TableHead>
                          <TableRow>
                            <TableHeaderCell>Review date</TableHeaderCell>
                            <TableHeaderCell>Notes</TableHeaderCell>
                            <TableHeaderCell>Status set</TableHeaderCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {sn.reviews.map((r) => (
                            <TableRow key={r.id}>
                              <TableCell>{new Date(r.reviewDate).toLocaleDateString()}</TableCell>
                              <TableCell>{r.notes}</TableCell>
                              <TableCell>{r.updatedStatus ? SUPPORT_NEED_STATUS_LABEL[r.updatedStatus] : "—"}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}

                    {reviewingId === sn.id ? (
                      <AddReviewForm
                        supportNeedId={sn.id}
                        onAdded={() => {
                          setReviewingId(null);
                          refetch();
                        }}
                        onCancel={() => setReviewingId(null)}
                      />
                    ) : (
                      <div className="flex justify-end">
                        <Button variant="outline" size="sm" onClick={() => setReviewingId(sn.id)}>
                          <MessageSquarePlus className="size-4" aria-hidden="true" />
                          Add review
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

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
