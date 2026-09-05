import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  APP_URL: z.string().url().default('http://localhost:4000'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  // 2h rather than a very short-lived token — reduces how often the
  // frontend needs to hit POST /api/auth/refresh at all (see
  // refreshRateLimiter's comment in middleware/rateLimiter.ts for the
  // real-world problem a too-short TTL caused: frequent forced re-logins
  // under normal school-hours load).
  JWT_ACCESS_TTL: z.string().default('2h'),
  JWT_REFRESH_TTL: z.string().default('30d'),
  BCRYPT_SALT_ROUNDS: z.coerce.number().min(10).max(15).default(12),

  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  // Bare domain (no protocol) that every school's subdomain lives under,
  // e.g. "yourschoolsaas.com" in production or "localhost:3000" for local
  // dev. When set, any origin matching <slug>.<this value> is allowed in
  // addition to the exact-match CORS_ORIGIN allowlist — see
  // src/utils/subdomain.ts's isSubdomainOfOrigin(). Optional because a
  // deployment that hasn't turned on subdomain-per-school yet has no use
  // for it.
  CORS_WILDCARD_DOMAIN: z.string().optional(),

  // Bare domain (no protocol, no port) to set as the refresh-token cookie's
  // Domain attribute, e.g. "yourschoolsaas.com" in production or
  // "localhost" for local dev. Without this, the cookie defaults to a
  // host-only cookie scoped to whatever host issued it (the API's own
  // host) — which the browser will NOT send back to a different host, even
  // a same-parent one. That's invisible in a single-origin deployment, but
  // this app's real topology puts the API on its own host
  // (api.yourschoolsaas.com) separate from each school's app host
  // (<slug>.yourschoolsaas.com); without a shared cookie Domain the
  // frontend's middleware can never see the session cookie the API set,
  // and users get bounced straight back to /login after a successful
  // login. Set to the shared parent domain to fix this. Optional because a
  // same-host dev setup (or a deployment that hasn't turned on
  // subdomain-per-school) doesn't need it.
  // Empty string treated as unset: dotenv's fallback `.env` load (see
  // below) only fills in keys .env.test doesn't already set, so an env
  // file that wants to explicitly disable this (rather than merely omit
  // it) needs `COOKIE_DOMAIN=` to actually take effect over a same-named
  // value already present in a less-specific env file.
  COOKIE_DOMAIN: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined)),

  // Forces the refresh-token cookie to SameSite=None (+ Secure) even when
  // COOKIE_DOMAIN is unset. COOKIE_DOMAIN's own "shared Domain" trick only
  // works when the frontend and API sit on the same registrable domain
  // (e.g. api.yourschoolsaas.com + <slug>.yourschoolsaas.com) — a browser
  // will reject a Domain attribute that isn't the setting host's own
  // domain or a parent of it, so it CANNOT be used to share a cookie
  // between two unrelated domains (e.g. a Vercel-hosted frontend and a
  // Render-hosted API, as in this project's own free-tier demo
  // deployment). That split-domain topology still needs SameSite=None for
  // the browser to send the cookie back cross-site on POST
  // /api/auth/refresh (credentials: "include") at all — hence this
  // separate, independent knob. Does not set a Domain attribute itself
  // (stays a host-only cookie on the API's own host), so it's safe to
  // enable regardless of whether COOKIE_DOMAIN is also set. Optional
  // because same-origin dev and same-registrable-domain production
  // deployments don't need it.
  COOKIE_SAMESITE_NONE: z
    .string()
    .optional()
    .transform((v) => v === 'true'),

  // Local filesystem directory for generated artifacts that outlive a
  // single request (bulk report-card zip files). A single-VPS pm2
  // deployment (see docs/DEPLOYMENT.md) has one persistent disk, so this
  // is deliberately "just a directory" rather than S3/object storage —
  // revisit if this ever needs to run multi-instance.
  STORAGE_DIR: z.string().default('./storage'),

  // --- Outbound notification providers (all optional) ---
  // Every one of these is entirely optional. When a channel's full
  // credential set isn't present, that channel silently falls back to
  // LocalNotificationProvider (logs the message, no real send) — see
  // notifications/providers/registry.ts. This lets dev/test run with zero
  // configuration while production can go live per-channel independently
  // (e.g. wire up SMS now, WhatsApp later) just by setting env vars, no
  // code or deploy changes.
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  // Twilio's own SMS-sending number, E.164 format, e.g. "+15551234567".
  TWILIO_SMS_FROM: z.string().optional(),

  // Meta WhatsApp Business Cloud API (Graph API) — from the WhatsApp app
  // in Meta's developer console, NOT a Twilio credential even though this
  // app also supports Twilio for SMS.
  WHATSAPP_CLOUD_API_TOKEN: z.string().optional(),
  WHATSAPP_CLOUD_PHONE_NUMBER_ID: z.string().optional(),

  // Plain SMTP — works with SendGrid/Mailgun/SES SMTP relay, a school's
  // own Google Workspace/Microsoft 365 account, or any mail server.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  // "true" for implicit TLS (port 465), unset/"false" for STARTTLS (587).
  SMTP_SECURE: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  // Envelope From header, e.g. "Your School <noreply@yourschool.com>".
  SMTP_FROM: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Fail fast and loud — production-grade services must never boot with a
  // half-valid configuration.
  console.error('❌ Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  throw new Error('Invalid environment configuration');
}

export const env = parsed.data;
