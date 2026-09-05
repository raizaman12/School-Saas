"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Pencil } from "lucide-react";
import { useAsync } from "@/lib/hooks/useAsync";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useRouter } from "next/navigation";
import { guardiansApi } from "@/lib/resources/guardians";
import { ResetPasswordButton } from "@/components/domain/ResetPasswordButton";
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
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
  EmptyState,
  ConfirmButton,
} from "@/components/ui";

const editSchema = z.object({
  fullName: z.string().min(2, "Required").max(150),
  relationship: z.enum(["FATHER", "MOTHER", "GUARDIAN"]),
  cnic: z
    .string()
    .regex(/^\d{5}-\d{7}-\d$/, "Expected format: 35202-1234567-1")
    .optional()
    .or(z.literal("")),
  phone: z.string().min(7, "Required").max(30),
  email: z.string().email("Enter a valid email").optional().or(z.literal("")),
  occupation: z.string().max(150).optional().or(z.literal("")),
});
type EditFormValues = z.infer<typeof editSchema>;

const RELATIONSHIP_LABEL: Record<string, string> = {
  FATHER: "Father",
  MOTHER: "Mother",
  GUARDIAN: "Guardian",
};

export default function GuardianDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useAuth();
  const router = useRouter();
  // Matches guardians.ts's WRITE_ROLES / DELETE_ROLES on the backend.
  const canEdit = user?.role === "SCHOOL_ADMIN" || user?.role === "FRONT_DESK";
  const canDelete = user?.role === "SCHOOL_ADMIN";
  const { data: guardian, isLoading, error, refetch } = useAsync(() => guardiansApi.get(id), [id]);
  const [isEditing, setIsEditing] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<EditFormValues>({ resolver: zodResolver(editSchema) });

  const startEditing = () => {
    if (!guardian) return;
    reset({
      fullName: guardian.fullName,
      relationship: guardian.relationship,
      cnic: guardian.cnic ?? "",
      phone: guardian.phone,
      email: guardian.email ?? "",
      occupation: guardian.occupation ?? "",
    });
    setEditError(null);
    setIsEditing(true);
  };

  const onSubmit = async (values: EditFormValues) => {
    setEditError(null);
    try {
      await guardiansApi.update(id, {
        fullName: values.fullName,
        relationship: values.relationship,
        cnic: values.cnic || undefined,
        phone: values.phone,
        email: values.email || undefined,
        occupation: values.occupation || undefined,
      });
      setIsEditing(false);
      refetch();
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : "Could not save changes.");
    }
  };

  const onDelete = async () => {
    setDeleteError(null);
    try {
      await guardiansApi.remove(id);
      router.push("/dashboard/guardians");
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : "Could not delete this guardian.");
      throw err; // keeps ConfirmButton's own inline error panel open too
    }
  };

  if (isLoading) return <Spinner label="Loading guardian" />;
  if (error) return <Alert tone="danger">Failed to load guardian: {error.message}</Alert>;
  if (!guardian) return null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-page-title font-semibold text-slate-900">{guardian.fullName}</h1>
          <p className="text-sm text-slate-500">{RELATIONSHIP_LABEL[guardian.relationship] ?? guardian.relationship}</p>
        </div>
        {canDelete && (
          <ConfirmButton
            triggerLabel="Delete"
            confirmLabel="Delete permanently"
            title="Delete this guardian?"
            description="This permanently removes the guardian's record and their portal login, if any. This cannot be undone. If they have filed leave requests for their child(ren), the delete will be blocked — remove them from the student's guardians instead."
            onConfirm={onDelete}
          />
        )}
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
          {isEditing ? (
            <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
              {editError && <Alert tone="danger">{editError}</Alert>}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input label="Full name" required error={errors.fullName?.message} {...register("fullName")} />
                <Select label="Relationship" required error={errors.relationship?.message} {...register("relationship")}>
                  <option value="FATHER">Father</option>
                  <option value="MOTHER">Mother</option>
                  <option value="GUARDIAN">Guardian</option>
                </Select>
                <Input label="Phone" required error={errors.phone?.message} {...register("phone")} />
                <Input label="Email" type="email" error={errors.email?.message} {...register("email")} />
                <Input
                  label="CNIC"
                  placeholder="35202-1234567-1"
                  error={errors.cnic?.message}
                  {...register("cnic")}
                />
                <Input label="Occupation" error={errors.occupation?.message} {...register("occupation")} />
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
                <dt className="text-slate-500">Relationship</dt>
                <dd className="text-slate-900">{RELATIONSHIP_LABEL[guardian.relationship] ?? guardian.relationship}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Phone</dt>
                <dd className="text-slate-900">{guardian.phone}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Email (portal login, if any)</dt>
                <dd className="text-slate-900">{guardian.email ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-slate-500">CNIC</dt>
                <dd className="text-slate-900">{guardian.cnic ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Occupation</dt>
                <dd className="text-slate-900">{guardian.occupation ?? "—"}</dd>
              </div>
              {canEdit && (
                <div className="col-span-2">
                  <dt className="text-slate-500">Portal login</dt>
                  <dd className="mt-1">
                    {guardian.userId ? (
                      <ResetPasswordButton userId={guardian.userId} />
                    ) : (
                      <span className="text-slate-400">No login yet</span>
                    )}
                  </dd>
                </div>
              )}
            </dl>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Linked students</CardTitle>
        </CardHeader>
        <CardContent>
          {guardian.students.length === 0 ? (
            <EmptyState message="No students linked to this guardian." />
          ) : (
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Admission code</TableHeaderCell>
                  <TableHeaderCell>Name</TableHeaderCell>
                  <TableHeaderCell>Primary guardian</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {guardian.students.map((s) => (
                  <TableRow key={s.student.id}>
                    <TableCell>
                      <Link
                        href={`/dashboard/students/${s.student.id}`}
                        className="font-medium text-primary-600 hover:underline"
                      >
                        {s.student.studentCode}
                      </Link>
                    </TableCell>
                    <TableCell>{s.student.fullName}</TableCell>
                    <TableCell>{s.isPrimary ? <Badge tone="info">Primary</Badge> : "—"}</TableCell>
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
