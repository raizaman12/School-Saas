"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Ban } from "lucide-react";
import { useAsync } from "@/lib/hooks/useAsync";
import { portalApi } from "@/lib/resources/portal";
import { portalLeaveRequestsApi, type StudentLeaveStatus } from "@/lib/resources/studentLeaveRequests";
import { ApiError } from "@/lib/api";
import {
  Button,
  Input,
  Textarea,
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

const leaveSchema = z
  .object({
    studentId: z.string().uuid("Choose a child"),
    fromDate: z.string().min(1, "Required"),
    toDate: z.string().min(1, "Required"),
    reason: z.string().min(2, "Required").max(1000),
  })
  .refine((v) => v.toDate >= v.fromDate, { message: "Must be on or after the start date", path: ["toDate"] });
type LeaveFormValues = z.infer<typeof leaveSchema>;

const STATUS_TONE: Record<StudentLeaveStatus, "success" | "default" | "warning" | "danger"> = {
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "danger",
  CANCELLED: "default",
};

/** PARENT-only: request an absence/leave for one of your children, and
 * track its status. A STUDENT portal account is redirected away — leave
 * requests can only be created by a parent, per school policy. */
export default function PortalLeaveRequestsPage() {
  const router = useRouter();
  const { data: me, isLoading: meLoading } = useAsync(() => portalApi.me(), []);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useAsync(() => portalLeaveRequestsApi.list({ page, limit: 20 }), [page]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<LeaveFormValues>({ resolver: zodResolver(leaveSchema) });

  useEffect(() => {
    if (!meLoading && me?.role === "STUDENT") {
      router.replace("/portal");
    }
  }, [meLoading, me, router]);

  if (meLoading || me?.role === "STUDENT") return <Spinner label="Loading" />;

  const children = me?.role === "PARENT" ? me.children : [];

  const onSubmit = async (values: LeaveFormValues) => {
    setFormError(null);
    try {
      await portalLeaveRequestsApi.create(values);
      reset();
      setOpen(false);
      refetch();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not submit leave request.");
    }
  };

  const onCancel = async (id: string) => {
    setActionError(null);
    setCancellingId(id);
    try {
      await portalLeaveRequestsApi.cancel(id);
      refetch();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not cancel this leave request.");
    } finally {
      setCancellingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-page-title font-semibold text-slate-900">Leave requests</h1>
          <p className="text-sm text-slate-500">
            Let the school know in advance if your child will be absent — this goes straight to their teachers and
            the school office.
          </p>
        </div>
        <Button size="sm" onClick={() => setOpen((v) => !v)} disabled={children.length === 0}>
          <Plus className="size-4" aria-hidden="true" />
          Request leave
        </Button>
      </div>

      {children.length === 0 && (
        <Alert tone="warning">No children are linked to your account yet. Contact the school office.</Alert>
      )}

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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Select label="Child" required error={errors.studentId?.message} {...register("studentId")}>
              <option value="">Select…</option>
              {children.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.fullName}
                </option>
              ))}
            </Select>
            <Input label="From" type="date" required error={errors.fromDate?.message} {...register("fromDate")} />
            <Input label="To" type="date" required error={errors.toDate?.message} {...register("toDate")} />
          </div>
          <Textarea label="Reason" required error={errors.reason?.message} {...register("reason")} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" isLoading={isSubmitting}>
              Submit
            </Button>
          </div>
        </form>
      )}

      {actionError && <Alert tone="danger">{actionError}</Alert>}

      {isLoading && <Spinner label="Loading leave requests" />}
      {error && <p className="text-sm text-red-600">Failed to load leave requests: {error.message}</p>}

      {data && (
        <>
          {data.data.length === 0 ? (
            <EmptyState message="No leave requests yet." />
          ) : (
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Child</TableHeaderCell>
                  <TableHeaderCell>From</TableHeaderCell>
                  <TableHeaderCell>To</TableHeaderCell>
                  <TableHeaderCell>Reason</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Actions</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.data.map((lr) => (
                  <TableRow key={lr.id}>
                    <TableCell>{lr.student.fullName}</TableCell>
                    <TableCell>{new Date(lr.fromDate).toLocaleDateString()}</TableCell>
                    <TableCell>{new Date(lr.toDate).toLocaleDateString()}</TableCell>
                    <TableCell className="max-w-xs">
                      <div className="line-clamp-2">{lr.reason}</div>
                      {lr.reviewNote && (
                        <div className="mt-0.5 text-xs text-slate-500">Note: {lr.reviewNote}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge tone={STATUS_TONE[lr.status]}>{lr.status}</Badge>
                    </TableCell>
                    <TableCell>
                      {lr.status === "PENDING" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onCancel(lr.id)}
                          isLoading={cancellingId === lr.id}
                        >
                          <Ban className="size-4" aria-hidden="true" />
                          Cancel
                        </Button>
                      )}
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
    </div>
  );
}
