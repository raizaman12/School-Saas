"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Check, X, Ban } from "lucide-react";
import { useAsync } from "@/lib/hooks/useAsync";
import { useAuth } from "@/lib/auth/AuthProvider";
import { leaveRequestsApi, type LeaveStatus, type LeaveType } from "@/lib/resources/leaveRequests";
import { studentLeaveRequestsApi, type StudentLeaveStatus } from "@/lib/resources/studentLeaveRequests";
import { ApiError } from "@/lib/api";
import {
  Button,
  Input,
  Textarea,
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

const leaveSchema = z
  .object({
    leaveType: z.enum(["SICK", "CASUAL", "ANNUAL", "UNPAID", "OTHER"]),
    fromDate: z.string().min(1, "Required"),
    toDate: z.string().min(1, "Required"),
    reason: z.string().min(2, "Required").max(1000),
  })
  .refine((v) => v.toDate >= v.fromDate, { message: "Must be on or after the start date", path: ["toDate"] });
type LeaveFormValues = z.infer<typeof leaveSchema>;

const LEAVE_TYPE_LABEL: Record<LeaveType, string> = {
  SICK: "Sick",
  CASUAL: "Casual",
  ANNUAL: "Annual",
  UNPAID: "Unpaid",
  OTHER: "Other",
};

const STATUS_TONE: Record<LeaveStatus, "success" | "default" | "warning" | "danger"> = {
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "danger",
  CANCELLED: "default",
};

/** A staff member's own HR leave (sick/casual/annual/…) — every staff role
 * files for themselves; SCHOOL_ADMIN reviews everyone's. */
function StaffLeaveSection() {
  const { user } = useAuth();
  const isSchoolAdmin = user?.role === "SCHOOL_ADMIN";
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actioningId, setActioningId] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useAsync(
    () => leaveRequestsApi.list({ page, limit: 20, status: (status || undefined) as LeaveStatus | undefined }),
    [page, status],
  );

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<LeaveFormValues>({ resolver: zodResolver(leaveSchema), defaultValues: { leaveType: "CASUAL" } });

  const onSubmit = async (values: LeaveFormValues) => {
    setFormError(null);
    try {
      await leaveRequestsApi.create(values);
      reset();
      setOpen(false);
      refetch();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not submit leave request.");
    }
  };

  const runAction = async (id: string, action: "cancel" | "approve" | "reject") => {
    setActionError(null);
    setActioningId(id);
    try {
      if (action === "cancel") await leaveRequestsApi.cancel(id);
      else if (action === "approve") await leaveRequestsApi.approve(id);
      else await leaveRequestsApi.reject(id);
      refetch();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not update this leave request.");
    } finally {
      setActioningId(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-900">My / staff leave</h2>
        <Button size="sm" onClick={() => setOpen((v) => !v)}>
          <Plus className="size-4" aria-hidden="true" />
          Request leave
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Select label="Type" required {...register("leaveType")}>
              <option value="SICK">Sick</option>
              <option value="CASUAL">Casual</option>
              <option value="ANNUAL">Annual</option>
              <option value="UNPAID">Unpaid</option>
              <option value="OTHER">Other</option>
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

      <div className="flex justify-end">
        <Select
          value={status}
          onChange={(e) => {
            setPage(1);
            setStatus(e.target.value);
          }}
          className="w-44"
        >
          <option value="">All statuses</option>
          <option value="PENDING">Pending</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
          <option value="CANCELLED">Cancelled</option>
        </Select>
      </div>

      {isLoading && <Spinner label="Loading leave requests" />}
      {error && <p className="text-sm text-red-600">Failed to load leave requests: {error.message}</p>}

      {data && (
        <>
          {data.data.length === 0 ? (
            <EmptyState message="No leave requests found." />
          ) : (
            <Table>
              <TableHead>
                <TableRow>
                  {isSchoolAdmin && <TableHeaderCell>Staff</TableHeaderCell>}
                  <TableHeaderCell>Type</TableHeaderCell>
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
                    {isSchoolAdmin && (
                      <TableCell>
                        {lr.staffProfile.user.fullName}
                        <div className="text-xs text-slate-500">{lr.staffProfile.designation}</div>
                      </TableCell>
                    )}
                    <TableCell>{LEAVE_TYPE_LABEL[lr.leaveType]}</TableCell>
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
                        <div className="flex flex-wrap gap-2">
                          {isSchoolAdmin && (
                            <>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => runAction(lr.id, "approve")}
                                isLoading={actioningId === lr.id}
                              >
                                <Check className="size-4" aria-hidden="true" />
                                Approve
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => runAction(lr.id, "reject")}
                                isLoading={actioningId === lr.id}
                              >
                                <X className="size-4" aria-hidden="true" />
                                Reject
                              </Button>
                            </>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => runAction(lr.id, "cancel")}
                            isLoading={actioningId === lr.id}
                          >
                            <Ban className="size-4" aria-hidden="true" />
                            Cancel
                          </Button>
                        </div>
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

const STUDENT_LEAVE_STATUS_TONE: Record<StudentLeaveStatus, "success" | "default" | "warning" | "danger"> = {
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "danger",
  CANCELLED: "default",
};

/**
 * Student absence/leave requests — submitted by a PARENT via the portal
 * (see /portal/leave-requests), visible here to SCHOOL_ADMIN (everything)
 * and every TEACHER who teaches that student (class teacher OR subject
 * teacher — the backend scopes this automatically).
 */
function StudentLeaveSection() {
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actioningId, setActioningId] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useAsync(
    () =>
      studentLeaveRequestsApi.list({
        page,
        limit: 20,
        status: (status || undefined) as StudentLeaveStatus | undefined,
      }),
    [page, status],
  );

  const runAction = async (id: string, action: "approve" | "reject") => {
    setActionError(null);
    setActioningId(id);
    try {
      if (action === "approve") await studentLeaveRequestsApi.approve(id);
      else await studentLeaveRequestsApi.reject(id);
      refetch();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not update this leave request.");
    } finally {
      setActioningId(null);
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Student leave requests</CardTitle>
        <Select
          value={status}
          onChange={(e) => {
            setPage(1);
            setStatus(e.target.value);
          }}
          className="w-44"
        >
          <option value="">All statuses</option>
          <option value="PENDING">Pending</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
          <option value="CANCELLED">Cancelled</option>
        </Select>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-slate-500">
          Absence requests submitted by parents through their portal — routed to every teacher who teaches that
          student, not just the class teacher.
        </p>

        {actionError && <Alert tone="danger">{actionError}</Alert>}
        {isLoading && <Spinner label="Loading student leave requests" />}
        {error && <p className="text-sm text-red-600">Failed to load: {error.message}</p>}

        {data && (
          <>
            {data.data.length === 0 ? (
              <EmptyState message="No student leave requests." />
            ) : (
              <Table>
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>Student</TableHeaderCell>
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
                      <TableCell>
                        {lr.student.fullName}
                        <div className="text-xs text-slate-500">
                          {lr.student.currentSection
                            ? `${lr.student.currentSection.schoolClass.name} - ${lr.student.currentSection.name}`
                            : lr.student.studentCode}
                        </div>
                      </TableCell>
                      <TableCell>{new Date(lr.fromDate).toLocaleDateString()}</TableCell>
                      <TableCell>{new Date(lr.toDate).toLocaleDateString()}</TableCell>
                      <TableCell className="max-w-xs">
                        <div className="line-clamp-2">{lr.reason}</div>
                        {lr.reviewNote && (
                          <div className="mt-0.5 text-xs text-slate-500">Note: {lr.reviewNote}</div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge tone={STUDENT_LEAVE_STATUS_TONE[lr.status]}>{lr.status}</Badge>
                      </TableCell>
                      <TableCell>
                        {lr.status === "PENDING" && (
                          <div className="flex flex-wrap gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => runAction(lr.id, "approve")}
                              isLoading={actioningId === lr.id}
                            >
                              <Check className="size-4" aria-hidden="true" />
                              Approve
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => runAction(lr.id, "reject")}
                              isLoading={actioningId === lr.id}
                            >
                              <X className="size-4" aria-hidden="true" />
                              Reject
                            </Button>
                          </div>
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
      </CardContent>
    </Card>
  );
}

export default function LeaveRequestsPage() {
  const { user } = useAuth();
  const canReviewStudentLeave = user?.role === "SCHOOL_ADMIN" || user?.role === "TEACHER";

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-page-title font-semibold text-slate-900">Leave requests</h1>
      <StaffLeaveSection />
      {canReviewStudentLeave && <StudentLeaveSection />}
    </div>
  );
}
