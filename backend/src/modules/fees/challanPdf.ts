import { renderHtmlToPdf } from '../../lib/pdfBrowser';

export interface ChallanData {
  school: { name: string; address: string | null; city: string | null; contactPhone: string | null };
  invoice: {
    invoiceNumber: string;
    period: string;
    issueDate: string;
    dueDate: string;
    totalAmount: number;
    lateFineAmount: number;
    paidAmount: number;
  };
  student: { studentCode: string; fullName: string; className: string | null };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

const COPY_LABELS = ['Bank Copy', 'School Copy', 'Student Copy'] as const;

/**
 * One `copy` block per Pakistani-bank-challan convention: Bank Copy
 * (retained at the counter), School Copy (deposited with the school
 * office), Student Copy (kept by the parent as proof of payment). All
 * three carry identical figures — only the label differs — same as a
 * real over-the-counter fee voucher.
 */
function copyBlock(data: ChallanData, label: string): string {
  const amountDue = data.invoice.totalAmount + data.invoice.lateFineAmount - data.invoice.paidAmount;
  return `
  <div class="copy">
    <div class="copy-label">${escapeHtml(label)}</div>
    <div class="header">
      <div class="school-name">${escapeHtml(data.school.name)}</div>
      <div class="school-addr">${escapeHtml([data.school.address, data.school.city].filter(Boolean).join(', '))}</div>
      <div class="voucher-title">Fee Voucher</div>
    </div>

    <table class="fields">
      <tr><td class="label">Invoice #</td><td>${escapeHtml(data.invoice.invoiceNumber)}</td>
          <td class="label">Period</td><td>${escapeHtml(data.invoice.period)}</td></tr>
      <tr><td class="label">Issue Date</td><td>${fmtDate(data.invoice.issueDate)}</td>
          <td class="label">Due Date</td><td>${fmtDate(data.invoice.dueDate)}</td></tr>
      <tr><td class="label">Student</td><td>${escapeHtml(data.student.fullName)}</td>
          <td class="label">Student Code</td><td>${escapeHtml(data.student.studentCode)}</td></tr>
      <tr><td class="label">Class</td><td colspan="3">${escapeHtml(data.student.className ?? '—')}</td></tr>
    </table>

    <table class="amounts">
      <tr><td>Fee Amount</td><td class="num">Rs. ${data.invoice.totalAmount.toFixed(2)}</td></tr>
      ${
        data.invoice.lateFineAmount > 0
          ? `<tr><td>Late Fine</td><td class="num">Rs. ${data.invoice.lateFineAmount.toFixed(2)}</td></tr>`
          : ''
      }
      ${
        data.invoice.paidAmount > 0
          ? `<tr><td>Already Paid</td><td class="num">Rs. ${data.invoice.paidAmount.toFixed(2)}</td></tr>`
          : ''
      }
      <tr class="total"><td>Amount Payable</td><td class="num">Rs. ${amountDue.toFixed(2)}</td></tr>
    </table>

    <div class="footer">
      <div class="sig">Depositor's Signature: ______________________</div>
      <div class="sig">Bank Stamp: ______________________</div>
    </div>
  </div>`;
}

function challanHtml(data: ChallanData): string {
  const copies = COPY_LABELS.map((label) => copyBlock(data, label)).join('<div class="cut-line"></div>');

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a1a; padding: 20px; }
  .copy { border: 1px solid #999; padding: 16px 20px; margin-bottom: 4px; }
  .copy-label { text-align: right; font-size: 11px; font-weight: 700; color: #555; letter-spacing: 0.5px; text-transform: uppercase; }
  .header { text-align: center; margin-bottom: 10px; }
  .school-name { font-size: 17px; font-weight: 700; }
  .school-addr { font-size: 11px; color: #555; margin-top: 2px; }
  .voucher-title { font-size: 13px; font-weight: 600; margin-top: 8px; text-decoration: underline; }
  table.fields { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 10px; }
  table.fields td { padding: 4px 6px; }
  table.fields td.label { color: #555; width: 90px; }
  table.amounts { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 10px; }
  table.amounts td { padding: 5px 6px; border-top: 1px solid #eee; }
  table.amounts td.num { text-align: right; }
  table.amounts tr.total td { font-weight: 700; border-top: 2px solid #333; font-size: 14px; }
  .footer { display: flex; justify-content: space-between; font-size: 11px; margin-top: 16px; }
  .cut-line { border-top: 1px dashed #999; margin: 6px 0; }
</style>
</head>
<body>
  ${copies}
</body>
</html>`;
}

export async function renderChallanPdf(data: ChallanData): Promise<Buffer> {
  return renderHtmlToPdf(challanHtml(data), { margin: { top: '10px', bottom: '10px' } });
}
