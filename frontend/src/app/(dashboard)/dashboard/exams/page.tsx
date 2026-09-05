"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Settings2 } from "lucide-react";
import { useAsync } from "@/lib/hooks/useAsync";
import { useAuth } from "@/lib/auth/AuthProvider";
import { academicsApi } from "@/lib/resources/academics";
import { examsApi } from "@/lib/resources/exams";
import { ApiError } from "@/lib/api";
import {
  Button,
  Input,
  Select,
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

const examSchema = z.object({
  academicYearId: z.string().uuid("Select a year"),
  name: z.string().min(1, "Required").max(100),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});
type ExamFormValues = z.infer<typeof examSchema>;

export default function ExamsPage() {
  const { user } = useAuth();
  const canManage = user?.role === "SCHOOL_ADMIN";
  const [open, setOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const { data: exams, isLoading, error, refetch } = useAsync(() => examsApi.list(), []);
  const { data: years } = useAsync(() => academicsApi.listYears(), []);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ExamFormValues>({ resolver: zodResolver(examSchema) });

  const onSubmit = async (values: ExamFormValues) => {
    setFormError(null);
    try {
      await examsApi.create({
        ...values,
        startDate: values.startDate || undefined,
        endDate: values.endDate || undefined,
      });
      reset();
      setOpen(false);
      refetch();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not create exam.");
    }
  };

  const yearName = (id: string) => years?.find((y) => y.id === id)?.name ?? "—";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-page-title font-semibold text-slate-900">Exams</h1>
        {canManage && (
          <div className="flex gap-2">
            <Link href="/dashboard/exams/grading-bands">
              <Button variant="outline" size="sm">
                <Settings2 className="size-4" aria-hidden="true" />
                Grading scale
              </Button>
            </Link>
            <Button size="sm" onClick={() => setOpen((v) => !v)}>
              <Plus className="size-4" aria-hidden="true" />
              New exam
            </Button>
          </div>
        )}
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
            <Input label="Exam name" placeholder="Mid Term" required error={errors.name?.message} {...register("name")} />
            <Select label="Academic year" required error={errors.academicYearId?.message} {...register("academicYearId")}>
              <option value="">Select year…</option>
              {years?.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.name}
                  {y.isActive ? " (active)" : ""}
                </option>
              ))}
            </Select>
            <Input label="Start date" type="date" {...register("startDate")} />
            <Input label="End date" type="date" {...register("endDate")} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" isLoading={isSubmitting}>
              Create exam
            </Button>
          </div>
        </form>
      )}

      {isLoading && <Spinner label="Loading exams" />}
      {error && <p className="text-sm text-red-600">Failed to load exams: {error.message}</p>}

      {exams && (
        <>
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>Academic year</TableHeaderCell>
                <TableHeaderCell>Dates</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {exams.map((exam) => (
                <TableRow key={exam.id}>
                  <TableCell>
                    <Link href={`/dashboard/exams/${exam.id}`} className="font-medium text-primary-600 hover:underline">
                      {exam.name}
                    </Link>
                  </TableCell>
                  <TableCell>{yearName(exam.academicYearId)}</TableCell>
                  <TableCell>
                    {exam.startDate && exam.endDate
                      ? `${new Date(exam.startDate).toLocaleDateString()} – ${new Date(exam.endDate).toLocaleDateString()}`
                      : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {exams.length === 0 && <EmptyState message="No exams created yet." />}
        </>
      )}
    </div>
  );
}
