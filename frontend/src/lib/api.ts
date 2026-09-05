const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.status = status;
    this.code = body.code;
    this.details = body.details;
  }
}

let accessToken: string | null = null;

/** Kept in memory only (never localStorage) — see AuthProvider for why. */
export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

// --- Tab-scoped refresh token -------------------------------------------
//
// The refresh token also lives in an httpOnly cookie (set by the backend —
// see auth.controller.ts's setRefreshCookie), which is what makes "close
// the tab, come back tomorrow, still logged in" work at all. But a cookie
// is shared by *every* tab open on this site in this browser, not scoped
// to one tab — so if tab A is signed in as a teacher and tab B (a
// different, separate tab) then signs in as a student, the cookie now
// holds only the student's token. Tab A never logged out; it just silently
// starts resolving as the student too the next time it revalidates its
// session (e.g. on refresh, or when its access token expires) — because
// all it had to go on was that one shared cookie value.
//
// sessionStorage, unlike a cookie, genuinely belongs to just one tab (a
// brand-new tab starts with empty sessionStorage; it's only copied when a
// tab is explicitly duplicated/restored). Stashing this specific login's
// refresh token here on login, and always preferring it over the shared
// cookie on every subsequent refresh, pins each tab to the account that
// was actually signed into *in that tab* — the shared cookie remains only
// as a fallback for a tab that hasn't captured its own token yet (a
// genuinely fresh tab continuing an existing single-account session, the
// overwhelmingly common case), so a browser with only one account signed
// in anywhere behaves exactly as before.
const REFRESH_TOKEN_STORAGE_KEY = "school_saas_tab_refresh_token";

// --- Session-hint cookie (for proxy.ts's middleware only) ---------------
//
// The backend's own refresh-token cookie is httpOnly and scoped to the
// API's host. That's invisible to requests made to the FRONTEND's host
// whenever the two are on different domains — true even with
// COOKIE_DOMAIN set (that only shares a cookie between hosts on the same
// registrable domain, e.g. api.yourschoolsaas.com + <slug>.yourschoolsaas.com)
// and unavoidably true when they're on two entirely unrelated domains,
// e.g. this project's own free-tier demo (a Vercel frontend + a Render
// API) — a browser will only accept a Domain attribute that is the
// setting host's own domain or a parent of it, so there is no Domain
// value that could ever make the API's cookie visible on the frontend's
// host in that topology. proxy.ts's middleware runs server-side against
// whatever the frontend's own host received, so it can never see a cookie
// scoped to a different host no matter how the backend configures it.
//
// This cookie sidesteps that entirely by being set on the frontend's OWN
// domain, by the frontend's own client-side code, right alongside every
// place this file already tracks "is there a session" (see
// setStoredRefreshToken below). It carries no token and isn't httpOnly —
// its only job is a presence check so the middleware can gate /dashboard
// and /portal without a flash of protected UI; the real authorization
// boundary stays the API's own bearer-token check on every request, same
// as before. Safe (and correct) to keep setting even in a same-domain or
// shared-parent-domain deployment — it's simply redundant with the
// backend cookie there, not in conflict with it.
const SESSION_HINT_COOKIE = "school_saas_has_session";

function setSessionHintCookie(present: boolean) {
  if (typeof document === "undefined") return;
  try {
    document.cookie = present
      ? `${SESSION_HINT_COOKIE}=1; path=/; max-age=2592000; samesite=lax`
      : `${SESSION_HINT_COOKIE}=; path=/; max-age=0`;
  } catch {
    // Same private-browsing/storage-blocked fallback as sessionStorage
    // below — worst case, the middleware treats this tab as logged out
    // and the client-side session (accessToken in memory) still works.
  }
}

function setStoredRefreshToken(token: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (token) sessionStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, token);
    else sessionStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
  } catch {
    // Private-browsing/storage-blocked contexts can throw on access — this
    // tab just falls back to the shared cookie in that case, same as
    // before this feature existed.
  }
  setSessionHintCookie(Boolean(token));
}

function getStoredRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return sessionStorage.getItem(REFRESH_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export { setStoredRefreshToken, getStoredRefreshToken };

interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  /** Skip the automatic refresh-and-retry on a 401 (used by the refresh call itself). */
  skipAuthRetry?: boolean;
}

let refreshInFlight: Promise<boolean> | null = null;

/**
 * The tenant slug this page currently represents, e.g. "alpha-school" for
 * a request arriving on alpha-school.<appDomain>, or null on the bare
 * domain / a non-subdomain deployment. Read lazily (not at module load) so
 * this still works correctly under SSR/tests where `window` isn't
 * available at import time.
 */
function currentSlug(): string | null {
  if (typeof window === "undefined") return null;
  const appDomain = process.env.NEXT_PUBLIC_APP_DOMAIN;
  if (!appDomain) return null;
  // Inlined rather than imported from lib/subdomain to avoid a circular
  // import (subdomain.ts has no reason to depend on api.ts, but api.ts is
  // foundational enough that keeping this one-way is worth the few lines).
  const host = window.location.host.toLowerCase().trim();
  const domain = appDomain.toLowerCase().trim();
  if (host === domain || !host.endsWith(`.${domain}`)) return null;
  const subdomain = host.slice(0, -(domain.length + 1));
  const reserved = new Set(["www", "app", "api", "admin", "portal", "dashboard"]);
  if (!subdomain || subdomain.includes(".") || reserved.has(subdomain)) return null;
  return subdomain;
}

/**
 * Attempts to mint a new access token — from this tab's own sessionStorage
 * refresh token if it has one, otherwise falling back to the shared
 * httpOnly refresh cookie (see the sessionStorage section above for why
 * both exist). Coalesced so concurrent 401s from several in-flight
 * requests trigger a single refresh call instead of a stampede.
 *
 * Sends `expectedSlug` (the school this page is currently showing) so the
 * backend can refuse to restore a DIFFERENT school's session — the
 * refresh cookie's Domain is deliberately shared across every school's
 * subdomain (needed for the API host to see it at all), so without this
 * check a stale cookie from a previously-visited school could silently
 * authenticate this page as that other school. See auth.validation.ts's
 * refreshSchema for the full explanation.
 */
async function refreshAccessToken(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const expectedSlug = currentSlug();
        const tabRefreshToken = getStoredRefreshToken();
        const res = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(expectedSlug ? { expectedSlug } : {}),
            ...(tabRefreshToken ? { refreshToken: tabRefreshToken } : {}),
          }),
        });
        if (!res.ok) return false;
        const data = await res.json();
        setAccessToken(data.accessToken);
        // Capture (or re-pin) this tab's own refresh token going forward —
        // including the very first time, when this tab had none yet and
        // fell back to the shared cookie (see the sessionStorage section
        // above): from this point on, this tab keeps resolving to this
        // same login even if another tab signs into a different account.
        if (data.refreshToken) setStoredRefreshToken(data.refreshToken);
        return true;
      } catch {
        return false;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, skipAuthRetry, headers, ...rest } = options;

  const doFetch = async () =>
    fetch(`${API_BASE_URL}${path}`, {
      ...rest,
      credentials: "include",
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

  let res = await doFetch();

  if (res.status === 401 && !skipAuthRetry) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      res = await doFetch();
    }
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const contentType = res.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");
  const payload = isJson ? await res.json() : undefined;

  if (!res.ok) {
    throw new ApiError(res.status, payload?.error ?? { code: "UNKNOWN_ERROR", message: res.statusText });
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => apiFetch<T>(path, { ...options, method: "GET" }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiFetch<T>(path, { ...options, method: "POST", body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiFetch<T>(path, { ...options, method: "PATCH", body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiFetch<T>(path, { ...options, method: "PUT", body }),
  delete: <T>(path: string, options?: RequestOptions) => apiFetch<T>(path, { ...options, method: "DELETE" }),
};

/**
 * Fetches a binary (PDF/zip) response with the same auth headers + 401
 * refresh-and-retry semantics as apiFetch, then triggers a browser
 * download. apiFetch itself can't be reused for this — it always parses
 * non-JSON responses as `undefined`, which would silently discard the
 * file bytes — so this duplicates just the auth-header/retry logic.
 */
export async function downloadFile(path: string, fallbackFilename: string): Promise<void> {
  const doFetch = async () =>
    fetch(`${API_BASE_URL}${path}`, {
      credentials: "include",
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    });

  let res = await doFetch();
  if (res.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) res = await doFetch();
  }

  if (!res.ok) {
    let body: ApiErrorBody | undefined;
    try {
      body = await res.json();
    } catch {
      // Non-JSON error body (e.g. a raw 500 page) — fall through to the default message.
    }
    throw new ApiError(res.status, body ?? { code: "UNKNOWN_ERROR", message: res.statusText });
  }

  const disposition = res.headers.get("content-disposition") ?? "";
  const filenameMatch = disposition.match(/filename="?([^"]+)"?/);
  const filename = filenameMatch?.[1] ?? fallbackFilename;

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Uploads a file as multipart/form-data with the same auth headers + 401
 * refresh-and-retry semantics as apiFetch. Doesn't reuse apiFetch directly:
 * apiFetch always JSON.stringifies its body and sets
 * Content-Type: application/json, which is wrong for a FormData body — the
 * browser needs to set its own multipart boundary in the Content-Type
 * header, which it only does when no Content-Type is set explicitly here.
 */
export async function uploadFile<T>(path: string, formData: FormData): Promise<T> {
  const doFetch = async () =>
    fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      credentials: "include",
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      body: formData,
    });

  let res = await doFetch();
  if (res.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) res = await doFetch();
  }

  const contentType = res.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");
  const payload = isJson ? await res.json() : undefined;

  if (!res.ok) {
    throw new ApiError(res.status, payload?.error ?? { code: "UNKNOWN_ERROR", message: res.statusText });
  }

  return payload as T;
}

export { refreshAccessToken };
