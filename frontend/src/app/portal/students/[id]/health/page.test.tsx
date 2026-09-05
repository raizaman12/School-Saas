import { Suspense, act } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import PortalStudentHealthPage from "./page";

const studentMock = vi.fn();
const healthProfileMock = vi.fn();
const healthLogMock = vi.fn();

vi.mock("@/lib/resources/portal", () => ({
  portalApi: {
    student: (...args: unknown[]) => studentMock(...args),
    healthProfile: (...args: unknown[]) => healthProfileMock(...args),
    healthLog: (...args: unknown[]) => healthLogMock(...args),
  },
}));

async function renderPage() {
  await act(async () => {
    render(
      <Suspense fallback={null}>
        <PortalStudentHealthPage params={Promise.resolve({ id: "st1" })} />
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

describe("PortalStudentHealthPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows an empty state when no health profile is recorded", async () => {
    mockStudent();
    healthProfileMock.mockResolvedValue(null);
    healthLogMock.mockResolvedValue([]);

    await renderPage();

    expect(await screen.findByText("No health profile recorded yet.")).toBeInTheDocument();
  });

  it("shows blood group, emergency contact, allergies, and the visit log", async () => {
    mockStudent();
    healthProfileMock.mockResolvedValue({
      id: "hp1",
      bloodGroup: "O_POSITIVE",
      allergies: "Peanuts",
      chronicConditions: null,
      currentMedications: null,
      emergencyMedicalNotes: null,
      emergencyContactName: "Ahmed Iqbal",
      emergencyContactPhone: "03001234567",
      doctorName: null,
      doctorPhone: null,
      updatedAt: "2026-08-01T00:00:00.000Z",
    });
    healthLogMock.mockResolvedValue([
      { id: "hl1", visitDate: "2026-08-10T00:00:00.000Z", complaint: "Headache", outcome: "RETURNED_TO_CLASS" },
    ]);

    await renderPage();

    expect(await screen.findByText("O+")).toBeInTheDocument();
    expect(screen.getByText(/Ahmed Iqbal/)).toBeInTheDocument();
    expect(screen.getByText("Peanuts")).toBeInTheDocument();
    expect(screen.getByText("Headache")).toBeInTheDocument();
    expect(screen.getByText("Returned to class")).toBeInTheDocument();
  });
});
