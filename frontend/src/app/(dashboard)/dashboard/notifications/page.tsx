"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Send, Radio } from "lucide-react";
import { useAsync } from "@/lib/hooks/useAsync";
import { notificationsApi, type BroadcastResult, type ChannelStatusMap } from "@/lib/resources/notifications";
import { SectionCascadeSelect } from "@/components/domain/SectionCascadeSelect";
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

const broadcastSchema = z
  .object({
    channel: z.enum(["SMS", "WHATSAPP", "EMAIL", "IN_APP"]),
    target: z.enum(["SECTION_GUARDIANS", "STAFF_ROLE"]),
    sectionId: z.string().uuid().optional(),
    role: z.enum(["SCHOOL_ADMIN", "TEACHER", "ACCOUNTANT", "FRONT_DESK"]).optional(),
    subject: z.string().max(200).optional(),
    body: z.string().min(1, "Required").max(2000),
  })
  .refine((v) => (v.target === "SECTION_GUARDIANS" ? !!v.sectionId : true), {
    message: "Select a section",
    path: ["sectionId"],
  })
  .refine((v) => (v.target === "STAFF_ROLE" ? !!v.role : true), { message: "Select a role", path: ["role"] });
type BroadcastFormValues = z.infer<typeof broadcastSchema>;

const STATUS_TONE: Record<string, "success" | "default" | "warning" | "danger"> = {
  SENT: "success",
  PENDING: "default",
  FAILED: "danger",
};

const CHANNEL_LABEL: Record<keyof ChannelStatusMap, string> = {
  SMS: "SMS",
  WHATSAPP: "WhatsApp",
  EMAIL: "Email",
};

/**
 * Tells an admin/staff member, at a glance, whether SMS/WhatsApp/Email
 * will actually reach a phone/inbox or are still just simulated (logged,
 * not delivered) — see backend providers/registry.ts. A tenant with no
 * live channels can still use everything (in-app inbox always works),
 * but a school shouldn't be surprised that a "sent" SMS never arrived.
 */
function ChannelStatusCard() {
  const { data, isLoading, error } = useAsync(() => notificationsApi.channelStatus(), []);

  if (isLoading || error || !data) return null;

  const anySimulated = Object.values(data).some((c) => !c.live);
  if (!anySimulated) return null; // everything's live — no need to clutter the page

  return (
    <Alert tone="warning" title="Some channels are not connected to a real provider yet">
      <div className="flex flex-col gap-1">
        <p>Messages on these channels are logged internally but not actually delivered to a phone/inbox:</p>
        <div className="mt-1 flex flex-wrap gap-2">
          {(Object.keys(data) as (keyof ChannelStatusMap)[])
            .filter((ch) => !data[ch].live)
            .map((ch) => (
              <Badge key={ch} tone="warning">
                <Radio className="size-3" aria-hidden="true" />
                {CHANNEL_LABEL[ch]} — simulated
              </Badge>
            ))}
        </div>
      </div>
    </Alert>
  );
}

function SendAnnouncementCard() {
  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<BroadcastResult | null>(null);
  const [sectionId, setSectionId] = useState<string | undefined>(undefined);
  const [target, setTarget] = useState<BroadcastFormValues["target"]>("SECTION_GUARDIANS");

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<BroadcastFormValues>({
    resolver: zodResolver(broadcastSchema),
    defaultValues: { channel: "SMS", target: "SECTION_GUARDIANS" },
  });

  const onSubmit = async (values: BroadcastFormValues) => {
    setFormError(null);
    setResult(null);
    try {
      const res = await notificationsApi.broadcast({ ...values, sectionId: target === "SECTION_GUARDIANS" ? sectionId : undefined });
      setResult(res);
      reset({ channel: values.channel, target: values.target });
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not send announcement.");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Send an announcement</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
          {formError && <Alert tone="danger">{formError}</Alert>}
          {result && (
            <Alert tone={result.failed > 0 ? "warning" : "success"} title="Announcement sent">
              {result.sent} of {result.totalRecipients} delivered{result.failed > 0 ? `, ${result.failed} failed` : ""}.
            </Alert>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Select label="Channel" required {...register("channel")}>
              <option value="SMS">SMS</option>
              <option value="WHATSAPP">WhatsApp</option>
              <option value="EMAIL">Email</option>
              <option value="IN_APP">In-app (staff only)</option>
            </Select>
            <Select
              label="Send to"
              required
              {...register("target", {
                onChange: (e) => setTarget(e.target.value as BroadcastFormValues["target"]),
              })}
            >
              <option value="SECTION_GUARDIANS">Guardians of a section</option>
              <option value="STAFF_ROLE">Staff by role</option>
            </Select>
          </div>

          {target === "SECTION_GUARDIANS" ? (
            <div>
              <SectionCascadeSelect onChange={(v) => setSectionId(v?.sectionId)} />
              {errors.sectionId && <p className="mt-1 text-xs text-red-600">{errors.sectionId.message}</p>}
            </div>
          ) : (
            <Select label="Role" required error={errors.role?.message} {...register("role")}>
              <option value="">Select role…</option>
              <option value="TEACHER">Teacher</option>
              <option value="ACCOUNTANT">Accountant</option>
              <option value="FRONT_DESK">Front desk</option>
              <option value="SCHOOL_ADMIN">School admin</option>
            </Select>
          )}

          <Input label="Subject" hint="Used for email; ignored for SMS/WhatsApp" {...register("subject")} />
          <Textarea label="Message" required error={errors.body?.message} {...register("body")} />

          <div className="flex justify-end">
            <Button type="submit" isLoading={isSubmitting}>
              <Send className="size-4" aria-hidden="true" />
              Send announcement
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function InboxCard() {
  const [page, setPage] = useState(1);
  const { data, isLoading, error, refetch } = useAsync(() => notificationsApi.list({ page, limit: 20 }), [page]);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Inbox</CardTitle>
        {!!data?.meta.unreadCount && <Badge tone="info">{data.meta.unreadCount} unread</Badge>}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {isLoading && <Spinner label="Loading inbox" />}
        {error && <p className="text-sm text-red-600">Failed to load inbox: {error.message}</p>}

        {data && (
          <>
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Message</TableHeaderCell>
                  <TableHeaderCell>Channel</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Received</TableHeaderCell>
                  <TableHeaderCell>Actions</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.data.map((n) => (
                  <TableRow key={n.id} className={n.readAt ? undefined : "bg-primary-50/40"}>
                    <TableCell>
                      {n.subject && <div className="font-medium text-slate-900">{n.subject}</div>}
                      <div className="max-w-md text-sm text-slate-600">{n.body}</div>
                    </TableCell>
                    <TableCell>{n.channel}</TableCell>
                    <TableCell>
                      <Badge tone={STATUS_TONE[n.status] ?? "default"}>{n.status}</Badge>
                    </TableCell>
                    <TableCell>{new Date(n.createdAt).toLocaleString()}</TableCell>
                    <TableCell>
                      {!n.readAt && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => notificationsApi.markRead(n.id).then(refetch)}
                        >
                          Mark as read
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {data.data.length === 0 && <EmptyState message="No notifications yet." />}

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

export default function NotificationsPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-page-title font-semibold text-slate-900">Notifications</h1>
      <ChannelStatusCard />
      <SendAnnouncementCard />
      <InboxCard />
    </div>
  );
}
