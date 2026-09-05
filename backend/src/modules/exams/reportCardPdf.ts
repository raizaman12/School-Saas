import { renderHtmlToPdf } from '../../lib/pdfBrowser';

export interface ReportCardData {
  school?: { name: string; logoUrl: string | null } | null;
  exam: { name: string; academicYear: string };
  student: { studentCode: string; fullName: string; section: string | null };
  subjects: Array<{
    subject: string;
    maxMarks: number;
    passingMarks: number;
    marksObtained: number | null;
    percentage: number | null;
    grade: string | null;
    passed: boolean | null;
  }>;
  summary: {
    totalObtained: number;
    totalMax: number;
    percentage: number | null;
    grade: string | null;
    subjectsGraded: number;
    subjectsTotal: number;
  };
  // Optional — omitted where attendance isn't relevant to the caller (e.g.
  // a caller with no date range to summarize over).
  attendance?: { present: number; absent: number; leave: number; totalMarked: number } | null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function reportCardHtml(data: ReportCardData): string {
  const rows = data.subjects
    .map(
      (s) => `
      <tr>
        <td>${escapeHtml(s.subject)}</td>
        <td class="num">${s.maxMarks}</td>
        <td class="num">${s.marksObtained ?? '—'}</td>
        <td class="num">${s.percentage !== null ? s.percentage + '%' : '—'}</td>
        <td class="center">${s.grade ?? '—'}</td>
        <td class="center ${s.passed === false ? 'fail' : ''}">${
          s.passed === null ? '—' : s.passed ? 'Pass' : 'Fail'
        }</td>
      </tr>`,
    )
    .join('');

  const attendancePct =
    data.attendance && data.attendance.totalMarked > 0
      ? Math.round((data.attendance.present / data.attendance.totalMarked) * 1000) / 10
      : null;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a1a; padding: 40px; }
  .school-header { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
  .school-header img { height: 44px; width: 44px; object-fit: contain; }
  .school-header .school-name { font-size: 15px; font-weight: 700; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .subtitle { color: #555; margin: 0 0 24px; font-size: 13px; }
  .meta { display: flex; justify-content: space-between; margin-bottom: 24px; font-size: 13px; }
  .meta div { line-height: 1.6; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { border: 1px solid #ddd; padding: 8px 10px; text-align: left; }
  th { background: #f4f4f5; font-weight: 600; }
  .num { text-align: right; }
  .center { text-align: center; }
  .fail { color: #b91c1c; font-weight: 600; }
  .summary { margin-top: 24px; padding: 16px; background: #f8fafc; border-radius: 8px; font-size: 14px; }
  .summary strong { font-size: 16px; }
  .attendance { margin-top: 12px; padding: 12px 16px; background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; font-size: 13px; }
</style>
</head>
<body>
  ${
    data.school
      ? `<div class="school-header">${
          data.school.logoUrl ? `<img src="${escapeHtml(data.school.logoUrl)}" alt="" />` : ''
        }<div class="school-name">${escapeHtml(data.school.name)}</div></div>`
      : ''
  }
  <h1>Report Card</h1>
  <div class="subtitle">${escapeHtml(data.exam.name)} — ${escapeHtml(data.exam.academicYear)}</div>

  <div class="meta">
    <div>
      <div><strong>Name:</strong> ${escapeHtml(data.student.fullName)}</div>
      <div><strong>Student Code:</strong> ${escapeHtml(data.student.studentCode)}</div>
    </div>
    <div>
      <div><strong>Class/Section:</strong> ${escapeHtml(data.student.section ?? '—')}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr><th>Subject</th><th class="num">Max</th><th class="num">Obtained</th><th class="num">%</th><th class="center">Grade</th><th class="center">Result</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="summary">
    <div><strong>Overall: ${data.summary.totalObtained} / ${data.summary.totalMax}${
      data.summary.percentage !== null ? ` (${data.summary.percentage}%)` : ''
    }</strong></div>
    <div>Grade: ${data.summary.grade ?? '—'}</div>
    <div>Subjects graded: ${data.summary.subjectsGraded} / ${data.summary.subjectsTotal}</div>
  </div>

  ${
    data.attendance
      ? `<div class="attendance">
          <strong>Attendance:</strong> ${data.attendance.present} present / ${data.attendance.absent} absent / ${data.attendance.leave} leave
          out of ${data.attendance.totalMarked} school days recorded${attendancePct !== null ? ` (${attendancePct}%)` : ''}
        </div>`
      : ''
  }
</body>
</html>`;
}

export async function renderReportCardPdf(data: ReportCardData): Promise<Buffer> {
  return renderHtmlToPdf(reportCardHtml(data));
}

export { closePdfBrowser } from '../../lib/pdfBrowser';
