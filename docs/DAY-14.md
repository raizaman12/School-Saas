# Day 14 — Final testing, security review, deployment prep (done)

## What was done

**Final regression testing**
- Full backend suite (113 Jest + Supertest tests) run clean, twice in a
  row, after every change made this pass — no regressions.
- Full frontend suite (16 Vitest tests, 4 new — see below) — clean.
- Backend production build (`tsc -p tsconfig.build.json`) and frontend
  production build (`next build`, 19 routes + not-found + error boundary)
  both verified clean.
- `npm audit` on both packages — 0 vulnerabilities.

**Security review** — see `docs/SECURITY.md` for the full write-up.
Verified live against the running database (not just by reading migration
files) that Row-Level Security is enabled with at least one policy on all
24 tenant-scoped tables, and that the app's runtime DB role has neither
`BYPASSRLS` nor table ownership. Reviewed auth/session handling, CSRF
exposure, injection surface, dependency hygiene, and secret hygiene — all
solid, mostly built in from Day 1 onward.

Three real issues were found and fixed during this pass:
1. `frontend/.gitignore`'s blanket `.env*` rule was also hiding
   `.env.local.example` (the safe template) from git — fixed, now tracked.
2. Backend `npm run lint` had been silently broken this entire project
   (ESLint 10 with no config file) — added `eslint.config.js`, fixed the
   two real findings it immediately surfaced (a harmless dead-store, two
   stale `eslint-disable` comments).
3. A genuine process-hang bug in `src/lib/prisma.ts` (a `beforeExit`
   handler whose own logging kept re-triggering itself indefinitely) —
   invisible to the long-running server and to Jest, but would hang any
   standalone script forever. Found by exercising the new
   `createSuperAdmin` script below; fixed by removing the handler.

**Deployment prep**
- `backend/src/scripts/createSuperAdmin.ts` (`npm run create-super-admin`)
  — there was no way to bootstrap the first platform administrator account
  in a real deployment (no self-service signup for `SUPER_ADMIN`, by
  design). This script validates email/password the same way regular
  signup does, refuses if the account already exists, and needs no
  elevated DB privileges.
- `docs/DEPLOYMENT.md` — a from-scratch production deployment guide for a
  single Ubuntu VPS: server provisioning, DB role setup (production
  passwords, not dev ones), environment variable checklist for both apps,
  build + `prisma migrate deploy` + bootstrap-admin steps, `pm2` process
  management, an nginx + certbot reverse-proxy/TLS config, logging/
  monitoring pointers, a daily backup cron example, an update/redeploy
  workflow, and brief scaling notes for when a single box stops being
  enough.
- `docs/SECURITY.md` — the security review write-up referenced above,
  including a pre-launch checklist and an explicit "deferred, not fixed"
  section (no file uploads yet, no email verification/password reset, no
  dedicated platform-admin login screen in the frontend, single-box
  deployment has no failover) — flagged rather than silently skipped, per
  the project's standing trade-off-disclosure convention from Day 1.

## New tests

- `frontend/src/lib/hooks/useDebouncedValue.test.ts` (4 tests, fake
  timers) — added during Day 13, verified again here as part of the full
  regression pass.

## Trade-offs / known items carried forward (not new, just re-confirmed)

- The exams-report-card-PDF test's known intermittent Jest+VM-modules
  teardown flake (documented since Day 5) did not reproduce in two clean
  runs of the full suite during this pass. Left as-is — a known, harmless,
  self-resolving flake, not a functional bug; not worth destabilizing a
  working suite to chase on the final day.
- Everything under "Explicitly deferred" in `docs/SECURITY.md` is a
  scope decision for the MVP, not an oversight — each is called out with
  the reasoning for deferring it.

## What's next

Per your standing instruction: this closes out all 14 days. Codebase is
fully integrated and tested end-to-end (backend ↔ frontend ↔ live
Postgres, verified with real signup → academic setup → student →
attendance → invoice → payment → parent-portal-login flows during Day 12,
re-verified clean throughout Days 13–14). **No zip has been created** — say
the word whenever you're ready for it.
