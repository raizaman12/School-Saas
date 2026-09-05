import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

function requestFor(path: string, { withRefreshCookie = false }: { withRefreshCookie?: boolean } = {}) {
  const req = new NextRequest(new URL(path, "http://localhost:3000"));
  if (withRefreshCookie) req.cookies.set("refreshToken", "fake-token-value");
  return req;
}

describe("proxy", () => {
  it("redirects a guest away from a /dashboard path to /login, preserving the intended path", () => {
    const res = proxy(requestFor("/dashboard/students"));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/dashboard/students");
  });

  it("redirects a guest away from a /portal path to /login too", () => {
    const res = proxy(requestFor("/portal/profile"));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
  });

  it("lets an authenticated visitor through to /dashboard", () => {
    const res = proxy(requestFor("/dashboard", { withRefreshCookie: true }));
    expect(res.headers.get("location")).toBeNull();
  });

  // Regression coverage: an earlier version of this proxy silently bounced
  // an already-authenticated visitor away from /login and /signup straight
  // to /dashboard. That looked like harmless "you're already signed in"
  // convenience, but it actually made it impossible to register a second
  // school, or log in to a different one, without an explicit logout
  // first — a school admin trying either just got silently re-landed on
  // their FIRST school's dashboard, which reads exactly like "the wrong
  // school's data is showing" even though nothing ever leaked server-side.
  it("does NOT redirect an authenticated visitor away from /signup — registering another school must stay reachable", () => {
    const res = proxy(requestFor("/signup", { withRefreshCookie: true }));
    expect(res.headers.get("location")).toBeNull();
  });

  it("does NOT redirect an authenticated visitor away from /login — switching accounts must stay reachable", () => {
    const res = proxy(requestFor("/login", { withRefreshCookie: true }));
    expect(res.headers.get("location")).toBeNull();
  });

  it("also lets a logged-out guest reach /login and /signup normally", () => {
    expect(proxy(requestFor("/login")).headers.get("location")).toBeNull();
    expect(proxy(requestFor("/signup")).headers.get("location")).toBeNull();
  });
});
