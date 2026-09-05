import { api } from "@/lib/api";

// Mirrors backend schema.prisma's CustomFieldType enum — see that file's
// doc comment for why this is a minimal per-tenant field list + generic
// value store rather than PowerSchool's page-builder-grade Custom Screens.
export type CustomFieldType = "TEXT" | "NUMBER" | "DATE" | "BOOLEAN" | "SELECT";

export const CUSTOM_FIELD_TYPE_LABEL: Record<CustomFieldType, string> = {
  TEXT: "Text",
  NUMBER: "Number",
  DATE: "Date",
  BOOLEAN: "Yes/No",
  SELECT: "Dropdown",
};

export interface CustomFieldDefinition {
  id: string;
  label: string;
  fieldType: CustomFieldType;
  options: string[] | null;
  required: boolean;
  active: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCustomFieldDefinitionInput {
  label: string;
  fieldType: CustomFieldType;
  options?: string[];
  required?: boolean;
  sortOrder?: number;
}

export interface UpdateCustomFieldDefinitionInput {
  label?: string;
  options?: string[];
  required?: boolean;
  active?: boolean;
  sortOrder?: number;
}

/** The merged "definition + this student's current answer" row returned by both the GET and PUT of student values. */
export interface StudentCustomFieldValueRow {
  fieldDefinitionId: string;
  label: string;
  fieldType: CustomFieldType;
  options: string[] | null;
  required: boolean;
  active: boolean;
  value: string | null;
  updatedAt: string | null;
}

export const customFieldsApi = {
  listDefinitions: (opts: { includeInactive?: boolean } = {}) =>
    api
      .get<{ data: CustomFieldDefinition[] }>(
        `/api/custom-fields${opts.includeInactive ? "?includeInactive=true" : ""}`,
      )
      .then((r) => r.data),
  createDefinition: (input: CreateCustomFieldDefinitionInput) =>
    api.post<{ data: CustomFieldDefinition }>("/api/custom-fields", input).then((r) => r.data),
  updateDefinition: (id: string, input: UpdateCustomFieldDefinitionInput) =>
    api.patch<{ data: CustomFieldDefinition }>(`/api/custom-fields/${id}`, input).then((r) => r.data),
  removeDefinition: (id: string) => api.delete<void>(`/api/custom-fields/${id}`),

  getStudentValues: (studentId: string) =>
    api.get<{ data: StudentCustomFieldValueRow[] }>(`/api/custom-fields/students/${studentId}/values`).then((r) => r.data),
  saveStudentValues: (studentId: string, values: { fieldDefinitionId: string; value: string }[]) =>
    api
      .put<{ data: StudentCustomFieldValueRow[] }>(`/api/custom-fields/students/${studentId}/values`, { values })
      .then((r) => r.data),
};
