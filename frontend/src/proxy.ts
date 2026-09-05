import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * First line of defense only — checks for the *presence* of the httpOnly
 * refresh cookie (readable server-side even though client JS can't touch
 * it) to bounce obviously-logged-out visitors away from the dashboard
 * before any page code runs. The real authorization boundary is the API:
 * every request still carries a bearer access token that the backend
 * verifies and RBAC-checks independently, so this middleware only ever
 * improves UX (fewer flashes of protected UI) — it is never the sole
 * guard.
 *
 * IMPORTANT: /login and /signup are deliberately NOT guest-only-gated
 * here. An earlier version silently redirected an already-authenticated
 * visitor away from both straight to /dashboard — which sounds like a
 * harmless convenience, but it actively breaks two very normal flows for
 * a multi-tenant app like this one: (1) a school admin who wants to
 * register a SECOND school while still signed in to the first just gets
 * bounced back into the first school's dashboard, unable to ever reach
 * the signup form without an explicit logout first; (2) trying to log in
 * to a different school's account (e.g. from that school's own
 * `<slug>.<domain>/login` link, shared by COOKIE_DOMAIN across
 * subdomains in local/dev — see backend/.env's COOKIE_DOMAIN) silently
 * re-lands you in the FIRST school's dashboard instead of letting you
 * authenticate as the second. Both looked, from the outside, exactly
 * like "another school's data is showing in this school's admin panel"
 * — the user never actually switched tenants, because they were never
 * allowed to. Both pages already replace the session correctly on a
 * successful login/signup (see AuthProvider), so there is nothing unsafe
 * about letting an authenticated visitor reach either page and switch.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = request.cookies.has("refreshToken");

  const isDashboardPath = pathname.startsWith("/dashboard") || pathname.startsWith("/portal");

  if (isDashboardPath && !hasSession) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Subdomain-per-school detection (<slug>.<appDomain> -> auto-fill the
  // login form) deliberately does NOT happen here. An earlier version
  // used NextResponse.rewrite() to inject a ?slug= search param, but
  // /login is statically prerendered, and a rewritten search param on a
  // static page's request is never surfaced to the client's
  // useSearchParams() — verified with a real headless-browser load, not
  // just by reading Next's docs. The login page instead reads
  // window.location.hostname directly on the client (see
  // src/lib/subdomain.ts), which is simpler and actually works.

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/portal/:path*", "/login", "/signup"],
};
