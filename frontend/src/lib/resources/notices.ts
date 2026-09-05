import { api } from "@/lib/api";
import type { Paginated } from "./types";

export type NoticeAudience = "ALL_STAFF" | "ALL_GUARDIANS" | "ALL_STUDENTS" | "SECTION" | "INDIVIDUAL";
export type NoticeTone = "GENERAL" | "IMPORTANT" | "URGENT" | "EVENT" | "HOLIDAY";

export interface NoticeRecipient {
  user: { id: string; fullName: string; role: string };
}

export interface Notice {
  id: string;
  title: string;
  body: string;
  // One or more audiences at once — e.g. ["ALL_STUDENTS", "ALL_GUARDIANS"].
  audiences: NoticeAudience[];
  tone: NoticeTone;
  isPinned: boolean;
  publishedAt: string;
  section: { id: string; name: string; schoolClass: { name: string } } | null;
  publishedByUser: { id: string; fullName: string };
  recipients: NoticeRecipient[];
}

export interface CreateNoticeInput {
  title: string;
  body: string;
  audiences: NoticeAudience[];
  tone?: NoticeTone;
  isPinned?: boolean;
  // Only meaningful when audiences includes SECTION.
  sectionId?: string;
  // Only meaningful when audiences includes INDIVIDUAL — the backend
  // resolves each entity id to a concrete portal-login userId.
  recipientStudentIds?: string[];
  recipientGuardianIds?: string[];
  recipientStaffUserIds?: string[];
}

export const noticesApi = {
  list: (params: { page?: number; limit?: number; sectionId?: string } = {}) => {
    const search = new URLSearchParams();
    if (params.page !== undefined) search.set("page", String(params.page));
    if (params.limit !== undefined) search.set("limit", String(params.limit));
    if (params.sectionId) search.set("sectionId", params.sectionId);
    const qs = search.toString();
    return api.get<Paginated<Notice>>(`/api/notices${qs ? `?${qs}` : ""}`);
  },
  create: (input: CreateNoticeInput) => api.post<{ data: Notice }>("/api/notices", input).then((r) => r.data),
  update: (id: string, input: { title?: string; body?: string; isPinned?: boolean; tone?: NoticeTone }) =>
    api.patch<{ data: Notice }>(`/api/notices/${id}`, input).then((r) => r.data),
  remove: (id: string) => api.delete<void>(`/api/notices/${id}`),
};
