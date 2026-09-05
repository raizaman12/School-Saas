import { api } from "@/lib/api";

export type TransferCertificateReason =
  | "PARENT_REQUEST"
  | "RELOCATION"
  | "ACADEMIC"
  | "DISCIPLINARY"
  | "GRADUATED"
  | "OTHER";

export interface TransferCertificate {
  id: string;
  studentId: string;
  tcNumber: string;
  issueDate: string;
  lastAttendanceDate: string | null;
  reason: TransferCertificateReason;
  conduct: string | null;
  remarks: string | null;
  createdAt: string;
  // Set once this TC was undone (see transferCertificatesApi.void) — kept
  // in the list for the audit trail rather than removed.
  voidedAt: string | null;
}

export interface CreateTransferCertificateInput {
  issueDate?: string;
  lastAttendanceDate?: string;
  reason: TransferCertificateReason;
  conduct?: string;
  remarks?: string;
}

export const transferCertificatesApi = {
  listForStudent: (studentId: string) =>
    api.get<{ data: TransferCertificate[] }>(`/api/students/${studentId}/transfer-certificates`).then((r) => r.data),
  issue: (studentId: string, input: CreateTransferCertificateInput) =>
    api
      .post<{ data: TransferCertificate }>(`/api/students/${studentId}/transfer-certificate`, input)
      .then((r) => r.data),
  /**
   * Undoes a mistakenly-issued TC — only the most recently issued,
   * not-yet-voided one for a student can be voided. Reverts the
   * student's status back to ACTIVE.
   */
  void: (tcId: string) =>
    api
      .post<{ data: TransferCertificate; student: { id: string; status: string } }>(
        `/api/transfer-certificates/${tcId}/void`,
      )
      .then((r) => r),
};
