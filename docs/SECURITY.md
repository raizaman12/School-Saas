# Security review (Day 14)

A review pass across both apps before packaging, covering the areas that
matter most for a multi-tenant SaaS handling student PII and payment
records. Structured as: what was checked, what's already solid (built in
across Days 1–13, verified here), what was found and fixed this pass, and
what's explicitly deferred with the reasoning why.

## Multi-tenant isolation

- **Row-Level Security is enabled on every tenant-scoped table** — verified
  directly against the live database (not just by reading migration files):

  ```sql
  SELECT c.relname, c.relrowsecurity, count(p.*)
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_policy p ON p.polrelid = c.oid
  WHERE n.nspname = 'public' AND c.relkind = 'r'
  GROUP BY c.relname, c.relrowsecurity;
  ```
  All 24 tenant-scoped tables (`users`, `students`, `invoices`, `payments`,
  `notifications`, etc.) have `relrowsecurity = true` and at least one
  policy. `tenants` (the tenant row itself, not tenant-scoped data) has 4 —
  open SELECT, self-UPDATE, and a platform-context UPDATE for
  `SUPER_ADMIN`. `_prisma_migrations` correctly has none (it's not
  application data).
- **The app's runtime DB role cannot bypass RLS**: `school_saas_app` (used
  by the running API) has no `BYPASSRLS` attribute and does not own any
  table — confirmed via `\du` and `pg_tables.tableowner`. Only
  `school_saas_owner` (migrations only, never used by the running app) and
  the Postgres superuser can bypass RLS.
- **Application-level scoping is defense-in-depth on top of RLS, not the
  only layer**: every tenant-scoped query goes through `runWithTenant()`,
  which sets `app.tenant_id` for the duration of a transaction — RLS
  enforces the boundary even if a future query forgot to filter by
  `tenantId` explicitly. This was the whole point of building RLS in from
  Day 1 rather than relying on application code alone.

## Authentication & session handling

- Passwords: bcrypt, 12 salt rounds (configurable, min 10), strength
  enforced at signup (8+ chars, upper/lower/digit — `passwordSchema` in
  `auth.validation.ts`).
- Login failure paths (wrong tenant slug, wrong email, wrong password) all
  return the same generic "Invalid credentials" — no user-enumeration
  signal. The "wrong email" path runs a dummy `bcrypt.compare()` against a
  fixed hash before failing, so response timing doesn't leak whether the
  account exists either.
- JWT access tokens: 15 minutes, kept in memory only on the frontend
  (never `localStorage`). Refresh tokens: 30 days, rotating, httpOnly +
  `Secure` (production) + `SameSite=Lax` cookie. Reuse of an already-rotated
  refresh token (a theft signal) kills the entire session family, not just
  that token.
- `SameSite=Lax` on the refresh cookie means a cross-site `fetch`/XHR POST
  to `/api/auth/refresh` cannot carry the victim's cookie — the standard
  CSRF vector for cookie-authenticated endpoints is already closed. (A
  cross-site top-level GET navigation would carry a Lax cookie, but that
  endpoint is POST-only and mutates nothing observable to the attacker.)
- Auth endpoints (`/signup`, `/login`, `/platform-login`, `/refresh`) have
  a dedicated tighter rate limit (20 requests / 15 min per IP) on top of
  the global limiter (600 / 15 min), to slow down credential stuffing.
- `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` are validated at boot (Zod, 32
  char minimum) — the app refuses to start with a missing or weak secret
  rather than silently running insecurely.

## Input handling & injection

- All request bodies/queries are Zod-validated before touching the
  database — no unvalidated input reaches Prisma.
- The only raw SQL in the codebase (`$queryRaw`/`$executeRaw`, used for
  atomic human-readable code generation — `studentCode`/`invoiceNumber`/
  `employeeCode` — and for setting the RLS session variable) uses Prisma's
  tagged-template form exclusively, which parameterizes every interpolated
  value. No string concatenation into SQL anywhere in the codebase
  (verified by grepping every `$queryRaw`/`$executeRaw` call site).
- React (frontend) escapes all rendered content by default; the codebase
  has no `dangerouslySetInnerHTML` usage.

## Transport & headers

- `helmet()` applied globally (sensible default security headers).
- CORS locked to a configured origin list (`CORS_ORIGIN`), not a wildcard,
  with `credentials: true` (required for the cookie-based refresh flow).
- Request bodies capped at 1MB (`express.json({ limit: '1mb' })`) — a
  basic backstop against trivially large payloads; there's no file-upload
  endpoint in this codebase (see "Explicitly deferred" below), so this
  mainly protects against oversized JSON bodies.
- Production error responses never include stack traces or internal
  messages (`errorHandler.ts` — full detail is logged server-side only,
  the client gets a generic message). Verified by reading the handler, not
  just trusting the comment.

## Dependency hygiene

- `npm audit` — **0 vulnerabilities** in both `backend/` and `frontend/`
  (checked with and without dev dependencies), as of this review.
- No secrets committed to git: only `.env.example` (backend) and
  `.env.local.example` (frontend) are tracked; `git ls-files | grep env`
  confirms no real `.env`/`.env.local`/`.env.test` file was ever committed.

## Found and fixed this pass

- **`frontend/.gitignore`'s blanket `.env*` pattern was also excluding
  `.env.local.example`** — the template file documenting the frontend's
  one required env var (`NEXT_PUBLIC_API_URL`) was never actually tracked
  in git, so it wouldn't have been in the final delivered project either.
  Not a secret-leak risk (the opposite problem — the safe template was
  being hidden along with the real files) but a real deployment-friction
  bug. Fixed with a `!.env*.example` negation rule; the file is now
  tracked.
- **Backend had no working lint** — `npm run lint` failed outright
  (`eslint src --ext .ts` against ESLint 10 with no `eslint.config.js` —
  the flat-config migration was apparently never done for this package,
  unlike the frontend). This means backend lint had not actually been
  running this entire project, despite being part of the stated
  build-test-fix-report loop. Added `eslint.config.js`
  (typescript-eslint recommended rules) and fixed the two real findings it
  immediately surfaced:
  - A dead-store in `POST /api/students` (`let section = null` whose
    initial value was never read before being overwritten) — harmless but
    real dead code, cleaned up.
  - Three stale `eslint-disable` comments referencing rules that were
    never actually configured for the project.
- **A real, previously-latent process-hang bug**: `src/lib/prisma.ts`
  logged on Node's `beforeExit` event. Logging there is itself I/O, which
  keeps the event loop alive just long enough for `beforeExit` to fire
  again once that write completes — which logs again, forever. The
  long-running server process never hit this (its HTTP listener keeps the
  event loop alive independently) and Jest force-exits its workers, so it
  went unnoticed through 13 days of development. It surfaced immediately
  when a genuinely short-lived script was added
  (`src/scripts/createSuperAdmin.ts`, written as part of this same
  review — see below) — the script did its job correctly but then hung
  for 2 minutes instead of exiting. Removed the handler (it wasn't doing
  any actual cleanup, just logging); confirmed the script now exits
  cleanly with code 0, both compiled and via `ts-node`. Any future
  standalone script (cron jobs, migrations helpers, one-off admin tasks)
  would have hit the same bug — worth calling out as the kind of thing
  that's easy to miss when every prior test of the codebase went through
  either a long-lived server or a test runner that force-exits.
- **No way to create the first platform administrator in a real
  deployment**: `SUPER_ADMIN` accounts have no self-service signup (by
  design — see `docs/DAY-01.md`/platform module comments), and the only
  existing way to create one was a test helper that inserts directly via
  the privileged DB connection. Added
  `backend/src/scripts/createSuperAdmin.ts` (`npm run create-super-admin`)
  — validates email format and password strength with the same rules as
  regular signup, checks for an existing account first, and connects
  through the normal app DB role rather than an elevated one (the `users`
  RLS policy already permits a platform-context insert with `tenantId`
  NULL from a connection that never sets `app.tenant_id`, which is exactly
  what this script is — no special privilege needed).

## Explicitly deferred (flagged, not fixed — MVP scope)

Consistent with the standing instruction to flag trade-offs rather than
silently skip them:

- **No file upload endpoint exists** (`Student.photoUrl` etc. are plain
  URL string fields with no actual upload/storage implementation) — so
  there's no attack surface there yet, but also no feature. Adding one
  later needs its own review pass (file type/size validation, storage
  location, access control on the stored files) before shipping.
- **No email verification or password-reset flow** — flagged already on
  Day 1 as a pre-launch item, still true. Signup activates the admin
  account immediately.
- **No dedicated platform-admin login screen in the frontend** — the
  `POST /api/auth/platform-login` endpoint exists and is tested, but Day
  12's frontend build covered school-staff and portal login only. Anyone
  administering tenants today logs in via direct API calls or a future
  small addition to the login page.
- **Single-box deployment has no automatic failover** — see
  `docs/DEPLOYMENT.md` §11 for what scaling past a pilot would need
  (managed Postgres, multiple app instances, load balancer). Not
  implemented; flagged as the natural next step if/when it's needed.
