import { renderHtmlToPdf } from '../../lib/pdfBrowser';

/**
 * Deliberately excludes `correctOptionIndex` from the type entirely (not
 * just from what's rendered) — the route that builds this object strips
 * it before calling in, so there is no code path in this file that could
 * ever read or print a correct MCQ answer, even by future accident.
 */
export interface ExamPaperPdfQuestion {
  type: 'MCQ' | 'SHORT_ANSWER' | 'LONG_ANSWER';
  questionText: string;
  marks: number;
  options: string[] | null;
  order: number;
}

export interface ExamPaperPdfData {
  school?: { name: string; logoUrl: string | null } | null;
  schoolClass: string;
  subject: string;
  chapters: string[];
  totalMarks: number;
  generatedAt: string;
  questions: ExamPaperPdfQuestion[];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

function examPaperHtml(data: ExamPaperPdfData): string {
  const mcqs = data.questions.filter((q) => q.type === 'MCQ');
  const shorts = data.questions.filter((q) => q.type === 'SHORT_ANSWER');
  const longs = data.questions.filter((q) => q.type === 'LONG_ANSWER');

  const renderMcqSection = () => {
    if (mcqs.length === 0) return '';
    const items = mcqs
      .map(
        (q, i) => `
        <li class="q">
          <div class="q-text">${i + 1}. ${escapeHtml(q.questionText)}</div>
          <div class="options">
            ${(q.options ?? [])
              .map((opt, oi) => `<div class="option">${OPTION_LETTERS[oi] ?? oi + 1}. ${escapeHtml(opt)}</div>`)
              .join('')}
          </div>
        </li>`,
      )
      .join('');
    return `<section><h2>Section A — Multiple Choice Questions</h2><ol class="q-list">${items}</ol></section>`;
  };

  const renderTextSection = (title: string, questions: ExamPaperPdfQuestion[]) => {
    if (questions.length === 0) return '';
    const items = questions
      .map(
        (q, i) => `
        <li class="q">
          <div class="q-text">${i + 1}. ${escapeHtml(q.questionText)} <span class="marks">[${q.marks} marks]</span></div>
        </li>`,
      )
      .join('');
    return `<section><h2>${title}</h2><ol class="q-list">${items}</ol></section>`;
  };

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
  .subtitle { color: #555; margin: 0 0 4px; font-size: 13px; }
  .meta { display: flex; justify-content: space-between; margin: 16px 0 24px; font-size: 13px; border-top: 1px solid #ddd; border-bottom: 1px solid #ddd; padding: 10px 0; }
  h2 { font-size: 15px; margin: 24px 0 10px; border-bottom: 2px solid #1a1a1a; padding-bottom: 4px; }
  .q-list { list-style: none; padding: 0; margin: 0; }
  .q { margin-bottom: 14px; font-size: 13px; line-height: 1.5; }
  .q-text { font-weight: 500; }
  .options { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 16px; margin: 6px 0 0 18px; }
  .option { font-size: 13px; }
  .marks { color: #666; font-weight: 400; font-size: 12px; }
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
  <h1>Examination Paper</h1>
  <div class="subtitle">${escapeHtml(data.schoolClass)} — ${escapeHtml(data.subject)}</div>
  ${data.chapters.length > 0 ? `<div class="subtitle">Chapters: ${escapeHtml(data.chapters.join(', '))}</div>` : ''}

  <div class="meta">
    <div><strong>Total Marks:</strong> ${data.totalMarks}</div>
    <div><strong>Date:</strong> ${escapeHtml(data.generatedAt)}</div>
  </div>

  ${renderMcqSection()}
  ${renderTextSection('Section B — Short Answer Questions', shorts)}
  ${renderTextSection('Section C — Long Answer Questions', longs)}
</body>
</html>`;
}

export async function renderExamPaperPdf(data: ExamPaperPdfData): Promise<Buffer> {
  return renderHtmlToPdf(examPaperHtml(data));
}
