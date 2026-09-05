import { Suspense, act } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import PortalStudentSupportNeedsPage from "./page";

const studentMock = vi.fn();
const supportNeedsMock = vi.fn();

vi.mock("@/lib/resources/portal", () => ({
  portalApi: {
    student: (...args: unknown[]) => studentMock(...args),
    supportNeeds: (...args: unknown[]) => supportNeedsMock(...args),
  },
}));

async function renderPage() {
  await act(async () => {
    render(
      <Suspense fallback={null}>
        <PortalStudentSupportNeedsPage params={Promise.resolve({ id: "st1" })} />
      </Suspense>,
    );
  });
}

function mockStudent() {
  studentMock.mockResolvedValue({
    id: "st1",
    studentCode: "2026-000001",
    fullName: "Hassan Iqbal",
    status: "ACTIVE",
    photoUrl: null,
    currentSection: { id: "sec1", name: "A", schoolClass: { name: "Class 5" } },
  });
}

describe("PortalStudentSupportNeedsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows an empty state when there are no learning support plans", async () => {
    mockStudent();
    supportNeedsMock.mockResolvedValue([]);

    await renderPage();

    expect(await screen.findByText("No learning support plans.")).toBeInTheDocument();
  });

  it("renders a support plan's category, status, description, and exam accommodations", async () => {
    mockStudent();
    supportNeedsMock.mockResolvedValue([
      {
        id: "sn1",
        category: "SPEECH_LANGUAGE_SUPPORT",
        description: "Needs extra time to articulate answers.",
        identifiedDate: "2026-01-10T00:00:00.000Z",
        status: "ACTIVE",
        supportProvided: "Weekly session with speech therapist.",
        examAccommodations: "20% extra time in oral exams.",
        nextReviewDate: null,
      },
    ]);

    await renderPage();

    expect(await screen.findByText("Speech / language support")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Needs extra time to articulate answers.")).toBeInTheDocument();
    expect(screen.getByText(/20% extra time in oral exams/)).toBeInTheDocument();
  });
});
