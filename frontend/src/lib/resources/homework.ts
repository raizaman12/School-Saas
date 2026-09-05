import { api } from "@/lib/api";
import type { Paginated } from "./types";

/** An assignment/homework item a teacher assigned to a section+subject — the "Assessment" tab's data. */
export interface Homework {
  id: string;
  title: string;
  description: string | null;
  dueDate: string;
  attachmentUrl: string | null;
  subject: { id: string; name: string };
  section: { id: string; name: string; schoolClass: { name: string } };
  assignedByUser: { id: string; fullName: string };
}

export interface CreateHomeworkInput {
  sectionId: string;
  subjectId: string;
  title: string;
  description?: string;
  dueDate: string;
  attachmentUrl?: string;
}

export const homeworkApi = {
  /** Note: filters by section only — the backend has no subjectId filter, so callers scoping to one course should filter the result client-side. */
  list: (params: { sectionId?: string; page?: number; limit?: number } = {}) => {
    const search = new URLSearchParams();
    if (params.sectionId) search.set("sectionId", params.sectionId);
    if (params.page !== undefined) search.set("page", String(params.page));
    if (params.limit !== undefined) search.set("limit", String(params.limit));
    const qs = search.toString();
    return api.get<Paginated<Homework>>(`/api/homework${qs ? `?${qs}` : ""}`);
  },
  create: (input: CreateHomeworkInput) => api.post<{ data: Homework }>("/api/homework", input).then((r) => r.data),
  update: (
    id: string,
    input: Partial<{ title: string; description: string; dueDate: string; attachmentUrl: string }>,
  ) => api.patch<{ data: Homework }>(`/api/homework/${id}`, input).then((r) => r.data),
  remove: (id: string) => api.delete<void>(`/api/homework/${id}`),
};
