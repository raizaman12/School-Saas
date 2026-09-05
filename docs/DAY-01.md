# Day 1 — Multi-tenant DB schema + Auth (done)

## What was built

**Backend** — Node.js + Express 5 + TypeScript + Prisma + PostgreSQL.

- `prisma/schema.prisma` — `Tenant` (school), `User` (with `UserRole`:
  SUPER_ADMIN / SCHOOL_ADMIN / TEACHER / ACCOUNTANT / FRONT_DESK / PARENT /
  STUDENT), `RefreshToken`, `AuditLog`.
- **Multi-tenancy**: shared database, `tenantId` on every tenant-scoped
  table, enforced two ways:
  1. Application code always scopes queries by tenant.
  2. **Postgres Row-Level Security** as defense-in-depth — even a buggy or
     compromised query cannot read another tenant's rows. Verified with an
     automated test that queries the database directly with raw SQL,
     bypassing the app entirely, and confirms isolation still holds.
- Two DB roles: `school_saas_owner` (BYPASSRLS, used only for migrations)
  and `school_saas_app` (RLS-enforced, used by the running API).
- **Auth**: signup (creates a tenant + its first SCHOOL_ADMIN), login,
  refresh, logout, `/me`. JWT access tokens (15 min) + rotating refresh
  tokens (30 days, httpOnly cookie). Passwords hashed with bcrypt.
  Refresh-token **reuse detection**: if an already-rotated token is
  presented again (a theft signal), the entire session is killed and the
  user must log in again.
- RBAC middleware (`requireAuth`, `requireRole(...)`) ready for the next
  modules to use.
- Production-grade basics: structured logging (winston), global error
  handler (never leaks internals), Zod input validation, rate limiting
  (tight on auth endpoints), helmet, CORS locked to configured origin,
  audit log on signup/login, graceful shutdown.
- **Tests**: 16 Jest + Supertest integration tests, all passing — signup,
  login, weak-password rejection, duplicate-slug rejection, wrong
  password, missing/invalid token, refresh rotation, logout, reuse
  detection, and multi-tenant isolation (including the raw-SQL check).

## Trade-offs made for the Day-1 timeline (flagging per your standards doc)

- No email verification or password-reset flow yet — signup activates the
  admin account immediately. Fine for pilot use; should add before selling
  broadly.
- No per-account lockout after N failed logins yet (IP-based rate limiting
  only). Cheap to add later.
- CSRF protection for the refresh cookie relies on `SameSite=Lax` +
  `httpOnly` rather than a dedicated CSRF token. Reasonable for now since
  the access token (used for all real data access) is header-based and
  immune to CSRF; can harden later if needed.
- No request-tracing/correlation IDs yet — will add once there are
  cross-service calls worth tracing.

## How to run it yourself

See `SETUP.md` in the repo root.
