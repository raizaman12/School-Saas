import { api } from "@/lib/api";
import type { Paginated } from "./types";

export type NotificationChannel = "IN_APP" | "SMS" | "EMAIL" | "WHATSAPP";
export type NotificationStatus = "PENDING" | "SENT" | "FAILED";
export type BroadcastTarget = "SECTION_GUARDIANS" | "STAFF_ROLE";
export type BroadcastRole = "SCHOOL_ADMIN" | "TEACHER" | "ACCOUNTANT" | "FRONT_DESK";

export interface NotificationItem {
  id: string;
  channel: NotificationChannel;
  status: NotificationStatus;
  subject: string | null;
  body: string;
  errorMessage: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface BroadcastInput {
  channel: NotificationChannel;
  target: BroadcastTarget;
  sectionId?: string;
  role?: BroadcastRole;
  subject?: string;
  body: string;
}

export interface BroadcastResult {
  target: BroadcastTarget;
  totalRecipients: number;
  sent: number;
  failed: number;
}

export interface ChannelStatus {
  live: boolean;
  provider: string;
}

export type ChannelStatusMap = Record<"SMS" | "WHATSAPP" | "EMAIL", ChannelStatus>;

export const notificationsApi = {
  list: (params: { page?: number; limit?: number; unreadOnly?: boolean } = {}) => {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined) search.set(k, String(v));
    });
    const qs = search.toString();
    return api.get<Paginated<NotificationItem> & { meta: { unreadCount: number } }>(
      `/api/notifications${qs ? `?${qs}` : ""}`,
    );
  },
  markRead: (id: string) => api.patch<{ data: NotificationItem }>(`/api/notifications/${id}/read`).then((r) => r.data),
  broadcast: (input: BroadcastInput) =>
    api.post<{ data: BroadcastResult }>("/api/notifications/broadcast", input).then((r) => r.data),
  channelStatus: () => api.get<{ data: ChannelStatusMap }>("/api/notifications/channel-status").then((r) => r.data),
};
