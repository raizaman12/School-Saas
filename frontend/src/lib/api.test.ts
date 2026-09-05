import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Covers the tab-scoped refresh-token fix: without it, every browser tab
 * on this site shares one httpOnly cookie, so signing into a second
 * account in a different tab silently takes over every other open tab's
 * session the next time it refreshes. See api.ts's sessionStorage section
 * and auth.controller.ts's refreshHandler doc comment for the full
 * explanation — this file verifies the frontend half of that fix: this
 * tab's own sessionStorage-held token is what gets sent, not just
 * whatever the shared cookie currently holds.
 */
describe("refreshAccessToken — tab-scoped session isolation", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("sends this tab's own stored refresh token in the request body when it has one", async () => {
    const { setStoredRefreshToken, refreshAccessToken, getAccessToken } = await import("./api");
    setStoredRefreshToken("teacher-tabs-own-refresh-token");

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ accessToken: "new-access-token", refreshToken: "rotated-teacher-token" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const ok = await refreshAccessToken();

    expect(ok).toBe(true);
    expect(getAccessToken()).toBe("new-access-token");
    const [, requestInit] = fetchMock.mock.calls[0];
    const sentBody = JSON.parse(requestInit.body as string);
    expect(sentBody.refreshToken).toBe("teacher-tabs-own-refresh-token");
  });

  it("falls back to the shared cookie (no refreshToken in the body) when this tab has never captured its own token", async () => {
    const { refreshAccessToken } = await import("./api");
    // sessionStorage is empty — a genuinely fresh tab continuing an
    // existing single-account session via the httpOnly cookie alone.

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ accessToken: "new-access-token", refreshToken: "cookie-holders-token" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await refreshAccessToken();

    const [, requestInit] = fetchMock.mock.calls[0];
    const sentBody = JSON.parse(requestInit.body as string);
    expect(sentBody.refreshToken).toBeUndefined();
    expect(requestInit.credentials).toBe("include"); // still relies on the cookie being sent automatically
  });

  it("captures the server's returned refreshToken into this tab's own sessionStorage after a successful refresh", async () => {
    const { refreshAccessToken, getStoredRefreshToken } = await import("./api");

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ accessToken: "new-access-token", refreshToken: "freshly-pinned-token" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await refreshAccessToken();

    // From this point on, even if another tab signs into a different
    // account (overwriting the shared cookie), this tab keeps resolving
    // to this same login because it now has its own captured token.
    expect(getStoredRefreshToken()).toBe("freshly-pinned-token");
  });

  it("keeps a previously-captured token in place (does not clear it) when a refresh attempt fails", async () => {
    const { setStoredRefreshToken, refreshAccessToken, getStoredRefreshToken } = await import("./api");
    setStoredRefreshToken("still-here-token");

    const fetchMock = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal("fetch", fetchMock);

    const ok = await refreshAccessToken();

    expect(ok).toBe(false);
    expect(getStoredRefreshToken()).toBe("still-here-token");
  });

  it("clears this tab's stored token when told to (logout)", async () => {
    const { setStoredRefreshToken, getStoredRefreshToken } = await import("./api");
    setStoredRefreshToken("about-to-log-out");
    expect(getStoredRefreshToken()).toBe("about-to-log-out");

    setStoredRefreshToken(null);

    expect(getStoredRefreshToken()).toBeNull();
  });
});
