"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  api,
  ApiError,
  setAccessToken,
  setStoredRefreshToken,
  getStoredRefreshToken,
  refreshAccessToken,
} from "@/lib/api";
import { applyThemeById } from "@/lib/theme";
import type {
  AuthTenant,
  AuthUser,
  LoginInput,
  PlatformLoginInput,
  SignupInput,
  SignupMultiBranchInput,
  SignupMultiBranchResult,
} from "./types";

interface AuthContextValue {
  user: AuthUser | null;
  tenant: AuthTenant | null;
  /** True only while the initial silent-refresh-on-load check is in flight. */
  isLoading: boolean;
  login: (input: LoginInput) => Promise<AuthUser>;
  /** For platform staff (SUPER_ADMIN) — no school slug, no tenant. */
  platformLogin: (input: PlatformLoginInput) => Promise<AuthUser>;
  signup: (input: SignupInput) => Promise<void>;
  /**
   * Multi-branch school registration — creates a SchoolGroup plus N
   * independent branch tenants, each with its own SCHOOL_ADMIN. Unlike
   * signup() above, this does NOT log anyone in or touch session state:
   * with N independent admins created at once, there's no single "the"
   * account to sign this browser in as. The caller shows each branch's
   * login URL and sends the visitor to /login instead.
   */
  signupMultiBranch: (input: SignupMultiBranchInput) => Promise<SignupMultiBranchResult>;
  logout: () => Promise<void>;
  /**
   * Self-service password change — the login email/ID never changes, only
   * the password. The backend revokes every refresh token (this device and
   * any other) as part of this, so the local session is cleared here too;
   * the caller is expected to redirect to /login afterward.
   */
  changePassword: (input: { currentPassword: string; newPassword: string }) => Promise<void>;
  /**
   * Self-service "edit my own contact info" — any role. Unlike
   * changePassword, this doesn't end the session; the backend returns the
   * updated user, which is applied to local state directly.
   *
   * address/emergencyContact are STUDENT-only (My Profile → About tab) —
   * the backend silently ignores them for every other role, see
   * auth.validation.ts's updateMeSchema doc comment.
   */
  updateProfile: (input: {
    email?: string;
    phone?: string;
    address?: string;
    emergencyContact?: string;
  }) => Promise<AuthUser>;
  /** Updates local session state after the caller has already persisted a new theme via tenantApi.updateTheme — keeps AuthProvider unaware of that API call itself. */
  setTenantTheme: (themeId: string) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [tenant, setTenant] = useState<AuthTenant | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchMe = useCallback(async () => {
    const res = await api.get<{ user: AuthUser; tenant: AuthTenant | null }>("/api/auth/me");
    setUser(res.user);
    setTenant(res.tenant);
  }, []);

  // On first mount, try to silently restore the session from the httpOnly
  // refresh cookie — the access token itself is never persisted client-side.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const refreshed = await refreshAccessToken();
      if (refreshed && !cancelled) {
        try {
          await fetchMe();
        } catch {
          setAccessToken(null);
          setUser(null);
        }
      }
      if (!cancelled) setIsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchMe]);

  const login = useCallback(async (input: LoginInput) => {
    const res = await api.post<{ tenant: AuthTenant; user: AuthUser; accessToken: string; refreshToken: string }>(
      "/api/auth/login",
      input,
    );
    setAccessToken(res.accessToken);
    // Pins THIS tab to this login — see api.ts's sessionStorage section.
    // Without this, logging into a different account in another tab would
    // silently take over this tab's session too the next time it refreshes.
    setStoredRefreshToken(res.refreshToken);
    setUser(res.user);
    setTenant(res.tenant);
    return res.user;
  }, []);

  const platformLogin = useCallback(async (input: PlatformLoginInput) => {
    const res = await api.post<{ user: AuthUser; accessToken: string; refreshToken: string }>(
      "/api/auth/platform-login",
      input,
    );
    setAccessToken(res.accessToken);
    setStoredRefreshToken(res.refreshToken);
    setUser(res.user);
    setTenant(null);
    return res.user;
  }, []);

  const signup = useCallback(async (input: SignupInput) => {
    const res = await api.post<{ tenant: AuthTenant; user: AuthUser; accessToken: string; refreshToken: string }>(
      "/api/auth/signup",
      input,
    );
    setAccessToken(res.accessToken);
    setStoredRefreshToken(res.refreshToken);
    setUser(res.user);
    setTenant(res.tenant);
  }, []);

  const signupMultiBranch = useCallback(async (input: SignupMultiBranchInput) => {
    // No token/session handling — see this function's doc comment above.
    return api.post<SignupMultiBranchResult>("/api/auth/signup-multi-branch", input);
  }, []);

  const logout = useCallback(async () => {
    try {
      // Explicitly send this tab's own refresh token rather than relying
      // on the shared cookie — otherwise logging out of this tab could
      // revoke a DIFFERENT tab's more-recently-signed-in session instead
      // of this one's (see auth.controller.ts's logoutHandler doc comment).
      const refreshToken = getStoredRefreshToken();
      await api.post("/api/auth/logout", refreshToken ? { refreshToken } : undefined);
    } catch {
      // Best-effort — clear local state regardless of network/API failure.
    }
    setAccessToken(null);
    setStoredRefreshToken(null);
    setUser(null);
    setTenant(null);
  }, []);

  const changePassword = useCallback(async (input: { currentPassword: string; newPassword: string }) => {
    await api.post("/api/auth/change-password", input);
    // The server just revoked every refresh token for this user (including
    // this device's) — clear local session state so the app treats this
    // like a logout requiring fresh credentials.
    setAccessToken(null);
    setStoredRefreshToken(null);
    setUser(null);
    setTenant(null);
  }, []);

  const updateProfile = useCallback(
    async (input: { email?: string; phone?: string; address?: string; emergencyContact?: string }) => {
      const res = await api.patch<{ user: AuthUser }>("/api/auth/me", input);
      setUser(res.user);
      return res.user;
    },
    [],
  );

  const setTenantTheme = useCallback((themeId: string) => {
    setTenant((prev) => (prev ? { ...prev, themeId } : prev));
  }, []);

  // Whenever the signed-in tenant (or its theme) changes, re-apply the
  // school's accent color across the whole app — covers login, signup,
  // and any in-session theme change from Settings without each page
  // needing to know about theming itself.
  useEffect(() => {
    applyThemeById(tenant?.themeId);
  }, [tenant?.themeId]);

  const value = useMemo(
    () => ({
      user,
      tenant,
      isLoading,
      login,
      platformLogin,
      signup,
      signupMultiBranch,
      logout,
      changePassword,
      updateProfile,
      setTenantTheme,
    }),
    [
      user,
      tenant,
      isLoading,
      login,
      platformLogin,
      signup,
      signupMultiBranch,
      logout,
      changePassword,
      updateProfile,
      setTenantTheme,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}

export { ApiError };
