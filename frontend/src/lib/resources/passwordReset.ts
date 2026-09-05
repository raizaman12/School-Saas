import { api } from "@/lib/api";

/**
 * Self-service "forgot password" — unauthenticated (no session yet), so
 * these are plain API calls rather than going through AuthProvider like
 * login/changePassword do.
 */
export const passwordResetApi = {
  forgot: (input: { slug: string; email: string }) =>
    api.post<{ message: string; debugToken?: string }>("/api/auth/forgot-password", input),
  reset: (input: { slug: string; token: string; newPassword: string }) =>
    api.post<void>("/api/auth/reset-password", input),
};
