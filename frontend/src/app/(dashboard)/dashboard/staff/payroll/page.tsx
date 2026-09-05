"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Users } from "lucide-react";
import { useAsync } from "@/lib/hooks/useAsync";
import { staffApi } from "@/lib/resources/staff";
import { payrollApi } from "@/lib/resources/payroll";
import { ApiError } from "@/lib/api";
import {
  Button,
  ConfirmButton,
  Input,
  Select,
  Badge,
  Alert,
  Spinner,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
  EmptyState,
} from "@/components/ui";

const generateSchema = z.object({
  staffProfileId: z.string().uuid("Select a staff member"),
  month: z.string().min(1, "Required"),
  allowances: z.coerce.number().min(0).optional(),
  deductions: z.coerce.number().min(0).optional(),
});
type GenerateFormValues = z.infer<typeof generateSchema>;

/**
 * The bulk counterpart of the single-staff generate form above — "it's the
 * 1st of the month" in one click instead of repeating that form once per
 * employee. No allowances/deductions field here (those are per-person); an
 * exception can still be handled via the regular form afterward.
 */
function BulkGenerateSection({ onGenerated }: { onGenerated: () => void }) {
  const [month, setMonth] = useState("");
  const [result, setResult] = useState<{ generated: number; skipped: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!month) return;
    setIsSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const res = await payrollApi.bulkGenerate({ month });
      setResult(res);
      onGenerated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not generate payroll.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:flex-row sm:items-end sm:justify-between"
    >
      <div className="flex flex-wrap items-end gap-3">
        <Input label="Month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-48" />
        <Button type="submit" size="sm" isLoading={isSubmitting} disabled={!month}>
          <Users className="size-4" aria-hidden="true" />
          Generate for all staff
        </Button>
      </div>
      <div className="flex-1">
        {error && <Alert tone="danger">{error}</Alert>}
        {result && (
          <Alert tone="success">
            Generated payroll for {result.generated} staff member(s), skipped {result.skipped} (already generated for
            this month).
          </Alert>
        )}
      </div>
    </form>
  );
}

export default function PayrollPage() {
  const [month, setMonth] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useAsync(
    () => payrollApi.list({ page, limit: 20, month: month || undefined }),
    [page, month],
  );
  const { data: staffList } = useAsync(() => staffApi.list({ page: 1, limit: 100 }), []);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof generateSchema>, unknown, GenerateFormValues>({
    resolver: zodResolver(generateSchema),
  });

  const onSubmit = async (values: GenerateFormValues) => {
    setFormError(null);
    try {
      await payrollApi.generate(values);
      reset();
      setOpen(false);
      refetch();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not generate payroll.");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-page-title font-semibold text-slate-900">Payroll</h1>
        <Button size="sm" onClick={() => setOpen((v) => !v)}>
          <Plus className="size-4" aria-hidden="true" />
          Generate payroll
        </Button>
      </div>

      {open && (
        <form
          onSubmit={handleSubmit(onSubmit)}
          noValidate
          className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4"
        >
          {formError && (
            <Alert tone="danger" className="mb-1">
              {formError}
            </Alert>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Select label="Staff member" required error={errors.staffProfileId?.message} {...register("staffProfileId")}>
              <option value="">Select staff…</option>
              {staffList?.data.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.user.fullName} — {s.employeeCode}
                </option>
              ))}
            </Select>
            <Input label="Month" type="month" required error={errors.month?.message} {...register("month")} />
            <Input label="Allowances (Rs)" type="number" {...register("allowances")} />
            <Input label="Deductions (Rs)" type="number" {...register("deductions")} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" isLoading={isSubmitting}>
              Generate
            </Button>
          </div>
        </form>
      )}

      <BulkGenerateSection onGenerated={refetch} />

      <div className="flex flex-wrap items-end gap-3">
        <Input
          label="Month filter"
          type="month"
          value={month}
          onChange={(e) => {
            setPage(1);
            setMonth(e.target.value);
          }}
          className="w-48"
        />
      </div>

      {isLoading && <Spinner label="Loading payroll" />}
      {error && <p className="text-sm text-red-600">Failed to load payroll: {error.message}</p>}

      {data && (
        <>
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Month</TableHeaderCell>
                <TableHeaderCell>Staff</TableHeaderCell>
                <TableHeaderCell>Net salary</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Actions</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.data.map((record) => (
                <TableRow key={record.id}>
                  <TableCell>{record.month}</TableCell>
                  <TableCell>
                    {record.staffProfile.user.fullName}
                    <span className="ml-1 text-xs text-slate-400">({record.staffProfile.employeeCode})</span>
                  </TableCell>
                  <TableCell>Rs {Number(record.netSalary).toLocaleString()}</TableCell>
                  <TableCell>
                    <Badge tone={record.status === "PAID" ? "success" : "warning"}>{record.status}</Badge>
                  </TableCell>
                  <TableCell>
                    {record.status === "PENDING" && (
                      <ConfirmButton
                        triggerLabel="Mark paid"
                        triggerVariant="outline"
                        confirmLabel="Confirm mark paid"
                        confirmVariant="primary"
                        title="Mark this payroll record as paid?"
                        description={`Rs ${Number(record.netSalary).toLocaleString()} for ${record.staffProfile.user.fullName}, ${record.month}.`}
                        onConfirm={() => payrollApi.markPaid(record.id).then(refetch)}
                      />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {data.data.length === 0 && <EmptyState message="No payroll records found." />}

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
    </div>
  );
}
