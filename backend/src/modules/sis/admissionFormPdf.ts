import { renderHtmlToPdf } from '../../lib/pdfBrowser';

export interface AdmissionFormData {
  school: { name: string; address: string | null; city: string | null; contactPhone: string | null; logoUrl: string | null };
  student: {
    studentCode: string;
    fullName: string;
    gender: string;
    dateOfBirth: string;
    admissionDate: string;
    bFormOrCnic: string | null;
    contactPhone: string | null;
    address: string | null;
    city: string | null;
    className: string | null;
    rollNumber: string | null;
    photoUrl: string | null;
  };
  guardians: Array<{
    fullName: string;
    relationship: string;
    cnic: string | null;
    phone: string;
    email: string | null;
    occupation: string | null;
    isPrimary: boolean;
  }>;
  fees: {
    // The class/year fee structure the student is liable for — meaningful
    // even on day one, before any invoice has ever been generated.
    structureItems: Array<{ categoryName: string; amount: number; frequency: string }>;
    // Actual billing-to-date, if any invoices exist yet.
    ledger: { totalBilled: number; totalPaid: number; balance: number };
  };
}

const RELATIONSHIP_LABELS: Record<string, string> = {
  FATHER: "Father",
  MOTHER: "Mother",
  GUARDIAN: "Guardian",
};

const FREQUENCY_LABELS: Record<string, string> = {
  ONE_TIME: 'One-time',
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  ANNUAL: 'Annually',
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function fmtMoney(n: number): string {
  return `Rs. ${n.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function admissionFormHtml(data: AdmissionFormData): string {
  const guardianRows = data.guardians.length
    ? data.guardians
        .map(
          (g) => `
    <tr>
      <td>${escapeHtml(g.fullName)}${g.isPrimary ? ' <span class="tag">Primary</span>' : ''}</td>
      <td>${escapeHtml(RELATIONSHIP_LABELS[g.relationship] ?? g.relationship)}</td>
      <td>${escapeHtml(g.phone)}</td>
      <td>${escapeHtml(g.cnic ?? '—')}</td>
      <td>${escapeHtml(g.email ?? '—')}</td>
      <td>${escapeHtml(g.occupation ?? '—')}</td>
    </tr>`,
        )
        .join('')
    : `<tr><td colspan="6" class="empty">No parent/guardian on record</td></tr>`;

  const feeRows = data.fees.structureItems.length
    ? data.fees.structureItems
        .map(
          (item) => `
    <tr>
      <td>${escapeHtml(item.categoryName)}</td>
      <td>${escapeHtml(FREQUENCY_LABELS[item.frequency] ?? item.frequency)}</td>
      <td class="num">${fmtMoney(item.amount)}</td>
    </tr>`,
        )
        .join('')
    : `<tr><td colspan="3" class="empty">No fee structure set for this class/year yet</td></tr>`;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a1a; padding: 40px; }
  .header { text-align: center; margin-bottom: 8px; }
  .header img { height: 48px; width: 48px; object-fit: contain; margin-bottom: 6px; }
  .school-name { font-size: 20px; font-weight: 700; }
  .school-addr { font-size: 12px; color: #555; margin-top: 2px; }
  .title { text-align: center; font-size: 16px; font-weight: 700; text-decoration: underline; margin: 20px 0; }
  .student-photo { float: right; width: 90px; height: 110px; object-fit: cover; border: 1px solid #ccc; margin: -8px 0 8px 12px; }
  .section-title { font-size: 13px; font-weight: 700; margin: 20px 0 8px; color: #111; }
  table.fields { width: 100%; border-collapse: collapse; font-size: 13px; }
  table.fields td { padding: 6px; border-bottom: 1px solid #eee; }
  table.fields td.label { color: #555; width: 160px; }
  table.list { width: 100%; border-collapse: collapse; font-size: 12px; }
  table.list th { text-align: left; background: #f5f5f5; padding: 6px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.3px; color: #555; }
  table.list td { padding: 6px; border-bottom: 1px solid #eee; }
  table.list td.num { text-align: right; }
  table.list td.empty { text-align: center; color: #888; font-style: italic; }
  .tag { display: inline-block; font-size: 9px; font-weight: 700; color: #1e40af; background: #dbeafe; border-radius: 4px; padding: 1px 5px; margin-left: 4px; }
  table.summary { width: 260px; margin-left: auto; margin-top: 8px; border-collapse: collapse; font-size: 12px; }
  table.summary td { padding: 4px 6px; }
  table.summary td.num { text-align: right; }
  table.summary tr.total td { font-weight: 700; border-top: 2px solid #333; }
  .footer { display: flex; justify-content: space-between; margin-top: 56px; font-size: 13px; }
</style>
</head>
<body>
  <div class="header">
    ${data.school.logoUrl ? `<img src="${escapeHtml(data.school.logoUrl)}" alt="" />` : ''}
    <div class="school-name">${escapeHtml(data.school.name)}</div>
    <div class="school-addr">${escapeHtml([data.school.address, data.school.city].filter(Boolean).join(', '))}</div>
  </div>

  <div class="title">Student Admission Form</div>

  <div class="section-title">Student Details</div>
  ${data.student.photoUrl ? `<img class="student-photo" src="${escapeHtml(data.student.photoUrl)}" alt="" />` : ''}
  <table class="fields">
    <tr><td class="label">Student Name</td><td>${escapeHtml(data.student.fullName)}</td>
        <td class="label">Student Code</td><td>${escapeHtml(data.student.studentCode)}</td></tr>
    <tr><td class="label">Gender</td><td>${escapeHtml(data.student.gender)}</td>
        <td class="label">Date of Birth</td><td>${fmtDate(data.student.dateOfBirth)}</td></tr>
    <tr><td class="label">Class</td><td>${escapeHtml(data.student.className ?? '—')}</td>
        <td class="label">Roll No.</td><td>${escapeHtml(data.student.rollNumber ?? '—')}</td></tr>
    <tr><td class="label">Date of Admission</td><td>${fmtDate(data.student.admissionDate)}</td>
        <td class="label">B-Form / CNIC</td><td>${escapeHtml(data.student.bFormOrCnic ?? '—')}</td></tr>
    <tr><td class="label">Contact Phone</td><td>${escapeHtml(data.student.contactPhone ?? '—')}</td>
        <td class="label">Address</td><td>${escapeHtml([data.student.address, data.student.city].filter(Boolean).join(', ') || '—')}</td></tr>
  </table>

  <div class="section-title">Parent / Guardian Details</div>
  <table class="list">
    <tr><th>Name</th><th>Relationship</th><th>Phone</th><th>CNIC</th><th>Email</th><th>Occupation</th></tr>
    ${guardianRows}
  </table>

  <div class="section-title">Fee Details</div>
  <table class="list">
    <tr><th>Fee Category</th><th>Frequency</th><th>Amount</th></tr>
    ${feeRows}
  </table>
  <table class="summary">
    <tr><td>Total Billed To Date</td><td class="num">${fmtMoney(data.fees.ledger.totalBilled)}</td></tr>
    <tr><td>Total Paid To Date</td><td class="num">${fmtMoney(data.fees.ledger.totalPaid)}</td></tr>
    <tr class="total"><td>Outstanding Balance</td><td class="num">${fmtMoney(data.fees.ledger.balance)}</td></tr>
  </table>

  <div class="footer">
    <div>Parent/Guardian Signature: ______________________</div>
    <div>Admission Officer Signature: ______________________</div>
  </div>
</body>
</html>`;
}

export async function renderAdmissionFormPdf(data: AdmissionFormData): Promise<Buffer> {
  return renderHtmlToPdf(admissionFormHtml(data));
}
