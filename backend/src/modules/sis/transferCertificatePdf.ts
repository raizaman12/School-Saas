import { renderHtmlToPdf } from '../../lib/pdfBrowser';

export interface TransferCertificateData {
  school: { name: string; address: string | null; city: string | null; logoUrl: string | null };
  tc: {
    tcNumber: string;
    issueDate: string;
    lastAttendanceDate: string | null;
    reason: string;
    conduct: string | null;
    remarks: string | null;
  };
  student: {
    studentCode: string;
    fullName: string;
    fatherOrGuardianName: string | null;
    dateOfBirth: string;
    className: string | null;
    admissionDate: string;
  };
}

const REASON_LABELS: Record<string, string> = {
  PARENT_REQUEST: "Parent's Request",
  RELOCATION: 'Relocation',
  ACADEMIC: 'Academic',
  DISCIPLINARY: 'Disciplinary',
  GRADUATED: 'Graduated',
  OTHER: 'Other',
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function tcHtml(data: TransferCertificateData): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a1a; padding: 48px; }
  .header { text-align: center; margin-bottom: 8px; }
  .header img { height: 48px; width: 48px; object-fit: contain; margin-bottom: 6px; }
  .school-name { font-size: 20px; font-weight: 700; }
  .school-addr { font-size: 12px; color: #555; margin-top: 2px; }
  .title { text-align: center; font-size: 16px; font-weight: 700; text-decoration: underline; margin: 24px 0; }
  .tc-number { text-align: right; font-size: 12px; color: #555; margin-bottom: 16px; }
  table.fields { width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 24px; }
  table.fields td { padding: 8px 6px; border-bottom: 1px solid #eee; }
  table.fields td.label { color: #555; width: 220px; }
  .remarks { margin-top: 24px; font-size: 13px; }
  .footer { display: flex; justify-content: space-between; margin-top: 64px; font-size: 13px; }
</style>
</head>
<body>
  <div class="header">
    ${data.school.logoUrl ? `<img src="${escapeHtml(data.school.logoUrl)}" alt="" />` : ''}
    <div class="school-name">${escapeHtml(data.school.name)}</div>
    <div class="school-addr">${escapeHtml([data.school.address, data.school.city].filter(Boolean).join(', '))}</div>
  </div>

  <div class="title">School Leaving / Transfer Certificate</div>
  <div class="tc-number">TC No: ${escapeHtml(data.tc.tcNumber)} &nbsp; | &nbsp; Issue Date: ${fmtDate(data.tc.issueDate)}</div>

  <table class="fields">
    <tr><td class="label">Student Name</td><td>${escapeHtml(data.student.fullName)}</td></tr>
    <tr><td class="label">Student Code</td><td>${escapeHtml(data.student.studentCode)}</td></tr>
    <tr><td class="label">Father's/Guardian's Name</td><td>${escapeHtml(data.student.fatherOrGuardianName ?? '—')}</td></tr>
    <tr><td class="label">Date of Birth</td><td>${fmtDate(data.student.dateOfBirth)}</td></tr>
    <tr><td class="label">Class Last Attended</td><td>${escapeHtml(data.student.className ?? '—')}</td></tr>
    <tr><td class="label">Date of Admission</td><td>${fmtDate(data.student.admissionDate)}</td></tr>
    <tr><td class="label">Date of Last Attendance</td><td>${fmtDate(data.tc.lastAttendanceDate)}</td></tr>
    <tr><td class="label">Reason for Leaving</td><td>${escapeHtml(REASON_LABELS[data.tc.reason] ?? data.tc.reason)}</td></tr>
    <tr><td class="label">Conduct</td><td>${escapeHtml(data.tc.conduct ?? '—')}</td></tr>
  </table>

  ${data.tc.remarks ? `<div class="remarks"><strong>Remarks:</strong> ${escapeHtml(data.tc.remarks)}</div>` : ''}

  <div class="footer">
    <div>Parent/Guardian Signature: ______________________</div>
    <div>Principal/Head Signature: ______________________</div>
  </div>
</body>
</html>`;
}

export async function renderTransferCertificatePdf(data: TransferCertificateData): Promise<Buffer> {
  return renderHtmlToPdf(tcHtml(data));
}
