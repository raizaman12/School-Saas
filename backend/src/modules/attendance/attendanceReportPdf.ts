import { renderHtmlToPdf } from '../../lib/pdfBrowser';

export interface AttendanceReportData {
  school: { name: string; address: string | null; city: string | null; logoUrl: string | null };
  student: { studentCode: string; fullName: string; className: string | null };
  range: { from: string | null; to: string | null };
  records: Array<{ date: string; status: string; remarks: string | null }>;
  summary: { totalMarked: number; counts: Record<string, number> };
}

const STATUS_LABELS: Record<string, string> = {
  PRESENT: 'Present',
  ABSENT: 'Absent',
  LATE: 'Late',
  LEAVE: 'Leave',
  HALF_DAY: 'Half Day',
  EARLY_LEAVE: 'Early Leave',
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

function fmtWeekday(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
}

function attendanceReportHtml(data: AttendanceReportData): string {
  const rows = data.records.length
    ? data.records
        .map(
          (r) => `
    <tr>
      <td>${fmtDate(r.date)}</td>
      <td>${escapeHtml(fmtWeekday(r.date))}</td>
      <td><span class="status status-${escapeHtml(r.status)}">${escapeHtml(STATUS_LABELS[r.status] ?? r.status)}</span></td>
      <td>${escapeHtml(r.remarks ?? '—')}</td>
    </tr>`,
        )
        .join('')
    : `<tr><td colspan="4" class="empty">No attendance records in this date range</td></tr>`;

  const summaryCells = Object.entries(data.summary.counts)
    .map(
      ([status, count]) => `
    <div class="summary-item">
      <div class="summary-count">${count}</div>
      <div class="summary-label">${escapeHtml(STATUS_LABELS[status] ?? status)}</div>
    </div>`,
    )
    .join('');

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
  .title { text-align: center; font-size: 16px; font-weight: 700; text-decoration: underline; margin: 20px 0 8px; }
  .student-line { text-align: center; font-size: 13px; color: #333; margin-bottom: 4px; }
  .range-line { text-align: center; font-size: 12px; color: #666; margin-bottom: 20px; }
  .summary { display: flex; justify-content: center; gap: 24px; margin-bottom: 24px; padding: 14px; background: #f8fafc; border-radius: 8px; }
  .summary-item { text-align: center; }
  .summary-count { font-size: 20px; font-weight: 700; }
  .summary-label { font-size: 10px; color: #666; text-transform: uppercase; letter-spacing: 0.3px; margin-top: 2px; }
  table.list { width: 100%; border-collapse: collapse; font-size: 12px; }
  table.list th { text-align: left; background: #f5f5f5; padding: 6px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.3px; color: #555; }
  table.list td { padding: 6px; border-bottom: 1px solid #eee; }
  table.list td.empty { text-align: center; color: #888; font-style: italic; }
  .status { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 4px; }
  .status-PRESENT { background: #dcfce7; color: #166534; }
  .status-ABSENT { background: #fee2e2; color: #991b1b; }
  .status-LATE { background: #fef9c3; color: #854d0e; }
  .status-LEAVE { background: #e0e7ff; color: #3730a3; }
  .status-HALF_DAY { background: #fed7aa; color: #9a3412; }
  .status-EARLY_LEAVE { background: #fae8ff; color: #86198f; }
  .footer { display: flex; justify-content: space-between; margin-top: 48px; font-size: 13px; }
</style>
</head>
<body>
  <div class="header">
    ${data.school.logoUrl ? `<img src="${escapeHtml(data.school.logoUrl)}" alt="" />` : ''}
    <div class="school-name">${escapeHtml(data.school.name)}</div>
    <div class="school-addr">${escapeHtml([data.school.address, data.school.city].filter(Boolean).join(', '))}</div>
  </div>

  <div class="title">Student Attendance Report</div>
  <div class="student-line">${escapeHtml(data.student.fullName)} (${escapeHtml(data.student.studentCode)}) &nbsp;·&nbsp; ${escapeHtml(data.student.className ?? '—')}</div>
  <div class="range-line">${fmtDate(data.range.from)} to ${fmtDate(data.range.to)} &nbsp;|&nbsp; ${data.summary.totalMarked} day(s) marked</div>

  <div class="summary">${summaryCells}</div>

  <table class="list">
    <tr><th>Date</th><th>Day</th><th>Status</th><th>Remarks</th></tr>
    ${rows}
  </table>

  <div class="footer">
    <div>Class Teacher Signature: ______________________</div>
    <div>Principal/Head Signature: ______________________</div>
  </div>
</body>
</html>`;
}

export async function renderAttendanceReportPdf(data: AttendanceReportData): Promise<Buffer> {
  return renderHtmlToPdf(attendanceReportHtml(data));
}
