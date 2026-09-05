import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import AnalyticsPage from "./page";

const overviewMock = vi.fn();
const enrollmentMock = vi.fn();
const attendanceTrendMock = vi.fn();
const feeTrendMock = vi.fn();
const examPerformanceMock = vi.fn();

vi.mock("@/lib/resources/analytics", () => ({
  analyticsApi: {
    overview: (...args: unknown[]) => overviewMock(...args),
    enrollmentByClass: (...args: unknown[]) => enrollmentMock(...args),
    attendanceTrend: (...args: unknown[]) => attendanceTrendMock(...args),
    feeCollectionTrend: (...args: unknown[]) => feeTrendMock(...args),
    examPerformance: (...args: unknown[]) => examPerformanceMock(...args),
  },
}));

describe("AnalyticsPage", () => {
  beforeEach(() => {
    overviewMock.mockReset();
    enrollmentMock.mockReset();
    attendanceTrendMock.mockReset();
    feeTrendMock.mockReset();
    examPerformanceMock.mockReset();
  });

  it("renders KPI cards and chart data once loaded", async () => {
    overviewMock.mockResolvedValue({
      activeStudents: 120,
      totalStaff: 15,
      attendanceRateLast30Days: 92.5,
      feeCollectionRateActiveYear: 78,
      activeAcademicYear: "2025-2026",
      latestExam: { name: "Mid Term", averagePercentage: 71.4 },
    });
    enrollmentMock.mockResolvedValue([
      { classId: "c1", className: "Class 1", order: 1, count: 30 },
      { classId: "c2", className: "Class 2", order: 2, count: 25 },
    ]);
    attendanceTrendMock.mockResolvedValue([
      { month: "2026-03", label: "Mar 2026", totalMarked: 0, presentCount: 0, attendanceRate: null },
      { month: "2026-04", label: "Apr 2026", totalMarked: 100, presentCount: 92, attendanceRate: 92 },
    ]);
    feeTrendMock.mockResolvedValue([
      { month: "2026-03", label: "Mar 2026", billed: 0, collected: 0, collectionRate: null },
      { month: "2026-04", label: "Apr 2026", billed: 50000, collected: 39000, collectionRate: 78 },
    ]);
    examPerformanceMock.mockResolvedValue([
      { examId: "e1", examName: "Mid Term", academicYear: "2025-2026", marksRecorded: 30, averagePercentage: 71.4 },
    ]);

    render(<AnalyticsPage />);

    expect(await screen.findByText("120")).toBeInTheDocument(); // active students
    expect(screen.getByText("15")).toBeInTheDocument(); // staff
    expect(screen.getByText("92.5%")).toBeInTheDocument(); // attendance rate
    expect(screen.getByText("78%")).toBeInTheDocument(); // fee collection rate
    // "71.4%" appears both in the KPI card and the exam-performance bar chart.
    expect(screen.getAllByText("71.4%").length).toBeGreaterThanOrEqual(1);

    await waitFor(() => expect(screen.getByText("Class 1")).toBeInTheDocument());
    expect(screen.getByText("Class 2")).toBeInTheDocument();
    // "Mid Term" appears both in the KPI card sublabel and the exam chart.
    expect(screen.getAllByText("Mid Term").length).toBeGreaterThanOrEqual(1);
  });

  it("shows an empty state for a chart with no usable data", async () => {
    overviewMock.mockResolvedValue({
      activeStudents: 0,
      totalStaff: 1,
      attendanceRateLast30Days: null,
      feeCollectionRateActiveYear: null,
      activeAcademicYear: null,
      latestExam: null,
    });
    enrollmentMock.mockResolvedValue([]);
    attendanceTrendMock.mockResolvedValue([
      { month: "2026-04", label: "Apr 2026", totalMarked: 0, presentCount: 0, attendanceRate: null },
    ]);
    feeTrendMock.mockResolvedValue([
      { month: "2026-04", label: "Apr 2026", billed: 0, collected: 0, collectionRate: null },
    ]);
    examPerformanceMock.mockResolvedValue([]);

    render(<AnalyticsPage />);

    expect(await screen.findByText("No active, enrolled students yet.")).toBeInTheDocument();
    expect(screen.getByText("No attendance has been marked in the last 6 months.")).toBeInTheDocument();
    expect(screen.getByText("No invoices have been billed in the last 6 months.")).toBeInTheDocument();
    expect(screen.getByText("No graded exams yet.")).toBeInTheDocument();
  });
});
