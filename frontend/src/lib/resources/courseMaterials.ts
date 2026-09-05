import { api } from "@/lib/api";

/** A file a teacher shared against one of their courses (section-subject) — admin/teacher-facing view. */
export interface CourseMaterial {
  id: string;
  title: string;
  fileUrl: string;
  createdAt: string;
  sectionSubject: {
    id: string;
    subject: { id: string; name: string };
    section: { id: string; name: string; schoolClass: { name: string } };
  };
  uploadedByUser: { id: string; fullName: string };
}

export const courseMaterialsApi = {
  list: (sectionSubjectId: string) =>
    api
      .get<{ data: CourseMaterial[] }>(`/api/course-materials?sectionSubjectId=${sectionSubjectId}`)
      .then((r) => r.data),
  create: (input: { sectionSubjectId: string; title: string; fileUrl: string }) =>
    api.post<{ data: CourseMaterial }>("/api/course-materials", input).then((r) => r.data),
  remove: (id: string) => api.delete<void>(`/api/course-materials/${id}`),
};
