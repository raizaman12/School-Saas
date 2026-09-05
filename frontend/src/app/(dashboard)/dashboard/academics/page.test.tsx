import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AcademicsPage from "./page";

const SECTION_ID = "22222222-2222-4222-8222-222222222222";
const CORE_SS_ID = "33333333-3333-4333-8333-333333333333";
const ELECTIVE_SS_ID = "44444444-4444-4444-8444-444444444444";
const STUDENT_ID = "55555555-5555-4555-8555-555555555555";
const CORE_SUBJECT_ID = "66666666-6666-4666-8666-666666666666";
const ELECTIVE_SUBJECT_ID = "77777777-7777-4777-8777-777777777777";

const listYearsMock = vi.fn().mockResolvedValue([]);
const listClassesMock = vi.fn().mockResolvedValue([]);
const listSubjectsMock = vi
  .fn()
  .mockResolvedValue([{ id: ELECTIVE_SUBJECT_ID, name: "Computer Science", code: null }]);
const listSectionsMock = vi.fn().mockResolvedValue([
  {
    id: SECTION_ID,
    name: "A",
    roomNumber: null,
    capacity: null,
    schoolClass: { id: "c1", name: "Grade 11", order: 11 },
    academicYear: { id: "y1", name: "2025-2026", isActive: true },
    classTeacher: null,
    _count: { students: 2 },
  },
]);
const listSectionSubjectsMock = vi.fn().mockResolvedValue([
  {
    id: CORE_SS_ID,
    subject: { id: CORE_SUBJECT_ID, name: "Mathematics", code: null },
    teacher: null,
    isElective: false,
  },
  {
    id: ELECTIVE_SS_ID,
    subject: { id: ELECTIVE_SUBJECT_ID, name: "Computer Science", code: null },
    teacher: null,
    isElective: true,
  },
]);
const listTimetableMock = vi.fn().mockResolvedValue([]);
const staffListMock = vi.fn().mockResolvedValue({ data: [], meta: { page: 1, limit: 100, total: 0, totalPages: 1 } });
const assignSectionSubjectMock = vi.fn();
const listElectiveStudentsMock = vi.fn().mockResolvedValue([
  { id: STUDENT_ID, fullName: "Bilal Ahmed", studentCode: "TS-2026-000002", enrolled: false },
]);
const setElectiveStudentsMock = vi.fn();

vi.mock("@/lib/resources/academics", async () => {
  const actual = await vi.importActual<typeof import("@/lib/resources/academics")>("@/lib/resources/academics");
  return {
    ...actual,
    academicsApi: {
      listYears: (...args: unknown[]) => listYearsMock(...args),
      listClasses: (...args: unknown[]) => listClassesMock(...args),
      listSubjects: (...args: unknown[]) => listSubjectsMock(...args),
      listSections: (...args: unknown[]) => listSectionsMock(...args),
      listSectionSubjects: (...args: unknown[]) => listSectionSubjectsMock(...args),
      listTimetable: (...args: unknown[]) => listTimetableMock(...args),
      assignSectionSubject: (...args: unknown[]) => assignSectionSubjectMock(...args),
      removeSectionSubject: vi.fn(),
      listElectiveStudents: (...args: unknown[]) => listElectiveStudentsMock(...args),
      setElectiveStudents: (...args: unknown[]) => setElectiveStudentsMock(...args),
      createYear: vi.fn(),
      createClass: vi.fn(),
      createSubject: vi.fn(),
      createSection: vi.fn(),
      createTimetableSlot: vi.fn(),
      updateTimetableSlot: vi.fn(),
      removeTimetableSlot: vi.fn(),
      promoteSection: vi.fn(),
    },
  };
});

vi.mock("@/lib/resources/staff", () => ({
  staffApi: { list: (...args: unknown[]) => staffListMock(...args) },
}));

vi.mock("@/lib/resources/students", () => ({
  studentsApi: { list: vi.fn().mockResolvedValue({ data: [], meta: { page: 1, limit: 200, total: 0, totalPages: 1 } }) },
}));

vi.mock("@/lib/auth/AuthProvider", () => ({
  useAuth: () => ({ user: { role: "SCHOOL_ADMIN" } }),
}));

describe("AcademicsPage — elective subjects", () => {
  beforeEach(() => {
    listSectionSubjectsMock.mockClear();
    assignSectionSubjectMock.mockClear();
    listElectiveStudentsMock.mockClear();
    setElectiveStudentsMock.mockClear();
  });

  it("assigns a subject as elective via the checkbox", async () => {
    assignSectionSubjectMock.mockResolvedValue({ id: "new-ss" });
    const user = userEvent.setup();
    render(<AcademicsPage />);

    await user.click(await screen.findByRole("button", { name: "Timetable" }));
    await screen.findByText("Mathematics");

    const form = screen.getByTestId("assign-subject-form");
    await within(form).findByRole("option", { name: "Computer Science" });
    await user.selectOptions(within(form).getByLabelText(/^Subject/), ELECTIVE_SUBJECT_ID);
    await user.click(within(form).getByLabelText(/Elective —/));
    await user.click(within(form).getByRole("button", { name: "Assign" }));

    await waitFor(() => expect(assignSectionSubjectMock).toHaveBeenCalledTimes(1));
    expect(assignSectionSubjectMock).toHaveBeenCalledWith(
      SECTION_ID,
      expect.objectContaining({ subjectId: ELECTIVE_SUBJECT_ID, isElective: true }),
    );
  });

  it("shows Elective/Core badges and lets an admin manage an elective's student roster", async () => {
    setElectiveStudentsMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<AcademicsPage />);

    await user.click(await screen.findByRole("button", { name: "Timetable" }));
    await screen.findByText("Mathematics");

    expect(screen.getByText("Core")).toBeInTheDocument();
    expect(screen.getByText("Elective")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Manage students" }));
    await waitFor(() => expect(listElectiveStudentsMock).toHaveBeenCalledWith(ELECTIVE_SS_ID));

    const panel = await screen.findByText(/Who takes Computer Science/);
    const checkbox = within(panel.closest("div")!.parentElement as HTMLElement).getByRole("checkbox");
    await user.click(checkbox);
    await user.click(screen.getByRole("button", { name: "Save roster" }));

    await waitFor(() => expect(setElectiveStudentsMock).toHaveBeenCalledWith(ELECTIVE_SS_ID, [STUDENT_ID]));
  });
});
