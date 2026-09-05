/**
 * Mirrors frontend/src/lib/subdomain.ts's extraction logic (kept as a
 * small standalone duplicate rather than a shared package, since it's a
 * handful of lines on each side) — used here to widen CORS to accept any
 * school subdomain (<slug>.<CORS_WILDCARD_DOMAIN>) rather than only the
 * single fixed origin CORS_ORIGIN supports. Browsers treat
 * "alpha-school.yourschoolsaas.com" and "beta-school.yourschoolsaas.com"
 * as different origins even though they're the same app, so a static
 * origin allowlist can't express "every school's subdomain" — this can.
 */
export function isSubdomainOfOrigin(originHeader: string, wildcardDomain: string): boolean {
  let host: string;
  try {
    host = new URL(originHeader).host;
  } catch {
    return false;
  }

  const normalizedHost = host.toLowerCase();
  const normalizedDomain = wildcardDomain.toLowerCase().trim();
  if (!normalizedDomain) return false;

  if (!normalizedHost.endsWith(`.${normalizedDomain}`)) return false;
  const subdomain = normalizedHost.slice(0, -(normalizedDomain.length + 1));
  return subdomain.length > 0 && !subdomain.includes('.');
}
