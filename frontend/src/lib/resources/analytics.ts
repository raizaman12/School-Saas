import { api } from "@/lib/api";

export interface AnalyticsOverview {
  activeStudents: number;
  totalStaff: number;
  attendanceRateLast30Days: number | null;
  feeCollectionRateActiveYear: number | null;
  activeAcademicYear: string | null;
  latestExam: { name: string; averagePercentage: number | null } | null;
}

export interface EnrollmentByClassRow {
  classId: string;
  className: string;
  order: number;
  count: number;
}

export interface AttendanceTrendPoint {
  month: string;
  label: string;
  totalMarked: number;
  presentCount: number;
  attendanceRate: number | null;
}

export interface FeeCollectionTrendPoint {
  month: string;
  label: string;
  billed: number;
  collected: number;
  collectionRate: number | null;
}

export interface ExamPerformancePoint {
  examId: string;
  examName: string;
  academicYear: string;
  marksRecorded: number;
  averagePercentage: number | null;
}

export const analyticsApi = {
  overview: () => api.get<{ data: AnalyticsOverview }>("/api/analytics/overview").then((r) => r.data),
  enrollmentByClass: () =>
    api.get<{ data: EnrollmentByClassRow[] }>("/api/analytics/enrollment-by-class").then((r) => r.data),
  attendanceTrend: (months = 6) =>
    api
      .get<{ data: AttendanceTrendPoint[] }>(`/api/analytics/attendance-trend?months=${months}`)
      .then((r) => r.data),
  feeCollectionTrend: (months = 6) =>
    api
      .get<{ data: FeeCollectionTrendPoint[] }>(`/api/analytics/fee-collection-trend?months=${months}`)
      .then((r) => r.data),
  examPerformance: (limit = 6) =>
    api.get<{ data: ExamPerformancePoint[] }>(`/api/analytics/exam-performance?limit=${limit}`).then((r) => r.data),
};
