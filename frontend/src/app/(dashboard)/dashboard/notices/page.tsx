"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Pin, Users } from "lucide-react";
import { useAsync } from "@/lib/hooks/useAsync";
import { useAuth } from "@/lib/auth/AuthProvider";
import { noticesApi, type NoticeAudience, type NoticeTone } from "@/lib/resources/notices";
import { academicsApi } from "@/lib/resources/academics";
import { RecipientPicker, type SelectedRecipient } from "@/components/domain/RecipientPicker";
import { ApiError } from "@/lib/api";
import {
  Button,
  ConfirmButton,
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

const noticeSchema = z.object({
  title: z.string().min(2, "Required").max(200),
  body: z.string().min(2, "Required").max(5000),
  tone: z.enum(["GENERAL", "IMPORTANT", "URGENT", "EVENT", "HOLIDAY"]),
  isPinned: z.boolean().optional(),
});
type NoticeFormValues = z.infer<typeof noticeSchema>;

const AUDIENCE_LABEL: Record<NoticeAudience, string> = {
  ALL_STAFF: "All staff",
  ALL_GUARDIANS: "All guardians",
  ALL_STUDENTS: "All students",
  SECTION: "One section",
  INDIVIDUAL: "Individual",
};

const TONE_LABEL: Record<NoticeTone, string> = {
  GENERAL: "General",
  IMPORTANT: "Important",
  URGENT: "Urgent",
  EVENT: "Event",
  HOLIDAY: "Holiday",
};

const TONE_BADGE: Record<NoticeTone, "default" | "info" | "danger" | "success" | "warning"> = {
  GENERAL: "default",
  IMPORTANT: "info",
  URGENT: "danger",
  EVENT: "success",
  HOLIDAY: "warning",
};

function audienceSummary(notice: { audiences: NoticeAudience[]; section: { schoolClass: { name: string }; name: string } | null; recipients: unknown[] }) {
  return notice.audiences
    .map((a) => {
      if (a === "SECTION" && notice.section) return `${notice.section.schoolClass.name} - ${notice.section.name}`;
      if (a === "INDIVIDUAL") return `Individual (${notice.recipients.length})`;
      return AUDIENCE_LABEL[a];
    })
    .join(" + ");
}

export default function NoticesPage() {
  const { user } = useAuth();
  const isSchoolAdmin = user?.role === "SCHOOL_ADMIN";
  // A TEACHER may only publish SECTION and/or INDIVIDUAL notices — school-wide
  // audiences stay SCHOOL_ADMIN-only, matching the backend's WRITE_ROLES rules.
  const canPublish = isSchoolAdmin || user?.role === "TEACHER";
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [recipients, setRecipients] = useState<SelectedRecipient[]>([]);
  const [sectionId, setSectionId] = useState("");
  // Multiple audiences can now be combined in one notice (e.g. every
  // student AND every guardian together, or a section plus a few named
  // individual add-ons) — a checkbox group instead of a single dropdown.
  const [selectedAudiences, setSelectedAudiences] = useState<Set<NoticeAudience>>(new Set());
  const { data, isLoading, error, refetch } = useAsync(() => noticesApi.list({ page, limit: 20 }), [page]);
  const { data: sectionsData } = useAsync(() => academicsApi.listSections(), []);
  // A TEACHER may target any section they're connected to — as class
  // teacher (homeroom) OR as the subject teacher for one of its courses —
  // matching the backend's teacherSectionIds() check. Narrowing the picker
  // here avoids a round-trip 403 for a section that would never be allowed
  // anyway; SCHOOL_ADMIN sees every section.
  const { data: myCoursesData } = useAsync(
    () => (user?.role === "TEACHER" ? academicsApi.mySectionSubjects() : Promise.resolve([])),
    [user?.role],
  );
  const myTaughtSectionIds = new Set((myCoursesData ?? []).map((c) => c.section.id));
  const availableSections = (sectionsData ?? []).filter(
    (s) => isSchoolAdmin || s.classTeacher?.id === user?.id || myTaughtSectionIds.has(s.id),
  );

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<NoticeFormValues>({
    resolver: zodResolver(noticeSchema),
    defaultValues: { tone: "GENERAL" },
  });

  const toggleAudience = (audience: NoticeAudience) => {
    setSelectedAudiences((cur) => {
      const next = new Set(cur);
      if (next.has(audience)) next.delete(audience);
      else next.add(audience);
      return next;
    });
  };

  const resetForm = () => {
    reset({ tone: "GENERAL" });
    setSelectedAudiences(new Set());
    setRecipients([]);
    setSectionId("");
  };

  const onSubmit = async (values: NoticeFormValues) => {
    setFormError(null);
    const audiences = Array.from(selectedAudiences);
    if (audiences.length === 0) {
      setFormError("Choose at least one audience.");
      return;
    }
    if (audiences.includes("INDIVIDUAL") && recipients.length === 0) {
      setFormError("Choose at least one student, guardian, or staff member to notify.");
      return;
    }
    if (audiences.includes("SECTION") && !sectionId) {
      setFormError("Choose a section to notify.");
      return;
    }
    try {
      await noticesApi.create({
        ...values,
        audiences,
        ...(audiences.includes("SECTION") ? { sectionId } : {}),
        ...(audiences.includes("INDIVIDUAL")
          ? {
              recipientStudentIds: recipients.filter((r) => r.category === "student").map((r) => r.id),
              recipientGuardianIds: recipients.filter((r) => r.category === "guardian").map((r) => r.id),
              recipientStaffUserIds: recipients.filter((r) => r.category === "staff").map((r) => r.id),
            }
          : {}),
      });
      resetForm();
      setOpen(false);
      refetch();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not publish notice.");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-page-title font-semibold text-slate-900">Notices</h1>
        {canPublish && (
          <Button size="sm" onClick={() => setOpen((v) => !v)}>
            <Plus className="size-4" aria-hidden="true" />
            Publish notice
          </Button>
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
          <Input label="Title" required error={errors.title?.message} {...register("title")} />
          <Textarea label="Message" required error={errors.body?.message} {...register("body")} />

          <div>
            <p className="mb-1.5 text-sm font-medium text-slate-700">
              Audience <span className="text-red-600">*</span>
            </p>
            <p className="mb-2 text-xs text-slate-500">
              Choose one or more — e.g. tick both &ldquo;All students&rdquo; and &ldquo;All guardians&rdquo; to
              reach both with a single notice.
            </p>
            <div className="flex flex-col gap-1.5">
              {isSchoolAdmin && (
                <>
                  {(["ALL_GUARDIANS", "ALL_STUDENTS", "ALL_STAFF"] as const).map((a) => (
                    <label key={a} className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        className="size-4 rounded border-slate-300"
                        checked={selectedAudiences.has(a)}
                        onChange={() => toggleAudience(a)}
                      />
                      {AUDIENCE_LABEL[a]}
                    </label>
                  ))}
                </>
              )}
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="size-4 rounded border-slate-300"
                  checked={selectedAudiences.has("SECTION")}
                  onChange={() => toggleAudience("SECTION")}
                />
                One section {!isSchoolAdmin && "(my class)"}
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="size-4 rounded border-slate-300"
                  checked={selectedAudiences.has("INDIVIDUAL")}
                  onChange={() => toggleAudience("INDIVIDUAL")}
                />
                Individual (choose people)
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Select label="Tone" required error={errors.tone?.message} {...register("tone")}>
              {(Object.keys(TONE_LABEL) as NoticeTone[]).map((tone) => (
                <option key={tone} value={tone}>
                  {TONE_LABEL[tone]}
                </option>
              ))}
            </Select>
            <label className="mt-6 flex items-center gap-2 py-2 text-sm text-slate-700">
              <input type="checkbox" className="size-4 rounded border-slate-300" {...register("isPinned")} />
              Pin to top
            </label>
          </div>

          {selectedAudiences.has("SECTION") && (
            <Select
              label="Section"
              required
              value={sectionId}
              onChange={(e) => setSectionId(e.target.value)}
            >
              <option value="">Select a section…</option>
              {availableSections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.schoolClass.name} - {s.name}
                </option>
              ))}
            </Select>
          )}

          {selectedAudiences.has("INDIVIDUAL") && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-slate-700">
                <Users className="size-4" aria-hidden="true" />
                Choose recipients
              </div>
              <RecipientPicker selected={recipients} onChange={setRecipients} />
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" isLoading={isSubmitting}>
              Publish
            </Button>
          </div>
        </form>
      )}

      {isLoading && <Spinner label="Loading notices" />}
      {error && <p className="text-sm text-red-600">Failed to load notices: {error.message}</p>}

      {data && (
        <>
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Title</TableHeaderCell>
                <TableHeaderCell>Tone</TableHeaderCell>
                <TableHeaderCell>Audience</TableHeaderCell>
                <TableHeaderCell>Published by</TableHeaderCell>
                <TableHeaderCell>Published</TableHeaderCell>
                {isSchoolAdmin && <TableHeaderCell>Actions</TableHeaderCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {data.data.map((notice) => (
                <TableRow key={notice.id}>
                  <TableCell>
                    <div className="flex items-center gap-1.5 font-medium text-slate-900">
                      {notice.isPinned && <Pin className="size-3.5 text-primary-600" aria-hidden="true" />}
                      {notice.title}
                    </div>
                    <div className="mt-0.5 max-w-md text-xs text-slate-500">{notice.body}</div>
                  </TableCell>
                  <TableCell>
                    <Badge tone={TONE_BADGE[notice.tone]}>{TONE_LABEL[notice.tone]}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge tone="default">{audienceSummary(notice)}</Badge>
                  </TableCell>
                  <TableCell>{notice.publishedByUser.fullName}</TableCell>
                  <TableCell>{new Date(notice.publishedAt).toLocaleDateString()}</TableCell>
                  {isSchoolAdmin && (
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => noticesApi.update(notice.id, { isPinned: !notice.isPinned }).then(refetch)}
                        >
                          {notice.isPinned ? "Unpin" : "Pin"}
                        </Button>
                        <ConfirmButton
                          triggerLabel="Delete"
                          confirmLabel="Confirm delete"
                          title="Delete this notice?"
                          description={`"${notice.title}" will be removed immediately for everyone it was published to.`}
                          onConfirm={() => noticesApi.remove(notice.id).then(refetch)}
                        />
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {data.data.length === 0 && <EmptyState message="No notices published yet." />}

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
