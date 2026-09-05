import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PortalStudentHeader } from "./PortalStudentHeader";
import type { PortalStudentSummary } from "@/lib/resources/portal";

function student(overrides: Partial<PortalStudentSummary> = {}): PortalStudentSummary {
  return {
    id: "st1",
    studentCode: "2026-000001",
    fullName: "Hassan Iqbal",
    status: "ACTIVE",
    photoUrl: null,
    currentSection: { id: "sec1", name: "A", schoolClass: { name: "Class 5" } },
    ...overrides,
  };
}

describe("PortalStudentHeader", () => {
  it("shows the student's name, code, section, and an ACTIVE badge", () => {
    render(<PortalStudentHeader student={student()} />);

    expect(screen.getByRole("heading", { name: "Hassan Iqbal" })).toBeInTheDocument();
    expect(screen.getByText(/2026-000001/)).toBeInTheDocument();
    expect(screen.getByText(/Class 5 - A/)).toBeInTheDocument();
    expect(screen.getByText("ACTIVE")).toBeInTheDocument();
  });

  it("shows 'Not enrolled' when the student has no current section", () => {
    render(<PortalStudentHeader student={student({ currentSection: null })} />);

    expect(screen.getByText(/Not enrolled/)).toBeInTheDocument();
  });
});
