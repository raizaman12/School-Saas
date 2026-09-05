import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SupportNeedsPage from "./page";

const listMock = vi.fn().mockResolvedValue({
  data: [],
  meta: { page: 1, limit: 20, total: 0, totalPages: 1 },
});
const createMock = vi.fn();
const addReviewMock = vi.fn();
const STUDENT_ID = "11111111-1111-4111-8111-111111111111";
const studentsListMock = vi.fn().mockResolvedValue({
  data: [{ id: STUDENT_ID, studentCode: "TS-2026-000001", fullName: "Hassan Iqbal" }],
  meta: { page: 1, limit: 8, total: 1, totalPages: 1 },
});

vi.mock("@/lib/resources/supportNeeds", async () => {
  const actual = await vi.importActual<typeof import("@/lib/resources/supportNeeds")>("@/lib/resources/supportNeeds");
  return {
    ...actual,
    supportNeedsApi: {
      list: (...args: unknown[]) => listMock(...args),
      get: vi.fn(),
      create: (...args: unknown[]) => createMock(...args),
      update: vi.fn(),
      addReview: (...args: unknown[]) => addReviewMock(...args),
      remove: vi.fn(),
    },
  };
});

vi.mock("@/lib/resources/students", () => ({
  studentsApi: { list: (...args: unknown[]) => studentsListMock(...args) },
}));

describe("SupportNeedsPage", () => {
  beforeEach(() => {
    listMock.mockClear();
    createMock.mockClear();
    addReviewMock.mockClear();
    studentsListMock.mockClear();
  });

  it("logs a support plan by searching and picking a student, then submitting the form", async () => {
    createMock.mockResolvedValue({ id: "sn1" });
    const user = userEvent.setup();
    render(<SupportNeedsPage />);

    await user.click(screen.getByRole("button", { name: "Log plan" }));
    await user.type(screen.getByLabelText(/Student/), "Hassan");

    await waitFor(() => expect(screen.getByText(/Hassan Iqbal/)).toBeInTheDocument());
    await user.click(screen.getByText(/Hassan Iqbal/));

    await user.type(screen.getByLabelText(/What was observed/), "Difficulty keeping up with reading pace.");
    await user.type(screen.getByLabelText(/Support being provided/), "Extra reading time with resource teacher.");

    const form = screen.getByTestId("log-support-need-form");
    await user.click(within(form).getByRole("button", { name: "Save plan" }));

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        studentId: STUDENT_ID,
        description: "Difficulty keeping up with reading pace.",
        supportProvided: "Extra reading time with resource teacher.",
        category: "LEARNING_SUPPORT",
      }),
    );
  });

  it("lists plans and adds a review that updates the status", async () => {
    listMock.mockResolvedValue({
      data: [
        {
          id: "sn1",
          category: "SPEECH_LANGUAGE_SUPPORT",
          description: "Mild stammering.",
          identifiedDate: "2026-01-01",
          status: "ACTIVE",
          supportProvided: "Weekly speech therapy referral.",
          examAccommodations: null,
          nextReviewDate: null,
          student: { id: "s1", fullName: "Hassan Iqbal", studentCode: "TS-2026-000001", currentSectionId: null },
          coordinatorUser: null,
          createdByUser: { id: "u1", fullName: "Admin User" },
          reviews: [],
        },
      ],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    addReviewMock.mockResolvedValue({});
    const user = userEvent.setup();
    render(<SupportNeedsPage />);

    expect(await screen.findByText(/Hassan Iqbal/)).toBeInTheDocument();
    expect(screen.getByText("Speech / language support")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Add review/ }));
    await user.type(screen.getByLabelText(/Review notes/), "Noticeable improvement after therapy.");
    await user.selectOptions(screen.getByLabelText(/Update status to/), "RESOLVED");
    await user.click(screen.getByRole("button", { name: "Add review" }));

    await waitFor(() =>
      expect(addReviewMock).toHaveBeenCalledWith(
        "sn1",
        expect.objectContaining({ notes: "Noticeable improvement after therapy.", updatedStatus: "RESOLVED" }),
      ),
    );
  });

  it("adds a review leaving 'Update status to' at its default (Leave unchanged) — regression: empty-string enum value must not block submission", async () => {
    listMock.mockResolvedValue({
      data: [
        {
          id: "sn1",
          category: "OTHER",
          description: "General note.",
          identifiedDate: "2026-01-01",
          status: "ACTIVE",
          supportProvided: "Monitoring.",
          examAccommodations: null,
          nextReviewDate: null,
          student: { id: "s1", fullName: "Hassan Iqbal", studentCode: "TS-2026-000001", currentSectionId: null },
          coordinatorUser: null,
          createdByUser: { id: "u1", fullName: "Admin User" },
          reviews: [],
        },
      ],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    addReviewMock.mockResolvedValue({});
    const user = userEvent.setup();
    render(<SupportNeedsPage />);

    expect(await screen.findByText(/Hassan Iqbal/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Add review/ }));
    await user.type(screen.getByLabelText(/Review notes/), "Still monitoring, no change yet.");
    // "Update status to" is left at its default "Leave unchanged" (value="").
    await user.click(screen.getByRole("button", { name: "Add review" }));

    await waitFor(() => expect(addReviewMock).toHaveBeenCalledTimes(1));
    expect(addReviewMock).toHaveBeenCalledWith(
      "sn1",
      expect.objectContaining({ notes: "Still monitoring, no change yet.", updatedStatus: undefined }),
    );
  });
});
