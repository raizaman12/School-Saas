"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Copy, Check } from "lucide-react";
import { studentsApi, type StudentPortalLogin } from "@/lib/resources/students";
import { ApiError } from "@/lib/api";
import { SectionCascadeSelect } from "@/components/domain/SectionCascadeSelect";
import { ImageUploadButton } from "@/components/domain/ImageUploadButton";
import { Button, Input, Select, Alert, Card, CardContent } from "@/components/ui";

const schema = z.object({
  fullName: z.string().min(2, "Required").max(150),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]),
  dateOfBirth: z.string().min(1, "Required"),
  bFormOrCnic: z.string().max(20).optional(),
  address: z.string().max(255).optional(),
  emergencyContact: z.string().max(100).optional(),
  city: z.string().max(100).optional(),
  email: z.string().email("Enter a valid email").optional().or(z.literal("")),
});
type FormValues = z.infer<typeof schema>;

export default function NewStudentPage() {
  const [formError, setFormError] = useState<string | null>(null);
  const [enrollment, setEnrollment] = useState<{ sectionId: string; academicYearId: string } | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [created, setCreated] = useState<{
    id: string;
    fullName: string;
    studentCode: string;
    portalLogin: StudentPortalLogin;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { gender: "MALE" } });

  const onSubmit = async (values: FormValues) => {
    setFormError(null);
    try {
      const res = await studentsApi.create({
        ...values,
        email: values.email || undefined,
        bFormOrCnic: values.bFormOrCnic || undefined,
        sectionId: enrollment?.sectionId,
        academicYearId: enrollment?.academicYearId,
        photoUrl: photoUrl || undefined,
      });
      setCreated({
        id: res.data.id,
        fullName: res.data.fullName,
        studentCode: res.data.studentCode,
        portalLogin: res.portalLogin,
      });
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    }
  };

  if (created) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-page-title font-semibold text-slate-900">Student admitted</h1>
        <Card>
          <CardContent className="flex flex-col gap-4">
            <Alert tone="success" title={`${created.fullName} has been admitted`}>
              {created.portalLogin.email
                ? "A student portal login was created and the credentials below were emailed automatically."
                : "A student portal login was created with the login ID below — share it and the temporary password with the student directly."}
            </Alert>
            <div className="flex flex-col gap-1 text-sm">
              <span className="text-slate-500">{created.portalLogin.email ? "Login email" : "Login ID"}</span>
              <span className="font-medium text-slate-900">{created.portalLogin.email ?? created.studentCode}</span>
            </div>
            <div className="flex flex-col gap-1 text-sm">
              <span className="text-slate-500">Temporary password</span>
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 font-mono text-sm">
                <span className="flex-1 select-all">{created.portalLogin.tempPassword}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    navigator.clipboard?.writeText(created.portalLogin.tempPassword);
                    setCopied(true);
                  }}
                >
                  {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Link href="/dashboard/students">
                <Button type="button" variant="outline">
                  Back to students list
                </Button>
              </Link>
              <Link href={`/dashboard/students/${created.id}`}>
                <Button type="button">View student profile</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-page-title font-semibold text-slate-900">Add student</h1>

      <Card>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
            {formError && <Alert tone="danger">{formError}</Alert>}

            <div className="flex items-center gap-4">
              {photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- external/self-hosted upload URL, not a local static asset next/image can optimize
                <img
                  src={photoUrl}
                  alt="Student photo preview"
                  className="size-16 rounded-full border border-slate-200 object-cover"
                />
              ) : (
                <div className="flex size-16 items-center justify-center rounded-full border border-dashed border-slate-300 text-xs text-slate-400">
                  No photo
                </div>
              )}
              <ImageUploadButton
                label={photoUrl ? "Change photo" : "Upload photo"}
                onUploaded={setPhotoUrl}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input label="Full name" required error={errors.fullName?.message} {...register("fullName")} />
              <Select label="Gender" required error={errors.gender?.message} {...register("gender")}>
                <option value="MALE">Male</option>
                <option value="FEMALE">Female</option>
                <option value="OTHER">Other</option>
              </Select>
              <Input
                label="Date of birth"
                type="date"
                required
                error={errors.dateOfBirth?.message}
                {...register("dateOfBirth")}
              />
              <Input label="B-Form / CNIC" {...register("bFormOrCnic")} />
              <Input label="Address" {...register("address")} />
              <Input label="Emergency contact" {...register("emergencyContact")} />
              <Input label="City" {...register("city")} />
            </div>

            <div className="border-t border-slate-100 pt-4">
              <Input
                label="Email"
                type="text"
                error={errors.email?.message}
                hint="Optional — a student portal login is always created, using the student's own ID to log in. Add an email here to also send the credentials by mail."
                {...register("email")}
              />
            </div>

            <div className="border-t border-slate-100 pt-4">
              <p className="mb-2 text-sm font-medium text-slate-700">
                Enroll into a section now <span className="font-normal text-slate-400">(optional)</span>
              </p>
              <SectionCascadeSelect onChange={setEnrollment} />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Link href="/dashboard/students">
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </Link>
              <Button type="submit" isLoading={isSubmitting}>
                Save student
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
