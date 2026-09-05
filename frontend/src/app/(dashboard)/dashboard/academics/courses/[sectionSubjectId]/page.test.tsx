import { Suspense, act } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ManageCoursePage from "./page";

const mySectionSubjectsMock = vi.fn();
const noticesListMock = vi.fn();
const noticesCreateMock = vi.fn();
const materialsListMock = vi.fn();
const materialsCreateMock = vi.fn();
const homeworkListMock = vi.fn();
const homeworkCreateMock = vi.fn();
const documentUploadMock = vi.fn();

vi.mock("@/lib/resources/academics", async () => {
  const actual = await vi.importActual<typeof import("@/lib/resources/academics")>("@/lib/resources/academics");
  return { ...actual, academicsApi: { mySectionSubjects: (...args: unknown[]) => mySectionSubjectsMock(...args) } };
});

vi.mock("@/lib/resources/notices", async () => {
  const actual = await vi.importActual<typeof import("@/lib/resources/notices")>("@/lib/resources/notices");
  return {
    ...actual,
    noticesApi: {
      list: (...args: unknown[]) => noticesListMock(...args),
      create: (...args: unknown[]) => noticesCreateMock(...args),
    },
  };
});

vi.mock("@/lib/resources/courseMaterials", () => ({
  courseMaterialsApi: {
    list: (...args: unknown[]) => materialsListMock(...args),
    create: (...args: unknown[]) => materialsCreateMock(...args),
    remove: vi.fn(),
  },
}));

vi.mock("@/lib/resources/homework", () => ({
  homeworkApi: {
    list: (...args: unknown[]) => homeworkListMock(...args),
    create: (...args: unknown[]) => homeworkCreateMock(...args),
    remove: vi.fn(),
  },
}));

vi.mock("@/lib/resources/uploads", () => ({
  uploadsApi: { document: (...args: unknown[]) => documentUploadMock(...args) },
}));

const attendanceRosterMock = vi.fn();
const attendanceMarkMock = vi.fn();

vi.mock("@/lib/resources/attendance", async () => {
  const actual = await vi.importActual<typeof import("@/lib/resources/attendance")>("@/lib/resources/attendance");
  return {
    ...actual,
    attendanceApi: {
      roster: (...args: unknown[]) => attendanceRosterMock(...args),
      mark: (...args: unknown[]) => attendanceMarkMock(...args),
    },
  };
});

const examsForSectionSubjectMock = vi.fn();
const submitMarksMock = vi.fn();
const unsubmitMarksMock = vi.fn();

vi.mock("@/lib/resources/exams", async () => {
  const actual = await vi.importActual<typeof import("@/lib/resources/exams")>("@/lib/resources/exams");
  return {
    ...actual,
    examsApi: {
      examsForSectionSubject: (...args: unknown[]) => examsForSectionSubjectMock(...args),
      submitMarks: (...args: unknown[]) => submitMarksMock(...args),
      unsubmitMarks: (...args: unknown[]) => unsubmitMarksMock(...args),
    },
  };
});

const classTestsForSectionSubjectMock = vi.fn();
const classTestsCreateMock = vi.fn();

vi.mock("@/lib/resources/classTests", async () => {
  const actual = await vi.importActual<typeof import("@/lib/resources/classTests")>("@/lib/resources/classTests");
  return {
    ...actual,
    classTestsApi: {
      forSectionSubject: (...args: unknown[]) => classTestsForSectionSubjectMock(...args),
      create: (...args: unknown[]) => classTestsCreateMock(...args),
    },
  };
});

const COURSE = {
  id: "ss1",
  subject: { id: "sub1", name: "Chemistry" },
  section: { id: "sec1", name: "B", schoolClass: { id: "c1", name: "Class 9" } },
  timetableSlots: [],
};

// Real bug this covers: a teacher could hit "Save attendance" on the course
// page a couple of minutes before their own lecture's scheduled start time,
// since the roster UI never checked the timetable at all — see
// upcomingSlotToday/assertLectureHasStarted's doc comments in page.tsx and
// the backend's attendance.ts. These helpers build a timetable slot
// relative to the real current time so the tests hold regardless of when
// they're run.
const DAY_NAMES = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"] as const;
function todaysDayOfWeek() {
  return DAY_NAMES[new Date().getUTCDay()];
}
// Offset from the current Pakistan wall-clock time-of-day (matching
// production's minutesSinceMidnightPakistanNow — see page.tsx's own doc
// comment), not raw UTC "now" — the slot times these produce are compared
// against a Pakistan-shifted "now" by the component under test.
function isoTimeOffsetFromNow(offsetMinutes: number) {
  const now = new Date();
  const pakistanNowMinutes = (now.getUTCHours() * 60 + now.getUTCMinutes() + 5 * 60) % 1440;
  const wrapped = ((pakistanNowMinutes + offsetMinutes) % 1440 + 1440) % 1440;
  const hh = String(Math.floor(wrapped / 60)).padStart(2, "0");
  const mm = String(wrapped % 60).padStart(2, "0");
  return `1970-01-01T${hh}:${mm}:00.000Z`;
}

// See portal/students/[id]/page.test.tsx's renderPage for why this must be
// wrapped in an awaited act() — params is unwrapped via React's use(), and
// its Suspense retry needs a flushed microtask to land in this environment.
async function renderPage() {
  await act(async () => {
    render(
      <Suspense fallback={null}>
        <ManageCoursePage params={Promise.resolve({ sectionSubjectId: "ss1" })} />
      </Suspense>,
    );
  });
}

function emptyPaginated() {
  return Promise.resolve({ data: [], meta: { page: 1, limit: 20, total: 0, totalPages: 1 } });
}

describe("ManageCoursePage (teacher manage-course)", () => {
  // Without this, mock call counts leak across `it` blocks in this file
  // (e.g. attendanceMarkMock's call count from one test carrying into the
  // next), which is what made the lecture-start-guard tests below flaky —
  // matches the beforeEach(() => vi.clearAllMocks()) convention already
  // used in every other test file in this app (e.g. GuardiansPage's).
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the course header and posts a SECTION announcement for this course", async () => {
    mySectionSubjectsMock.mockResolvedValue([COURSE]);
    noticesListMock.mockImplementation(emptyPaginated);
    noticesCreateMock.mockResolvedValue({ id: "n1" });

    const user = userEvent.setup();
    await renderPage();

    expect(await screen.findByText("Chemistry")).toBeInTheDocument();
    expect(screen.getByText("Class 9 - B")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Post announcement" }));
    await user.type(screen.getByLabelText(/Title/), "Bring calculators");
    await user.type(screen.getByLabelText(/Message/), "Tomorrow's test needs a calculator.");
    await user.click(screen.getByRole("button", { name: "Publish" }));

    await waitFor(() => expect(noticesCreateMock).toHaveBeenCalledTimes(1));
    expect(noticesCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Bring calculators", audiences: ["SECTION"], sectionId: "sec1" }),
    );
  });

  it("returns a not-found message for a course the teacher doesn't own", async () => {
    mySectionSubjectsMock.mockResolvedValue([]);
    await renderPage();

    expect(await screen.findByText(/not the assigned teacher/)).toBeInTheDocument();
  });

  it("uploads and shares course material from the Course Material tab", async () => {
    mySectionSubjectsMock.mockResolvedValue([COURSE]);
    materialsListMock.mockResolvedValue([]);
    documentUploadMock.mockResolvedValue({ url: "http://localhost:4000/uploads/t1/notes.pdf", originalName: "notes.pdf" });
    materialsCreateMock.mockResolvedValue({ id: "m1" });

    const user = userEvent.setup();
    await renderPage();

    await user.click(await screen.findByRole("button", { name: /Course Material/ }));
    await user.click(screen.getByRole("button", { name: "Share material" }));

    const fileInput = screen.getByLabelText("Choose file", { selector: "input" });
    await user.upload(fileInput, new File(["x"], "notes.pdf", { type: "application/pdf" }));

    await waitFor(() => expect(documentUploadMock).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Share" }));

    await waitFor(() => expect(materialsCreateMock).toHaveBeenCalledTimes(1));
    expect(materialsCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ sectionSubjectId: "ss1", fileUrl: "http://localhost:4000/uploads/t1/notes.pdf" }),
    );
  });

  it("assigns homework scoped to this section+subject from the Assessment tab", async () => {
    mySectionSubjectsMock.mockResolvedValue([COURSE]);
    homeworkListMock.mockImplementation(emptyPaginated);
    homeworkCreateMock.mockResolvedValue({ id: "h1" });

    const user = userEvent.setup();
    await renderPage();

    await user.click(await screen.findByRole("button", { name: /Assessment/ }));
    await user.click(screen.getByRole("button", { name: "Assign homework" }));
    await user.type(screen.getByLabelText(/Title/), "Chapter 3 exercises");
    await user.type(screen.getByLabelText(/Due date/), "2026-09-01");
    await user.click(screen.getByRole("button", { name: "Assign" }));

    await waitFor(() => expect(homeworkCreateMock).toHaveBeenCalledTimes(1));
    expect(homeworkCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ sectionId: "sec1", subjectId: "sub1", title: "Chapter 3 exercises", dueDate: "2026-09-01" }),
    );
  });

  it("marks attendance for the class from the Attendance tab, scoped to this course's own section", async () => {
    // Needs an actual today's-timetable slot now that a subject with no
    // lecture scheduled today hides the roster entirely (see the
    // "no-slot-today" tests below) — the bare COURSE fixture (no slots at
    // all) no longer exercises the happy path this test is for.
    const courseWithOpenLecture = {
      ...COURSE,
      timetableSlots: [
        {
          id: "slot1",
          dayOfWeek: todaysDayOfWeek(),
          startTime: isoTimeOffsetFromNow(-10),
          endTime: isoTimeOffsetFromNow(30),
        },
      ],
    };
    mySectionSubjectsMock.mockResolvedValue([courseWithOpenLecture]);
    attendanceRosterMock.mockResolvedValue({
      holiday: null,
      roster: [{ studentId: "s1", studentCode: "S-001", fullName: "Ali Raza", status: null, remarks: null }],
    });
    attendanceMarkMock.mockResolvedValue(undefined);

    const user = userEvent.setup();
    await renderPage();

    await user.click(await screen.findByRole("button", { name: /Attendance/ }));
    expect(attendanceRosterMock).toHaveBeenCalledWith("sec1", expect.any(String));

    await screen.findByText("Ali Raza");
    await user.click(screen.getByRole("button", { name: "P" }));
    await user.click(screen.getByRole("button", { name: "Save attendance" }));

    await waitFor(() => expect(attendanceMarkMock).toHaveBeenCalledTimes(1));
    expect(attendanceMarkMock).toHaveBeenCalledWith(
      expect.objectContaining({ sectionId: "sec1", records: [{ studentId: "s1", status: "PRESENT" }] }),
    );
  });

  it("shows a no-class banner instead of a roster on a weekly-off day", async () => {
    mySectionSubjectsMock.mockResolvedValue([COURSE]);
    attendanceRosterMock.mockResolvedValue({ holiday: { reason: "WEEKLY_OFF", label: "Sunday" }, roster: [] });

    const user = userEvent.setup();
    await renderPage();

    await user.click(await screen.findByRole("button", { name: /Attendance/ }));
    expect(await screen.findByText(/Weekly off — Sunday/)).toBeInTheDocument();
  });

  // Real bug this covers: a teacher could mark (and the class teacher could
  // separately have already marked) attendance for a subject on a day it
  // was never actually on the timetable at all — e.g. a Wednesday when this
  // subject only ever runs Mon/Tue/Thu. No timetable slot for today at all
  // (COURSE's default) should hide the roster entirely, not just leave it
  // open.
  it("hides the roster instead of allowing attendance for a subject with no timetable slot today", async () => {
    mySectionSubjectsMock.mockResolvedValue([COURSE]);
    attendanceRosterMock.mockResolvedValue({
      holiday: null,
      roster: [{ studentId: "s1", studentCode: "S-001", fullName: "Ali Raza", status: null, remarks: null }],
    });

    const user = userEvent.setup();
    await renderPage();

    await user.click(await screen.findByRole("button", { name: /Attendance/ }));

    expect(await screen.findByText(/no lecture scheduled for today/)).toBeInTheDocument();
    expect(screen.queryByText("Ali Raza")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save attendance" })).not.toBeInTheDocument();
  });

  it("blocks Save attendance until today's scheduled lecture actually starts", async () => {
    const courseWithUpcomingLecture = {
      ...COURSE,
      timetableSlots: [
        {
          id: "t1",
          dayOfWeek: todaysDayOfWeek(),
          startTime: isoTimeOffsetFromNow(5),
          endTime: isoTimeOffsetFromNow(45),
          roomNumber: null,
        },
      ],
    };
    mySectionSubjectsMock.mockResolvedValue([courseWithUpcomingLecture]);
    attendanceRosterMock.mockResolvedValue({
      holiday: null,
      roster: [{ studentId: "s1", studentCode: "S-001", fullName: "Ali Raza", status: null, remarks: null }],
    });

    const user = userEvent.setup();
    await renderPage();

    await user.click(await screen.findByRole("button", { name: /Attendance/ }));
    expect(await screen.findByText(/hasn't started yet/)).toBeInTheDocument();

    await screen.findByText("Ali Raza");
    await user.click(screen.getByRole("button", { name: "P" }));
    const saveButton = screen.getByRole("button", { name: /Unlocks at/ });
    expect(saveButton).toBeDisabled();

    // Disabled means a click can't fire it — confirms the frontend actually
    // stops the request rather than merely discouraging it visually.
    await user.click(saveButton);
    expect(attendanceMarkMock).not.toHaveBeenCalled();
  });

  it("allows Save attendance once the scheduled lecture has started", async () => {
    const courseWithOngoingLecture = {
      ...COURSE,
      timetableSlots: [
        {
          id: "t1",
          dayOfWeek: todaysDayOfWeek(),
          startTime: isoTimeOffsetFromNow(-5),
          endTime: isoTimeOffsetFromNow(35),
          roomNumber: null,
        },
      ],
    };
    mySectionSubjectsMock.mockResolvedValue([courseWithOngoingLecture]);
    attendanceRosterMock.mockResolvedValue({
      holiday: null,
      roster: [{ studentId: "s1", studentCode: "S-001", fullName: "Ali Raza", status: null, remarks: null }],
    });
    attendanceMarkMock.mockResolvedValue(undefined);

    const user = userEvent.setup();
    await renderPage();

    await user.click(await screen.findByRole("button", { name: /Attendance/ }));
    expect(screen.queryByText(/hasn't started yet/)).not.toBeInTheDocument();

    await screen.findByText("Ali Raza");
    await user.click(screen.getByRole("button", { name: "P" }));
    await user.click(screen.getByRole("button", { name: "Save attendance" }));

    await waitFor(() => expect(attendanceMarkMock).toHaveBeenCalledTimes(1));
    expect(attendanceMarkMock).toHaveBeenCalledWith(
      expect.objectContaining({ sectionId: "sec1", sectionSubjectId: "ss1", records: [{ studentId: "s1", status: "PRESENT" }] }),
    );
  });

  // Second half of the user's own report: a teacher could reopen and
  // rewrite attendance long after the lecture ended. Lecture ran -37..+3
  // (40 minutes), so "now" is 2 minutes past the endTime-5 lock cutoff —
  // solidly inside the locked window, matching the backend test's offsets.
  it("locks Save attendance once the lecture's window has closed (5 minutes before its end)", async () => {
    const courseWithLockedLecture = {
      ...COURSE,
      timetableSlots: [
        {
          id: "t1",
          dayOfWeek: todaysDayOfWeek(),
          startTime: isoTimeOffsetFromNow(-37),
          endTime: isoTimeOffsetFromNow(3),
          roomNumber: null,
        },
      ],
    };
    mySectionSubjectsMock.mockResolvedValue([courseWithLockedLecture]);
    attendanceRosterMock.mockResolvedValue({
      holiday: null,
      roster: [{ studentId: "s1", studentCode: "S-001", fullName: "Ali Raza", status: null, remarks: null }],
    });

    const user = userEvent.setup();
    await renderPage();

    await user.click(await screen.findByRole("button", { name: /Attendance/ }));
    expect(await screen.findByText(/attendance window closed/)).toBeInTheDocument();

    await screen.findByText("Ali Raza");
    await user.click(screen.getByRole("button", { name: "P" }));
    const saveButton = screen.getByRole("button", { name: "Locked" });
    expect(saveButton).toBeDisabled();

    await user.click(saveButton);
    expect(attendanceMarkMock).not.toHaveBeenCalled();
  });

  it("still allows Save attendance mid-lecture, before the end-of-lecture lock kicks in", async () => {
    const courseWithOngoingLecture = {
      ...COURSE,
      timetableSlots: [
        {
          id: "t1",
          dayOfWeek: todaysDayOfWeek(),
          // 10 minutes in, 25 minutes clear of the 5-minutes-before-end lock.
          startTime: isoTimeOffsetFromNow(-10),
          endTime: isoTimeOffsetFromNow(30),
          roomNumber: null,
        },
      ],
    };
    mySectionSubjectsMock.mockResolvedValue([courseWithOngoingLecture]);
    attendanceRosterMock.mockResolvedValue({
      holiday: null,
      roster: [{ studentId: "s1", studentCode: "S-001", fullName: "Ali Raza", status: null, remarks: null }],
    });
    attendanceMarkMock.mockResolvedValue(undefined);

    const user = userEvent.setup();
    await renderPage();

    await user.click(await screen.findByRole("button", { name: /Attendance/ }));
    expect(screen.queryByText(/hasn't started yet/)).not.toBeInTheDocument();
    expect(screen.queryByText(/attendance window closed/)).not.toBeInTheDocument();

    await screen.findByText("Ali Raza");
    await user.click(screen.getByRole("button", { name: "P" }));
    await user.click(screen.getByRole("button", { name: "Save attendance" }));

    await waitFor(() => expect(attendanceMarkMock).toHaveBeenCalledTimes(1));
  });

  it("lists this subject's exams on the Grades tab with a direct link to marks entry, and can submit/reopen", async () => {
    mySectionSubjectsMock.mockResolvedValue([COURSE]);
    examsForSectionSubjectMock.mockResolvedValue([
      {
        id: "es1",
        maxMarks: 100,
        passingMarks: 33,
        marksSubmittedAt: null,
        marksSubmittedBy: null,
        exam: { id: "exam1", name: "Mid Term", resultsDeadline: null },
      },
    ]);
    submitMarksMock.mockResolvedValue({ id: "es1", marksSubmittedAt: "2026-08-23T00:00:00.000Z" });
    classTestsForSectionSubjectMock.mockResolvedValue([]);

    const user = userEvent.setup();
    await renderPage();

    await user.click(await screen.findByRole("button", { name: /Grades/ }));
    expect(await screen.findByText("Mid Term")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Make grades/ })).toHaveAttribute(
      "href",
      "/dashboard/exams/exam1/marks/es1",
    );

    await user.click(screen.getByRole("button", { name: /Submit/ }));
    await waitFor(() => expect(submitMarksMock).toHaveBeenCalledWith("es1"));
  });

  // Real feature this covers: a teacher's self-serve "class test" — created
  // directly from this Grades tab, with no admin setup required first (see
  // the backend's classTests.ts doc comment for why these never end up
  // counted in a report card or class ranking).
  it("lets a teacher self-serve create a class test on the Grades tab, then links to its own marks-entry page", async () => {
    mySectionSubjectsMock.mockResolvedValue([COURSE]);
    examsForSectionSubjectMock.mockResolvedValue([]);
    classTestsForSectionSubjectMock.mockResolvedValueOnce([]).mockResolvedValue([
      {
        id: "ct1",
        sectionSubjectId: "ss1",
        name: "Chapter 3 quiz",
        maxMarks: 20,
        passingMarks: 8,
        createdAt: "2026-08-23T00:00:00.000Z",
        createdBy: { id: "t1", fullName: "Ms. Ayesha" },
        marksEnteredCount: 0,
      },
    ]);
    classTestsCreateMock.mockResolvedValue({ id: "ct1" });

    const user = userEvent.setup();
    await renderPage();

    await user.click(await screen.findByRole("button", { name: /Grades/ }));
    expect(await screen.findByText(/No class tests yet/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /New class test/ }));
    await user.type(screen.getByLabelText(/Name/), "Chapter 3 quiz");
    await user.type(screen.getByLabelText(/Max marks/), "20");
    await user.type(screen.getByLabelText(/Passing marks/), "8");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(classTestsCreateMock).toHaveBeenCalledWith({
        sectionSubjectId: "ss1",
        name: "Chapter 3 quiz",
        maxMarks: 20,
        passingMarks: 8,
      }),
    );

    expect(await screen.findByText("Chapter 3 quiz")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Enter marks/ })).toHaveAttribute(
      "href",
      "/dashboard/academics/courses/ss1/class-tests/ct1",
    );
  });
});
