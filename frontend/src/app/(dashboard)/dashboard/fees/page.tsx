"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, FileStack, AlertTriangle, Pencil } from "lucide-react";
import { useAsync } from "@/lib/hooks/useAsync";
import { useAuth } from "@/lib/auth/AuthProvider";
import { feesApi, type InvoiceStatus, type InvoiceListItem, type FeeCategory } from "@/lib/resources/fees";
import { academicsApi } from "@/lib/resources/academics";
import { studentsApi } from "@/lib/resources/students";
import { ApiError } from "@/lib/api";
import { SectionCascadeSelect } from "@/components/domain/SectionCascadeSelect";
import {
  Button,
  ConfirmButton,
  Input,
  Select,
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
} from "@/components/ui";

const STATUS_TONE: Record<InvoiceStatus, "success" | "default" | "warning" | "danger"> = {
  PAID: "success",
  PARTIALLY_PAID: "warning",
  UNPAID: "default",
  OVERDUE: "danger",
  CANCELLED: "default",
};

function CategoriesSection({
  categories,
  isLoading,
  refetch,
}: {
  categories: FeeCategory[] | null;
  isLoading: boolean;
  refetch: () => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await feesApi.createCategory({ name });
      setName("");
      refetch();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save category.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Fee categories</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error && <Alert tone="danger">{error}</Alert>}
        <form onSubmit={onSubmit} className="flex gap-2">
          <Input
            placeholder="e.g. Tuition Fee"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="flex-1"
          />
          <Button type="submit" size="sm" isLoading={isSubmitting}>
            <Plus className="size-4" aria-hidden="true" />
            Add
          </Button>
        </form>
        {isLoading ? (
          <Spinner label="Loading categories" />
        ) : !categories || categories.length === 0 ? (
          <EmptyState message="No fee categories yet." />
        ) : (
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <Badge key={c.id}>{c.name}</Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const structureSchema = z.object({
  academicYearId: z.string().uuid("Select a year"),
  schoolClassId: z.string().uuid("Select a class"),
  feeCategoryId: z.string().uuid("Select a category"),
  amount: z.coerce.number().positive("Must be greater than 0"),
  frequency: z.enum(["ONE_TIME", "MONTHLY", "QUARTERLY", "ANNUAL"]),
});
type StructureFormValues = z.infer<typeof structureSchema>;

function StructureSection({ categories }: { categories: FeeCategory[] | null }) {
  const { data: items, isLoading, refetch } = useAsync(() => feesApi.listStructureItems(), []);
  const { data: years } = useAsync(() => academicsApi.listYears(), []);
  const { data: classes } = useAsync(() => academicsApi.listClasses(), []);
  const [open, setOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof structureSchema>, unknown, StructureFormValues>({
    resolver: zodResolver(structureSchema),
    defaultValues: { frequency: "MONTHLY" },
  });

  const onSubmit = async (values: StructureFormValues) => {
    setFormError(null);
    try {
      await feesApi.createStructureItem(values);
      reset();
      setOpen(false);
      refetch();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not save fee structure item.");
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Fee structure</CardTitle>
        <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
          <Plus className="size-4" aria-hidden="true" />
          Add item
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {open && (
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="rounded-lg border border-slate-200 p-4">
            {formError && (
              <Alert tone="danger" className="mb-3">
                {formError}
              </Alert>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Select label="Academic year" required error={errors.academicYearId?.message} {...register("academicYearId")}>
                <option value="">Select year</option>
                {(years ?? []).map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.name}
                  </option>
                ))}
              </Select>
              <Select label="Class" required error={errors.schoolClassId?.message} {...register("schoolClassId")}>
                <option value="">Select class</option>
                {(classes ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
              <Select label="Category" required error={errors.feeCategoryId?.message} {...register("feeCategoryId")}>
                <option value="">Select category</option>
                {(categories ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
              <Input label="Amount (Rs)" type="number" required error={errors.amount?.message} {...register("amount")} />
              <Select label="Frequency" required {...register("frequency")}>
                <option value="ONE_TIME">One time</option>
                <option value="MONTHLY">Monthly</option>
                <option value="QUARTERLY">Quarterly</option>
                <option value="ANNUAL">Annual</option>
              </Select>
            </div>
            <div className="mt-3 flex justify-end">
              <Button type="submit" size="sm" isLoading={isSubmitting}>
                Save
              </Button>
            </div>
          </form>
        )}

        {isLoading ? (
          <Spinner label="Loading fee structure" />
        ) : !items || items.length === 0 ? (
          <EmptyState message="No fee structure items yet." />
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Class</TableHeaderCell>
                <TableHeaderCell>Category</TableHeaderCell>
                <TableHeaderCell>Year</TableHeaderCell>
                <TableHeaderCell>Amount</TableHeaderCell>
                <TableHeaderCell>Frequency</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((i) => (
                <TableRow key={i.id}>
                  <TableCell>{i.schoolClass.name}</TableCell>
                  <TableCell>{i.feeCategory.name}</TableCell>
                  <TableCell>{i.academicYear.name}</TableCell>
                  <TableCell>Rs {Number(i.amount).toLocaleString()}</TableCell>
                  <TableCell>{i.frequency.replace("_", " ")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

const lateFeePolicySchema = z
  .object({
    graceDays: z.coerce.number().int().min(0).max(365),
    fineType: z.enum(["FIXED", "PERCENTAGE"]),
    fineValue: z.coerce.number().positive().max(1_000_000),
    isActive: z.boolean(),
  })
  .refine((v) => v.fineType !== "PERCENTAGE" || v.fineValue <= 100, {
    message: "Must be between 0 and 100 for a percentage fine",
    path: ["fineValue"],
  });
type LateFeePolicyFormValues = z.infer<typeof lateFeePolicySchema>;

function LateFeePolicySection() {
  const { user } = useAuth();
  const canEdit = user?.role === "SCHOOL_ADMIN";
  const { data: policy, isLoading, refetch } = useAsync(() => feesApi.getLateFeePolicy(), []);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof lateFeePolicySchema>, unknown, LateFeePolicyFormValues>({
    resolver: zodResolver(lateFeePolicySchema),
    defaultValues: { graceDays: 0, fineType: "FIXED", isActive: true },
  });

  const openForm = () => {
    if (policy) {
      reset({
        graceDays: policy.graceDays,
        fineType: policy.fineType,
        fineValue: Number(policy.fineValue),
        isActive: policy.isActive,
      });
    }
    setOpen(true);
  };

  const onSubmit = async (values: LateFeePolicyFormValues) => {
    setError(null);
    try {
      await feesApi.saveLateFeePolicy(values);
      setOpen(false);
      refetch();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the late fee policy.");
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Late fee policy</CardTitle>
        {canEdit && (
          <Button size="sm" variant="outline" onClick={() => (open ? setOpen(false) : openForm())}>
            {policy ? "Edit" : "Set up"}
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {isLoading ? (
          <Spinner label="Loading late fee policy" />
        ) : open ? (
          <form onSubmit={handleSubmit(onSubmit)} noValidate>
            {error && (
              <Alert tone="danger" className="mb-3">
                {error}
              </Alert>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Input
                label="Grace days"
                type="number"
                min={0}
                required
                error={errors.graceDays?.message}
                {...register("graceDays")}
              />
              <Select label="Fine type" required {...register("fineType")}>
                <option value="FIXED">Fixed amount (Rs)</option>
                <option value="PERCENTAGE">Percentage of invoice</option>
              </Select>
              <Input
                label="Fine value"
                type="number"
                min={0}
                step="0.01"
                required
                error={errors.fineValue?.message}
                {...register("fineValue")}
              />
              <label className="mt-6 flex items-center gap-2 py-2 text-sm text-slate-700">
                <input type="checkbox" className="size-4 rounded border-slate-300" {...register("isActive")} />
                Active
              </label>
            </div>
            <div className="mt-3 flex justify-end">
              <Button type="submit" size="sm" isLoading={isSubmitting}>
                Save policy
              </Button>
            </div>
          </form>
        ) : !policy ? (
          <EmptyState message="No late fee policy configured yet — overdue invoices won't be fined." />
        ) : (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-slate-500">Grace days</dt>
              <dd className="font-medium text-slate-900">{policy.graceDays}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Fine</dt>
              <dd className="font-medium text-slate-900">
                {policy.fineType === "FIXED" ? `Rs ${Number(policy.fineValue).toLocaleString()}` : `${Number(policy.fineValue)}%`}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Status</dt>
              <dd>
                <Badge tone={policy.isActive ? "success" : "default"}>{policy.isActive ? "Active" : "Inactive"}</Badge>
              </dd>
            </div>
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

function DefaultersSection() {
  const [page, setPage] = useState(1);
  const { data, isLoading, error } = useAsync(() => feesApi.listDefaulters({ page, limit: 20 }), [page]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <AlertTriangle className="size-4 text-amber-500" aria-hidden="true" />
          Defaulters (overdue balances)
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {isLoading && <Spinner label="Loading defaulters" />}
        {error && <Alert tone="danger">{error.message}</Alert>}

        {data && (
          <>
            {data.data.length === 0 ? (
              <EmptyState message="No overdue balances — everyone is paid up." />
            ) : (
              <Table>
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>Student</TableHeaderCell>
                    <TableHeaderCell>Class</TableHeaderCell>
                    <TableHeaderCell>Invoice #</TableHeaderCell>
                    <TableHeaderCell>Due date</TableHeaderCell>
                    <TableHeaderCell>Amount due</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.data.map((d) => (
                    <TableRow key={d.invoiceId}>
                      <TableCell>
                        <Link
                          href={`/dashboard/students/${d.student.id}`}
                          className="font-medium text-primary-600 hover:underline"
                        >
                          {d.student.fullName}
                        </Link>
                        <div className="text-xs text-slate-500">{d.student.studentCode}</div>
                      </TableCell>
                      <TableCell>
                        {d.student.currentSection
                          ? `${d.student.currentSection.schoolClass.name} - ${d.student.currentSection.name}`
                          : "—"}
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/dashboard/fees/invoices/${d.invoiceId}`}
                          className="text-primary-600 hover:underline"
                        >
                          {d.invoiceNumber}
                        </Link>
                      </TableCell>
                      <TableCell>{new Date(d.dueDate).toLocaleDateString()}</TableCell>
                      <TableCell className="font-medium text-red-600">Rs {d.amountDue.toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <div className="flex items-center justify-between text-sm text-slate-500">
              <span>
                Page {data.meta.page} of {data.meta.totalPages} — {data.meta.total} total
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
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
  );
}

function BulkGenerateSection() {
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [academicYearId, setAcademicYearId] = useState<string | null>(null);
  const [period, setPeriod] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [result, setResult] = useState<{ generated: number; skipped: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Roster preview — lets an admin actually see who they're about to bill
  // before generating, rather than trusting a bare "(N students)" count.
  const { data: roster, isLoading: isRosterLoading } = useAsync(
    () => (sectionId ? studentsApi.list({ sectionId, limit: 100, status: "ACTIVE" }) : Promise.resolve(null)),
    [sectionId],
  );

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sectionId || !academicYearId || !period || !issueDate || !dueDate) return;
    setIsSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const res = await feesApi.bulkGenerate({ sectionId, academicYearId, period, issueDate, dueDate });
      setResult({ generated: res.generated, skipped: res.skipped });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not generate invoices.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Generate invoices</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          {error && <Alert tone="danger">{error}</Alert>}
          {result && (
            <Alert tone="success">
              Generated {result.generated} invoice(s), skipped {result.skipped} (already billed for this period).
            </Alert>
          )}

          <SectionCascadeSelect
            onChange={(v) => {
              setSectionId(v?.sectionId ?? null);
              setAcademicYearId(v?.academicYearId ?? null);
            }}
          />

          {sectionId &&
            (isRosterLoading ? (
              <Spinner label="Loading students" />
            ) : roster && roster.data.length > 0 ? (
              <div className="rounded-lg border border-slate-200">
                <p className="border-b border-slate-100 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-500">
                  {roster.data.length} student{roster.data.length === 1 ? "" : "s"} will be billed
                </p>
                <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto p-3 text-sm text-slate-700">
                  {roster.data.map((s) => (
                    <li key={s.id} className="flex justify-between">
                      <span>{s.fullName}</span>
                      <span className="text-slate-400">{s.studentCode}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <EmptyState message="No active students in this section." />
            ))}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Input
              label="Billing period"
              placeholder="2026-02"
              hint="YYYY-MM"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
            />
            <Input label="Issue date" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
            <Input label="Due date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>

          <div className="flex justify-end">
            <Button type="submit" isLoading={isSubmitting} disabled={!sectionId}>
              <FileStack className="size-4" aria-hidden="true" />
              Generate invoices
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/**
 * Status badge + an inline "edit status" affordance right next to it, on
 * the invoice list itself — before this, correcting a status meant opening
 * the invoice's own detail page first. Deliberately reuses the exact same
 * two actions (and the exact same role gating) already on that detail
 * page (InvoiceDetailPage's handleMarkPaid/handleRevertToUnpaid) rather
 * than inventing a free-form status dropdown: those are the only two
 * transitions the backend actually exposes (mark-paid / revert-to-unpaid),
 * so a dropdown offering more would just 403 on submit.
 */
function InvoiceStatusCell({ invoice, onUpdated }: { invoice: InvoiceListItem; onUpdated: () => void }) {
  const { user } = useAuth();
  const [isEditing, setIsEditing] = useState(false);

  const canRevert = invoice.status === "PAID" && user?.role === "ACCOUNTANT";
  const canMarkPaid =
    invoice.status !== "PAID" &&
    invoice.status !== "CANCELLED" &&
    (user?.role === "SCHOOL_ADMIN" || user?.role === "ACCOUNTANT" || user?.role === "FRONT_DESK");
  const canEdit = canRevert || canMarkPaid;

  const handleMarkPaid = async () => {
    await feesApi.markPaid(invoice.id);
    setIsEditing(false);
    onUpdated();
  };

  const handleRevert = async () => {
    await feesApi.revertToUnpaid(invoice.id);
    setIsEditing(false);
    onUpdated();
  };

  return (
    <div className="flex flex-col items-start gap-2">
      <div className="flex items-center gap-1.5">
        <Badge tone={STATUS_TONE[invoice.status]}>{invoice.status.replace("_", " ")}</Badge>
        {canEdit && (
          <button
            type="button"
            aria-label={`Edit status for invoice ${invoice.invoiceNumber}`}
            className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            onClick={() => setIsEditing((v) => !v)}
          >
            <Pencil className="size-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
      {isEditing && canRevert && (
        <ConfirmButton
          triggerLabel="Revert to unpaid"
          triggerVariant="outline"
          confirmLabel="Yes, revert this"
          confirmVariant="danger"
          size="sm"
          title="Revert this invoice to unpaid?"
          description="This undoes the most recent payment that settled it — use this only to correct a mistake."
          onConfirm={handleRevert}
        />
      )}
      {isEditing && canMarkPaid && (
        <ConfirmButton
          triggerLabel="Mark fully paid"
          triggerVariant="primary"
          confirmLabel="Confirm mark paid"
          confirmVariant="primary"
          size="sm"
          title="Mark this invoice as fully paid?"
          description={`The remaining balance will be recorded as a payment for ${invoice.student.fullName}.`}
          onConfirm={handleMarkPaid}
        />
      )}
    </div>
  );
}

function InvoicesSection() {
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const { data, isLoading, error, refetch } = useAsync(
    () => feesApi.listInvoices({ page, limit: 20, status: (status || undefined) as never }),
    [page, status],
  );

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Invoices</CardTitle>
        <Select
          value={status}
          onChange={(e) => {
            setPage(1);
            setStatus(e.target.value);
          }}
          className="w-44"
        >
          <option value="">All statuses</option>
          <option value="UNPAID">Unpaid</option>
          <option value="PARTIALLY_PAID">Partially paid</option>
          <option value="PAID">Paid</option>
          <option value="OVERDUE">Overdue</option>
          <option value="CANCELLED">Cancelled</option>
        </Select>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {isLoading && <Spinner label="Loading invoices" />}
        {error && <Alert tone="danger">{error.message}</Alert>}

        {data && (
          <>
            {data.data.length === 0 ? (
              <EmptyState message="No invoices found." />
            ) : (
              <Table>
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>Invoice #</TableHeaderCell>
                    <TableHeaderCell>Student</TableHeaderCell>
                    <TableHeaderCell>Total</TableHeaderCell>
                    <TableHeaderCell>Paid</TableHeaderCell>
                    <TableHeaderCell>Due</TableHeaderCell>
                    <TableHeaderCell>Status</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.data.map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell>
                        <Link
                          href={`/dashboard/fees/invoices/${inv.id}`}
                          className="font-medium text-primary-600 hover:underline"
                        >
                          {inv.invoiceNumber}
                        </Link>
                      </TableCell>
                      <TableCell>{inv.student.fullName}</TableCell>
                      <TableCell>Rs {Number(inv.totalAmount).toLocaleString()}</TableCell>
                      <TableCell>Rs {Number(inv.paidAmount).toLocaleString()}</TableCell>
                      <TableCell>{new Date(inv.dueDate).toLocaleDateString()}</TableCell>
                      <TableCell>
                        <InvoiceStatusCell invoice={inv} onUpdated={refetch} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <div className="flex items-center justify-between text-sm text-slate-500">
              <span>
                Page {data.meta.page} of {data.meta.totalPages} — {data.meta.total} total
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
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
  );
}

export default function FeesPage() {
  // Lifted here (rather than fetched independently inside CategoriesSection
  // and StructureSection) so adding a category in one immediately shows up
  // in the other's "select category" dropdown — previously each section had
  // its own independent useAsync() call with no shared cache (see
  // useAsync's doc comment), so a newly-added category only appeared in the
  // Fee Structure form after a full page reload.
  const { data: categories, isLoading: isLoadingCategories, refetch: refetchCategories } = useAsync(
    () => feesApi.listCategories(),
    [],
  );

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-page-title font-semibold text-slate-900">Fees</h1>
      <CategoriesSection categories={categories} isLoading={isLoadingCategories} refetch={refetchCategories} />
      <StructureSection categories={categories} />
      <LateFeePolicySection />
      <BulkGenerateSection />
      <DefaultersSection />
      <InvoicesSection />
    </div>
  );
}
