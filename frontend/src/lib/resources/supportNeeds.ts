import { api } from "@/lib/api";
import type { Paginated } from "./types";

// Mirrors backend schema.prisma's SupportNeedCategory/Status enums — see
// that file's doc comment for why this is modeled as an informal "Learning
// Support Plan" rather than a copy of PowerSchool's US IDEA/Section-504 IEP
// due-process machinery.
export type SupportNeedCategory =
  | "LEARNING_SUPPORT"
  | "ATTENTION_FOCUS_SUPPORT"
  | "SPEECH_LANGUAGE_SUPPORT"
  | "HEARING_SUPPORT"
  | "VISION_SUPPORT"
  | "MOBILITY_PHYSICAL_SUPPORT"
  | "SOCIAL_EMOTIONAL_SUPPORT"
  | "AUTISM_SPECTRUM_SUPPORT"
  | "INTELLECTUAL_DEVELOPMENTAL_SUPPORT"
  | "GIFTED_TALENTED_SUPPORT"
  | "OTHER";

export type SupportNeedStatus = "ACTIVE" | "UNDER_REVIEW" | "RESOLVED" | "DISCONTINUED";

export const SUPPORT_NEED_CATEGORY_LABEL: Record<SupportNeedCategory, string> = {
  LEARNING_SUPPORT: "Learning support",
  ATTENTION_FOCUS_SUPPORT: "Attention / focus support",
  SPEECH_LANGUAGE_SUPPORT: "Speech / language support",
  HEARING_SUPPORT: "Hearing support",
  VISION_SUPPORT: "Vision support",
  MOBILITY_PHYSICAL_SUPPORT: "Mobility / physical support",
  SOCIAL_EMOTIONAL_SUPPORT: "Social / emotional support",
  AUTISM_SPECTRUM_SUPPORT: "Autism spectrum support",
  INTELLECTUAL_DEVELOPMENTAL_SUPPORT: "Intellectual / developmental support",
  GIFTED_TALENTED_SUPPORT: "Gifted / talented support",
  OTHER: "Other",
};

export const SUPPORT_NEED_STATUS_LABEL: Record<SupportNeedStatus, string> = {
  ACTIVE: "Active",
  UNDER_REVIEW: "Under review",
  RESOLVED: "Resolved",
  DISCONTINUED: "Discontinued",
};

export interface SupportNeedReview {
  id: string;
  reviewDate: string;
  notes: string;
  updatedStatus: SupportNeedStatus | null;
  reviewedByUser?: { id: string; fullName: string };
}

export interface SupportNeed {
  id: string;
  category: SupportNeedCategory;
  description: string;
  identifiedDate: string;
  status: SupportNeedStatus;
  supportProvided: string;
  examAccommodations: string | null;
  nextReviewDate: string | null;
  createdAt: string;
  student: { id: string; fullName: string; studentCode: string; currentSectionId: string | null };
  coordinatorUser: { id: string; fullName: string } | null;
  createdByUser: { id: string; fullName: string };
  reviews: SupportNeedReview[];
}

export interface CreateSupportNeedInput {
  studentId: string;
  category: SupportNeedCategory;
  description: string;
  identifiedDate: string;
  supportProvided: string;
  examAccommodations?: string;
  coordinatorUserId?: string;
  nextReviewDate?: string;
}

export interface UpdateSupportNeedInput {
  category?: SupportNeedCategory;
  description?: string;
  status?: SupportNeedStatus;
  supportProvided?: string;
  examAccommodations?: string;
  coordinatorUserId?: string;
  nextReviewDate?: string;
}

export interface AddSupportNeedReviewInput {
  reviewDate: string;
  notes: string;
  updatedStatus?: SupportNeedStatus;
}

export const supportNeedsApi = {
  list: (
    params: {
      page?: number;
      limit?: number;
      studentId?: string;
      category?: SupportNeedCategory;
      status?: SupportNeedStatus;
    } = {},
  ) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== "") as [string, string][],
    ).toString();
    return api.get<Paginated<SupportNeed>>(`/api/support-needs${qs ? `?${qs}` : ""}`);
  },
  get: (id: string) => api.get<{ data: SupportNeed }>(`/api/support-needs/${id}`).then((r) => r.data),
  create: (input: CreateSupportNeedInput) =>
    api.post<{ data: SupportNeed }>("/api/support-needs", input).then((r) => r.data),
  update: (id: string, input: UpdateSupportNeedInput) =>
    api.patch<{ data: SupportNeed }>(`/api/support-needs/${id}`, input).then((r) => r.data),
  addReview: (id: string, input: AddSupportNeedReviewInput) =>
    api.post<{ data: SupportNeed }>(`/api/support-needs/${id}/reviews`, input).then((r) => r.data),
  remove: (id: string) => api.delete<void>(`/api/support-needs/${id}`),
};
