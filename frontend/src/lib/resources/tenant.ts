import { api } from "@/lib/api";
import type { ResolvedSchool } from "@/lib/auth/types";

export interface PublicTenant {
  id: string;
  name: string;
  slug: string;
  status: string;
  themeId: string;
}

export interface ThemePreset {
  id: string;
  label: string;
  primaryHex: string;
}

export const tenantApi = {
  /** Public, unauthenticated — used by the login page to show a school's name when arriving via its subdomain. */
  bySlug: (slug: string) => api.get<{ data: PublicTenant }>(`/api/auth/tenant-by-slug/${slug}`).then((r) => r.data),

  /**
   * Public, unauthenticated — the login page's pre-login lookup. Unlike
   * bySlug above, this also recognizes a multi-branch group's shared login
   * URL and returns its branch list instead of 404ing, so the login page
   * can show a "Choose your branch" picker before the credentials form.
   */
  resolveSchool: (slug: string) =>
    api.get<{ data: ResolvedSchool }>(`/api/auth/resolve-school/${slug}`).then((r) => r.data),

  /** Public, unauthenticated — the full catalog of selectable accent-color themes (signup wizard, settings page). */
  themePresets: () => api.get<{ data: ThemePreset[] }>("/api/tenant/theme-presets").then((r) => r.data),

  /** Self-service — SCHOOL_ADMIN changes their own tenant's theme after signup. */
  updateTheme: (themeId: string) =>
    api.patch<{ data: { id: string; themeId: string } }>("/api/tenant/theme", { themeId }).then((r) => r.data),

  // 0=Sunday .. 6=Saturday. Any staff role can read; only SCHOOL_ADMIN can change.
  getWeeklyOffDays: () =>
    api.get<{ data: { weeklyOffDays: number[] } }>("/api/tenant/weekly-off-days").then((r) => r.data),
  updateWeeklyOffDays: (weeklyOffDays: number[]) =>
    api
      .patch<{ data: { weeklyOffDays: number[] } }>("/api/tenant/weekly-off-days", { weeklyOffDays })
      .then((r) => r.data),
};
