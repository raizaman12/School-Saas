import { api } from "@/lib/api";

/**
 * Staff-only portal-login administration (mounted server-side at
 * /api/portal/admin — see backend modules/portal/index.ts) — separate
 * from lib/resources/portal.ts, which covers the PARENT/STUDENT-facing
 * read routes at /api/portal.
 */
export const portalAdminApi = {
  /**
   * Resets any portal-login user's password to a fresh one-time temp
   * password (works for a student, guardian/parent, or staff member — the
   * password lives on the shared User model regardless of role). Emails
   * the new credentials and returns the temp password once, for display
   * to the admin doing the reset.
   */
  resetPassword: (userId: string) =>
    api
      .post<{ data: { userId: string; email: string }; tempPassword: string }>(
        `/api/portal/admin/users/${userId}/reset-password`,
      ),
};
