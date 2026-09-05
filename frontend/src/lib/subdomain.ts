/**
 * Subdomain-per-school support: a request to <slug>.<appDomain> should
 * pre-fill/lock the login form's school identifier instead of asking the
 * user to type it. `NEXT_PUBLIC_APP_DOMAIN` names the bare app domain for
 * the current environment (e.g. "localhost:3000" in dev, or
 * "yourschoolsaas.com" in production) so this can tell "a school's
 * subdomain" apart from "the marketing/bare domain" or "an unrelated host".
 *
 * Local dev tip: modern browsers resolve any `*.localhost` hostname to
 * 127.0.0.1 automatically — visiting http://alpha-school.localhost:3000
 * works with zero /etc/hosts changes, so this is testable without any
 * extra setup.
 */

const RESERVED_SUBDOMAINS = new Set(['www', 'app', 'api', 'admin', 'portal', 'dashboard']);

/**
 * Given a request Host header (or `window.location.host`) and the
 * configured app domain, returns the tenant slug if the host is a school
 * subdomain of that app domain, or null if it's the bare app domain, a
 * reserved subdomain, or an unrelated host (e.g. a custom domain — not yet
 * supported, falls back to manual slug entry).
 */
export function extractTenantSlugFromHost(host: string | null | undefined, appDomain: string): string | null {
  if (!host || !appDomain) return null;

  const normalizedHost = host.toLowerCase().trim();
  const normalizedAppDomain = appDomain.toLowerCase().trim();

  if (normalizedHost === normalizedAppDomain) return null; // bare domain — no subdomain
  if (!normalizedHost.endsWith(`.${normalizedAppDomain}`)) return null; // unrelated host

  const subdomain = normalizedHost.slice(0, -(normalizedAppDomain.length + 1));
  // Multi-level subdomains (a.b.appdomain.com) aren't a supported shape here.
  if (!subdomain || subdomain.includes('.') || RESERVED_SUBDOMAINS.has(subdomain)) return null;

  return subdomain;
}

/** Builds the full login URL for a school's subdomain, for display (e.g. "share this link with your school"). */
export function buildTenantLoginUrl(slug: string, appDomain: string, protocol: 'https' | 'http' = 'https'): string {
  return `${protocol}://${slug}.${appDomain}/login`;
}
