"use client";

import { useEffect, useState } from "react";
import { FileQuestion, ClipboardCheck, Library, Sparkles, Trash2, Download } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useAsync } from "@/lib/hooks/useAsync";
import { academicsApi, type SchoolClass, type Subject } from "@/lib/resources/academics";
import { staffApi } from "@/lib/resources/staff";
import {
  examGeneratorApi,
  type AccessGrant,
  type BankQuestion,
  type ChaptersSummary,
  type GeneratedPaper,
  type QuestionType,
} from "@/lib/resources/examGenerator";
import { ApiError, downloadFile } from "@/lib/api";
import {
  Button,
  ConfirmButton,
  Input,
  Textarea,
  Select,
  Badge,
  Alert,
  Spinner,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
  EmptyState,
} from "@/components/ui";

type TabKey = "access" | "bank" | "generate";

const TABS: { key: TabKey; label: string; icon: typeof FileQuestion }[] = [
  { key: "access", label: "Access", icon: ClipboardCheck },
  { key: "bank", label: "Question Bank", icon: Library },
  { key: "generate", label: "Generate", icon: Sparkles },
];

const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  MCQ: "MCQ",
  SHORT_ANSWER: "Short Answer",
  LONG_ANSWER: "Long Answer",
};

export default function ExamGeneratorPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "SCHOOL_ADMIN";
  const visibleTabs = TABS.filter((t) => t.key !== "access" || isAdmin);
  const [tab, setTab] = useState<TabKey>(isAdmin ? "access" : "bank");

  const { data: schoolClasses } = useAsync(() => academicsApi.listClasses(), []);
  const { data: subjects } = useAsync(() => academicsApi.listSubjects(), []);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-page-title font-semibold text-slate-900">Exam Generator</h1>
        <p className="text-sm text-slate-500">
          Build a shared question bank and generate exam papers by randomly picking from it — no AI involved.
        </p>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        {visibleTabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === key
                ? "border-primary-600 text-primary-600"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            <Icon className="size-4" aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      {!schoolClasses || !subjects ? (
        <Spinner label="Loading" />
      ) : (
        <>
          {tab === "access" && isAdmin && <AccessTab schoolClasses={schoolClasses} subjects={subjects} />}
          {tab === "bank" && <QuestionBankTab schoolClasses={schoolClasses} subjects={subjects} />}
          {tab === "generate" && (
            <GenerateTab schoolClasses={schoolClasses} subjects={subjects} isAdmin={isAdmin} />
          )}
        </>
      )}
    </div>
  );
}

// ─────────────────────────────── Access tab ───────────────────────────────

const grantSchema = z.object({
  schoolClassId: z.string().uuid("Select a class"),
  subjectId: z.string().uuid("Select a subject"),
  teacherId: z.string().uuid("Select a teacher"),
});
type GrantFormValues = z.infer<typeof grantSchema>;

function AccessTab({ schoolClasses, subjects }: { schoolClasses: SchoolClass[]; subjects: Subject[] }) {
  const { data: grants, isLoading, error, refetch } = useAsync(() => examGeneratorApi.listAccessGrants(), []);
  const { data: staff } = useAsync(() => staffApi.list({ status: "ACTIVE", limit: 200 }).then((r) => r.data), []);
  const teachers = (staff ?? []).filter((s) => s.user.role === "TEACHER");

  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<GrantFormValues>({ resolver: zodResolver(grantSchema) });

  const onSubmit = async (values: GrantFormValues) => {
    setFormError(null);
    try {
      await examGeneratorApi.createAccessGrant(values);
      reset();
      refetch();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not grant access.");
    }
  };

  if (isLoading) return <Spinner label="Loading access grants" />;
  if (error) return <Alert tone="danger">Failed to load access grants: {error.message}</Alert>;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Grant a teacher access</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-slate-500">
            A teacher can only generate exam papers for a class/subject once granted here. Adding questions to the
            question bank is open to every teacher regardless of this grant.
          </p>
          <form
            onSubmit={handleSubmit(onSubmit)}
            className="grid grid-cols-1 gap-3 sm:grid-cols-4"
            data-testid="grant-form"
          >
            <Select label="Class" required error={errors.schoolClassId?.message} {...register("schoolClassId")}>
              <option value="">Select class</option>
              {schoolClasses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <Select label="Subject" required error={errors.subjectId?.message} {...register("subjectId")}>
              <option value="">Select subject</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
            <Select label="Teacher" required error={errors.teacherId?.message} {...register("teacherId")}>
              <option value="">Select teacher</option>
              {teachers.map((t) => (
                <option key={t.id} value={t.user.id}>
                  {t.user.fullName}
                </option>
              ))}
            </Select>
            <div className="flex items-end">
              <Button type="submit" isLoading={isSubmitting}>
                Grant access
              </Button>
            </div>
          </form>
          {formError && (
            <Alert tone="danger" className="mt-3">
              {formError}
            </Alert>
          )}
        </CardContent>
      </Card>

      {!grants || grants.length === 0 ? (
        <EmptyState message="No access grants yet." />
      ) : (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Teacher</TableHeaderCell>
              <TableHeaderCell>Class</TableHeaderCell>
              <TableHeaderCell>Subject</TableHeaderCell>
              <TableHeaderCell>Actions</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {grants.map((g: AccessGrant) => (
              <TableRow key={g.id}>
                <TableCell>{g.teacher?.fullName ?? "—"}</TableCell>
                <TableCell>{g.schoolClass.name}</TableCell>
                <TableCell>{g.subject.name}</TableCell>
                <TableCell>
                  <ConfirmButton
                    triggerLabel="Revoke"
                    confirmLabel="Revoke access"
                    title="Revoke this teacher's access?"
                    description="They will no longer be able to generate exam papers for this class/subject."
                    onConfirm={async () => {
                      await examGeneratorApi.removeAccessGrant(g.id);
                      refetch();
                    }}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

// ────────────────────────────── Question bank tab ─────────────────────────

function AddQuestionForm({
  schoolClassId,
  subjectId,
  onCreated,
}: {
  schoolClassId: string;
  subjectId: string;
  onCreated: () => void;
}) {
  const [type, setType] = useState<QuestionType>("MCQ");
  const [questionText, setQuestionText] = useState("");
  const [chapter, setChapter] = useState("");
  const [marks, setMarks] = useState(1);
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [correctOptionIndex, setCorrectOptionIndex] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const reset = () => {
    setType("MCQ");
    setQuestionText("");
    setChapter("");
    setMarks(1);
    setOptions(["", ""]);
    setCorrectOptionIndex(0);
  };

  const addOption = () => setOptions((o) => (o.length < 6 ? [...o, ""] : o));
  const removeOption = (i: number) =>
    setOptions((o) => {
      if (o.length <= 2) return o;
      const next = o.filter((_, idx) => idx !== i);
      setCorrectOptionIndex((c) => (c >= next.length ? 0 : c));
      return next;
    });

  const onSubmit = async () => {
    setError(null);
    if (!questionText.trim()) {
      setError("Question text is required.");
      return;
    }
    if (type === "MCQ" && options.some((o) => !o.trim())) {
      setError("Every option must have text.");
      return;
    }
    setIsSubmitting(true);
    try {
      await examGeneratorApi.createQuestion({
        schoolClassId,
        subjectId,
        type,
        questionText: questionText.trim(),
        chapter: chapter.trim() || undefined,
        marks: type === "MCQ" ? undefined : marks,
        options: type === "MCQ" ? options.map((o) => o.trim()) : undefined,
        correctOptionIndex: type === "MCQ" ? correctOptionIndex : undefined,
      });
      reset();
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add question.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a question</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Select label="Type" value={type} onChange={(e) => setType(e.target.value as QuestionType)}>
              <option value="MCQ">MCQ</option>
              <option value="SHORT_ANSWER">Short Answer</option>
              <option value="LONG_ANSWER">Long Answer</option>
            </Select>
            <Input
              label="Chapter (optional)"
              value={chapter}
              onChange={(e) => setChapter(e.target.value)}
              placeholder="e.g. Chapter 3: Photosynthesis"
            />
          </div>
          <Textarea
            label="Question text"
            required
            value={questionText}
            onChange={(e) => setQuestionText(e.target.value)}
            rows={2}
          />

          {type === "MCQ" ? (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-slate-700">Options (mark the correct one)</span>
              {options.map((opt, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="correctOption"
                    aria-label={`Option ${i + 1} is correct`}
                    checked={correctOptionIndex === i}
                    onChange={() => setCorrectOptionIndex(i)}
                  />
                  <Input
                    className="flex-1"
                    value={opt}
                    onChange={(e) =>
                      setOptions((o) => o.map((v, idx) => (idx === i ? e.target.value : v)))
                    }
                    placeholder={`Option ${i + 1}`}
                  />
                  {options.length > 2 && (
                    <Button type="button" variant="outline" size="sm" onClick={() => removeOption(i)}>
                      <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                  )}
                </div>
              ))}
              {options.length < 6 && (
                <Button type="button" variant="outline" size="sm" onClick={addOption} className="self-start">
                  + Add option
                </Button>
              )}
            </div>
          ) : (
            <Input
              type="number"
              label="Marks"
              required
              min={1}
              value={marks}
              onChange={(e) => setMarks(Number(e.target.value))}
              className="max-w-[160px]"
            />
          )}

          {error && <Alert tone="danger">{error}</Alert>}

          <div>
            <Button type="button" onClick={onSubmit} isLoading={isSubmitting}>
              Add question
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function QuestionBankTab({ schoolClasses, subjects }: { schoolClasses: SchoolClass[]; subjects: Subject[] }) {
  const [schoolClassId, setSchoolClassId] = useState("");
  const [subjectId, setSubjectId] = useState("");

  const {
    data: questions,
    isLoading,
    error,
    refetch,
  } = useAsync(
    () =>
      schoolClassId && subjectId
        ? examGeneratorApi.listQuestions({ schoolClassId, subjectId })
        : Promise.resolve([] as BankQuestion[]),
    [schoolClassId, subjectId],
  );

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Select label="Class" value={schoolClassId} onChange={(e) => setSchoolClassId(e.target.value)}>
              <option value="">Select class</option>
              {schoolClasses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <Select label="Subject" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
              <option value="">Select subject</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
        </CardContent>
      </Card>

      {!schoolClassId || !subjectId ? (
        <EmptyState message="Pick a class and subject to view and add questions." />
      ) : (
        <>
          <AddQuestionForm schoolClassId={schoolClassId} subjectId={subjectId} onCreated={refetch} />

          {isLoading ? (
            <Spinner label="Loading questions" />
          ) : error ? (
            <Alert tone="danger">Failed to load questions: {error.message}</Alert>
          ) : !questions || questions.length === 0 ? (
            <EmptyState message="No questions in the bank yet for this class/subject." />
          ) : (
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Question</TableHeaderCell>
                  <TableHeaderCell>Type</TableHeaderCell>
                  <TableHeaderCell>Chapter</TableHeaderCell>
                  <TableHeaderCell>Marks</TableHeaderCell>
                  <TableHeaderCell>Actions</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {questions.map((q) => (
                  <TableRow key={q.id}>
                    <TableCell className="max-w-[320px] truncate">{q.questionText}</TableCell>
                    <TableCell>
                      <Badge>{QUESTION_TYPE_LABEL[q.type]}</Badge>
                    </TableCell>
                    <TableCell>{q.chapter ?? "—"}</TableCell>
                    <TableCell>{q.marks}</TableCell>
                    <TableCell>
                      <ConfirmButton
                        triggerLabel="Delete"
                        confirmLabel="Delete question"
                        title="Delete this question?"
                        description="Any exam paper already generated from it keeps its own copy and is unaffected."
                        onConfirm={async () => {
                          await examGeneratorApi.removeQuestion(q.id);
                          refetch();
                        }}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </>
      )}
    </div>
  );
}

// ─────────────────────────────── Generate tab ──────────────────────────────

function GenerateTab({
  schoolClasses,
  subjects,
  isAdmin,
}: {
  schoolClasses: SchoolClass[];
  subjects: Subject[];
  isAdmin: boolean;
}) {
  const { data: myGrants } = useAsync(
    () => (isAdmin ? Promise.resolve([] as AccessGrant[]) : examGeneratorApi.myAccessGrants()),
    [isAdmin],
  );

  const allowedClassIds = isAdmin
    ? schoolClasses.map((c) => c.id)
    : Array.from(new Set((myGrants ?? []).map((g) => g.schoolClassId)));
  const availableClasses = schoolClasses.filter((c) => allowedClassIds.includes(c.id));

  const [schoolClassId, setSchoolClassId] = useState("");
  const allowedSubjectIds = isAdmin
    ? subjects.map((s) => s.id)
    : Array.from(new Set((myGrants ?? []).filter((g) => g.schoolClassId === schoolClassId).map((g) => g.subjectId)));
  const availableSubjects = subjects.filter((s) => allowedSubjectIds.includes(s.id));

  const [subjectId, setSubjectId] = useState("");
  useEffect(() => {
    setSubjectId("");
  }, [schoolClassId]);

  const {
    data: summary,
    error: summaryError,
  } = useAsync(
    () =>
      schoolClassId && subjectId
        ? examGeneratorApi.chaptersSummary(schoolClassId, subjectId)
        : Promise.resolve(null as ChaptersSummary | null),
    [schoolClassId, subjectId],
  );

  const {
    data: history,
    refetch: refetchHistory,
  } = useAsync(
    () => (schoolClassId && subjectId ? examGeneratorApi.listPapers(schoolClassId, subjectId) : Promise.resolve([])),
    [schoolClassId, subjectId],
  );

  const [selectedChapters, setSelectedChapters] = useState<string[]>([]);
  const [mcqCount, setMcqCount] = useState(0);
  const [shortCount, setShortCount] = useState(0);
  const [longCount, setLongCount] = useState(0);
  const [genError, setGenError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<GeneratedPaper | null>(null);

  useEffect(() => {
    setSelectedChapters([]);
    setMcqCount(0);
    setShortCount(0);
    setLongCount(0);
    setResult(null);
    setGenError(null);
  }, [schoolClassId, subjectId]);

  const toggleChapter = (chapter: string) =>
    setSelectedChapters((cs) => (cs.includes(chapter) ? cs.filter((c) => c !== chapter) : [...cs, chapter]));

  const onGenerate = async () => {
    setGenError(null);
    if (mcqCount + shortCount + longCount <= 0) {
      setGenError("Request at least one question.");
      return;
    }
    setIsGenerating(true);
    try {
      const paper = await examGeneratorApi.generate({
        schoolClassId,
        subjectId,
        chapters: selectedChapters.length > 0 ? selectedChapters : undefined,
        mcqCount,
        shortCount,
        longCount,
      });
      setResult(paper);
      refetchHistory();
    } catch (err) {
      setGenError(err instanceof ApiError ? err.message : "Could not generate exam paper.");
    } finally {
      setIsGenerating(false);
    }
  };

  if (!isAdmin && myGrants && myGrants.length === 0) {
    return <EmptyState message="No class/subject assigned yet — ask your admin to grant you access." />;
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Select label="Class" value={schoolClassId} onChange={(e) => setSchoolClassId(e.target.value)}>
              <option value="">Select class</option>
              {availableClasses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <Select
              label="Subject"
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
              disabled={!schoolClassId}
            >
              <option value="">{schoolClassId ? "Select subject" : "Select a class first"}</option>
              {availableSubjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
        </CardContent>
      </Card>

      {schoolClassId && subjectId && (
        <>
          {summaryError && <Alert tone="danger">Failed to load chapter data: {summaryError.message}</Alert>}

          <Card>
            <CardHeader>
              <CardTitle>Chapters available in the bank</CardTitle>
            </CardHeader>
            <CardContent>
              {!summary || summary.chapters.length === 0 ? (
                <EmptyState message="No questions in the bank yet for this class/subject." />
              ) : (
                <div className="flex flex-col gap-2">
                  {summary.chapters.map((c) => (
                    <label key={c.chapter ?? "none"} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={selectedChapters.includes(c.chapter ?? "")}
                        onChange={() => toggleChapter(c.chapter ?? "")}
                        disabled={!c.chapter}
                      />
                      <span className="font-medium">{c.chapter ?? "(No chapter tag)"}</span>
                      <span className="text-slate-500">
                        MCQ: {c.mcqCount} · Short: {c.shortCount} · Long: {c.longCount}
                      </span>
                    </label>
                  ))}
                  <p className="mt-1 text-xs text-slate-500">
                    Leave every chapter unchecked to pick from all chapters. Total available — MCQ:{" "}
                    {summary.totals.mcqCount}, Short: {summary.totals.shortCount}, Long: {summary.totals.longCount}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>How many questions?</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Input
                  type="number"
                  label="MCQ"
                  min={0}
                  value={mcqCount}
                  onChange={(e) => setMcqCount(Math.max(0, Number(e.target.value)))}
                />
                <Input
                  type="number"
                  label="Short Answer"
                  min={0}
                  value={shortCount}
                  onChange={(e) => setShortCount(Math.max(0, Number(e.target.value)))}
                />
                <Input
                  type="number"
                  label="Long Answer"
                  min={0}
                  value={longCount}
                  onChange={(e) => setLongCount(Math.max(0, Number(e.target.value)))}
                />
              </div>
              {genError && (
                <Alert tone="danger" className="mt-3">
                  {genError}
                </Alert>
              )}
              <div className="mt-3">
                <Button type="button" onClick={onGenerate} isLoading={isGenerating}>
                  Generate Exam
                </Button>
              </div>
            </CardContent>
          </Card>

          {result && (
            <Card>
              <CardHeader>
                <CardTitle>Generated paper — {result.totalMarks} total marks</CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="flex flex-col gap-3">
                  {(result.questions ?? []).map((q, i) => (
                    <li key={q.id} className="text-sm">
                      <div className="font-medium">
                        {i + 1}. {q.questionText}{" "}
                        <span className="text-slate-500">[{q.marks} marks]</span>
                      </div>
                      {q.type === "MCQ" && q.options && (
                        <ul className="ml-4 mt-1 list-disc text-slate-600">
                          {q.options.map((opt, oi) => (
                            <li key={oi} className={oi === q.correctOptionIndex ? "font-semibold text-green-700" : ""}>
                              {opt}
                              {oi === q.correctOptionIndex ? " (correct)" : ""}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ol>
                <Button
                  type="button"
                  variant="outline"
                  className="mt-4"
                  onClick={() =>
                    downloadFile(`/api/exam-generator/papers/${result.id}/pdf`, `exam-paper-${result.id}.pdf`)
                  }
                >
                  <Download className="mr-1.5 size-4" aria-hidden="true" />
                  Download Exam PDF
                </Button>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>History</CardTitle>
            </CardHeader>
            <CardContent>
              {!history || history.length === 0 ? (
                <EmptyState message="No exam papers generated yet for this class/subject." />
              ) : (
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableHeaderCell>Date</TableHeaderCell>
                      <TableHeaderCell>MCQ</TableHeaderCell>
                      <TableHeaderCell>Short</TableHeaderCell>
                      <TableHeaderCell>Long</TableHeaderCell>
                      <TableHeaderCell>Total Marks</TableHeaderCell>
                      <TableHeaderCell>Actions</TableHeaderCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {history.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell>{new Date(p.createdAt).toLocaleDateString()}</TableCell>
                        <TableCell>{p.mcqCount}</TableCell>
                        <TableCell>{p.shortCount}</TableCell>
                        <TableCell>{p.longCount}</TableCell>
                        <TableCell>{p.totalMarks}</TableCell>
                        <TableCell>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => downloadFile(`/api/exam-generator/papers/${p.id}/pdf`, `exam-paper-${p.id}.pdf`)}
                          >
                            <Download className="mr-1 size-4" aria-hidden="true" />
                            PDF
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
