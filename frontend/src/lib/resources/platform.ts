import { api } from "@/lib/api";
import type { Paginated } from "./types";
import type { TenantPlan } from "@/lib/auth/types";

export type TenantStatus = "TRIAL" | "ACTIVE" | "SUSPENDED" | "CANCELLED";

export interface PlatformTenantListItem {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  plan: TenantPlan;
  contactEmail: string;
  city: string | null;
  createdAt: string;
}

export interface PlanDefinition {
  code: TenantPlan;
  name: string;
  priceMonthlyPKR: number;
  maxStudents: number | null;
  maxStaff: number | null;
  maxSmsCreditsPerMonth: number | null;
  features: string[];
}

export interface PlatformTenantDetail extends PlatformTenantListItem {
  contactPhone: string | null;
  address: string | null;
  trialEndsAt: string | null;
  usage: {
    userCount: number;
    studentCount: number;
    staffCount: number;
    smsCreditsUsedThisMonth: number;
  };
  planDefinition: PlanDefinition;
  limits: {
    withinStudentLimit: boolean;
    withinStaffLimit: boolean;
    withinSmsLimit: boolean;
  };
}

export interface PlatformStats {
  totalTenants: number;
  byStatus: Record<string, number>;
  byPlan: Record<string, number>;
  newSignups: { last7Days: number; last30Days: number };
  recentSignups: Array<{ id: string; name: string; slug: string; plan: TenantPlan; status: TenantStatus; createdAt: string }>;
}

export const platformApi = {
  listTenants: (params: { page?: number; limit?: number; search?: string; status?: TenantStatus; plan?: TenantPlan }) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== "") as [string, string][],
    ).toString();
    return api.get<Paginated<PlatformTenantListItem>>(`/api/platform/tenants${qs ? `?${qs}` : ""}`);
  },
  getTenant: (id: string) =>
    api.get<{ data: PlatformTenantDetail }>(`/api/platform/tenants/${id}`).then((r) => r.data),
  updateTenantStatus: (id: string, status: TenantStatus, reason?: string) =>
    api.patch<{ data: PlatformTenantDetail }>(`/api/platform/tenants/${id}/status`, { status, reason }).then((r) => r.data),
  updateTenantPlan: (id: string, plan: TenantPlan) =>
    api.patch<{ data: PlatformTenantDetail }>(`/api/platform/tenants/${id}/plan`, { plan }).then((r) => r.data),
  listPlans: () => api.get<{ data: PlanDefinition[] }>("/api/platform/plans").then((r) => r.data),
  stats: () => api.get<{ data: PlatformStats }>("/api/platform/stats").then((r) => r.data),
};
