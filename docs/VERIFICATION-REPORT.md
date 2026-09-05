# School Management SaaS — Verification & Validation Report

**Method:** Every item below was checked against the actual code at `/root/school-saas` (backend: Express+TypeScript+Prisma+Postgres; frontend: Next.js App Router). Nothing was marked ✅ from a summary or a comment — each item was traced to a specific file/function, and every test claim was actually run (`npm test`) with real pass/fail counts, not assumed. Where no test existed, that is stated explicitly rather than inferred as fine. Full suite was re-run cleanly, twice, on an isolated test database: **backend 130/130 passing, frontend 26/26 passing.**

Legend: ✅ Done · ⚠️ Partial (works but incomplete/gap noted) · ❌ Missing (not implemented)

> **This report was later acted on.** Sections 1-4 below are the **original findings, left unedited** as the historical record. **See [Section 0](#0-remediation-status-post-audit-fixes) immediately below for what was actually fixed afterward, what remains open, and current test counts (backend 231/231, frontend 32/32).** If you only read one section, read that one — the rest of this document describes a state of the codebase that mostly no longer exists.

---

## 0. Remediation status (post-audit fixes)

Following this audit, every ⚠️/❌ item was triaged and worked through a series of scoped phases (each built, tested, and committed independently — see `git log` for the phase-by-phase commits). The guiding instruction was broad: fix what the audit found missing, and use judgment on anything else needed for a complete, production-quality system. What follows is an honest accounting of what changed, organized by the audit section it answers. Nothing here was independently re-audited by a fresh reviewer the way the original findings were (see the honesty note at the end of this section) — treat it as the same author's follow-through, not a second opinion.

### Fixed

**Section 1 — Multi-tenant isolation.** The cross-tenant security-sweep coverage gap is closed: a dedicated 16-test suite (`tests/integration/tenantIsolation.test.ts`) now exercises academics, exams/marks/report-cards, fees/invoices/payments, payroll, and 5 SIS sub-resources against a second tenant's token, confirmed against the actual response codes each handler returns (404 for direct lookups, 400 for cross-tenant enrollment attempts, empty lists for list endpoints) rather than assumed. This was always a regression-detection gap, not a live hole — RLS was independently verified to already protect every one of these tables — so this closes the gap between "protected" and "protected *and* tested."

**Section 2 — Auth & RBAC.** `requireRole`'s default-deny behavior now has an isolated 5-test unit suite (wrong role, unknown/future role string, missing `req.auth`, empty allow-list, happy path). The "no Principal role" item was a product-decision flag, not a bug — resolved earlier as: `FRONT_DESK` stays the 7th role: no separate Principal role was added.

**Section 3 — SIS.** CNIC/B-Form now has real format validation (Pakistan's `XXXXX-XXXXXXX-X` pattern). A `rollNumber` field exists on `Student`, uniqueness-enforced per section. Class promotion (bulk move-to-next-class, whole-section at a time) and transfer/leaving-certificate PDF generation both now exist end-to-end with tests.

**Section 4 — Attendance.** Future-dated attendance is now rejected (zod `.refine()` against server-side "today", plus a frontend date-input `max`). Genuine re-marks (a status actually changing) now write an `AuditLog` entry with the before/after status; marking a student for the first time, or re-saving the same status, deliberately does not log — keeping the trail meaningful instead of noisy.

**Section 5 — Academics/Exams/Grading.** Grading bands are now per-tenant configurable (`GradingBand` model, replace-whole-scale endpoint, now with a frontend editor) instead of one hardcoded scale for every school. Report cards now show the school's name/logo and an attendance summary for the exam period. Bulk/whole-class report-card generation exists as a real DB-backed background job (fire-and-forget on the existing app server — no queue infra was added, matching the deployment's single-VPS/pm2 model) producing a per-class ZIP, with a frontend that starts the job, polls its status, and downloads the result.

**Section 6 — Fee & Finance.** A 3-copy Pakistani bank-challan-style PDF now exists for invoices. Late fines are calculated (configurable policy) and applied lazily on read/write rather than needing a cron job, with `OVERDUE` now an actually-reachable status. A defaulter list endpoint (filterable by class/section/year) exists.

**Section 7 — HR & Staff, Communication.** `LeaveRequest` is now a real model with a full workflow (self-service file/list/cancel, `SCHOOL_ADMIN` approve/reject with a review note, state-machine guards so only a `PENDING` request can be acted on) — not just the inert `ON_LEAVE` status flag from before. `Notice` is now its own dedicated model (title, body, audience, pinning) instead of being overloaded onto the generic per-recipient `Notification` table — `SCHOOL_ADMIN` can publish school-wide notices, and a section's class teacher can publish section-scoped ones.

**Section 8 — Portal.** `Homework` now exists as a real model with a full teacher-facing workflow (assign per section-subject, ownership-restricted edit/delete). Portal-facing (parent/student) *read* access to homework and notices was scoped for this pass but not built — see Deferred below.

**Section 9 — SaaS Billing.** Plan limits are now actually enforced at the point of creation (`assertCanAddStudent`/`assertCanAddStaff` — a TRIAL-plan school gets a clean 402 `PLAN_LIMIT_EXCEEDED`, not silent overage) rather than only being visible-but-toothless in the Super Admin view. SMS/WhatsApp credits are now a real per-plan monthly quota, derived by counting the month's `Notification` rows (no reset job needed) rather than not existing as a concept. Signup is now a 2-step wizard with a real plan-selection step (previously every signup silently landed on TRIAL). The Super Admin frontend — previously a literal placeholder stub — is now fully built: tenant list/search/filter, tenant detail with usage-vs-limits and suspend/reactivate, plan catalog, and a stats/overview dashboard (new-signup counts, breakdowns by plan/status). New-signup *visibility* for the Super Admin is covered by that overview dashboard; a distinct "pending approval" signup state was not added — self-signup still creates a live tenant immediately, which was a design choice this pass didn't revisit.

**Section 10 — Cross-cutting.** `/health` now actually pings the database instead of returning a hardcoded OK. Route-param IDs are now UUID-validated everywhere, so a malformed ID returns a clean 400 instead of crashing into a raw 500. Every request now carries a correlation ID (`AsyncLocalStorage` + `X-Request-Id` header) through its log lines. The plaintext PII log (raw phone/email on every notification send) is fixed — logs are now masked. The N+1 pattern on the staff-role broadcast path was fixed (reuses already-fetched contact info instead of re-querying per recipient); the bulk-invoice/bulk-attendance/bulk-marks-entry N+1 write patterns were judged acceptable at realistic class sizes and left as-is (see Deferred). Composite `(tenantId, X)` indexes and external-call timeout/retry scaffolding were not addressed this pass (see Deferred).

**Section 11 — Testing.** Backend went from 130 to **231** passing tests; frontend from 26 to **32**. New coverage includes grading-boundary values, plan-limit enforcement, the full tenant-isolation sweep, and the RBAC unit test named above. A long-standing intermittent Jest+Puppeteer teardown flake (noted as "observed once, didn't reproduce" in the original audit) was root-caused, not just remediated-around: `puppeteer-core` 25.x's ESM-only dynamic-import mechanism was leaking across Jest's per-file module sandboxes; pinning to `puppeteer-core@24.43.1` (the last CommonJS release) and switching to a static import removed the failure class entirely, confirmed clean across every full-suite run for the rest of this work (dozens of runs, zero recurrences).

**Section 12 — HCI.** A PDF-download button now exists in the report-card UI (previously: real backend, zero frontend access to it). The `Staff`, `Payroll`, `Notifications`, and `Exams` dashboard pages — found *during this remediation pass* to still be literal placeholder stubs despite their backends being fully built (missed by the original audit because the placeholder text is generated by a shared component, not a per-page literal grep would catch) — are now real, tested UI. A reusable `ConfirmButton` two-step inline-confirmation component now exists and is used for the first real delete affordance in the product (deleting a notice) plus the tenant suspend/reactivate flow it was extracted from. Landing-page/brand jargon ("School SaaS", "Multi-tenant school management...") was replaced with plain copy in every place it appeared (landing page, page title, in-app brand mark, platform-login screen). Touch targets under 44px were fixed for the highest-frequency mobile interactions (nav open/close, per-student attendance status buttons) and for the default button/input/select sizes; dense-table `sm` buttons were bumped partway (32px→36px) but intentionally left below 44px for desktop table density. A named type scale (section/page/auth/brand title tokens) now exists and every heading in the app was migrated onto it, replacing ad hoc `text-lg`/`text-xl`/`text-2xl` guesses.

**Section 13 — Deployment.** Not revisited — the audit's own conclusion (Dockerfile absence is a deliberate non-issue given the documented pm2/VPS path) still stands and needed no action.

### Deferred (a genuine, honest list — not fixed, and not silently dropped)

- Portal (parent/student) read endpoints for homework and notices — the models and staff-facing write side exist; the read side for guardians/students does not yet.
- A distinct "pending approval" signup state for the Super Admin (self-signup still activates a tenant immediately).
- Composite `(tenantId, X)` indexes flagged in Section 10, and the `ORDER BY`-column index gaps flagged in Section 13.
- External-call timeout/retry scaffolding (still moot today — no real SMS/payment gateway is wired in yet, same as at the original audit).
- N+1 write patterns on bulk invoice generation, bulk attendance marking, and bulk marks entry (judged acceptable at realistic Pakistani-school class sizes; would need revisiting if a tenant runs unusually large bulk operations).
- Student-facing admission-form gaps not already listed above: photo upload and guardian linkage still happen as a separate step after student creation, not inline on the form.

### Honesty note on this remediation pass

Unlike the original audit (8 parallel independent agents, each required to quote file:line evidence, synthesized by a reviewer who did not write the fixes), this remediation was carried out by the same agent doing the fixing, self-verifying via the same build/lint/typecheck/test loop used throughout — there was no adversarial second pass checking this work the way the original audit checked the initial build. The test counts (231 backend / 32 frontend) and clean build/lint/typecheck claims above were directly observed from real command output in this session, not summarized from memory. But "I fixed it and my own tests pass" is inherently weaker evidence than an independent audit; if this system is heading to real production use with real schools' data, an independent re-audit of this remediation pass — using the same 8-parallel-agent methodology as the original — would be the responsible next step before launch, exactly as recommended for any first audit's follow-through.

---

## 1. Scorecard

| # | Section | ✅ | ⚠️ | ❌ | Total |
|---|---|---|---|---|---|
| 1 | Multi-Tenant Architecture & Isolation | 4 | 1 | 0 | 5 |
| 2 | Auth & RBAC | 4 | 2 | 0 | 6 |
| 3 | Student Information System | 2 | 2 | 1 | 5 |
| 4 | Attendance | 2 | 2 | 2 | 6 |
| 5 | Academics — Timetable/Exams/Grading/Report Cards | 2 | 1 | 4 | 7 |
| 6 | Fee & Finance | 5 | 0 | 4 | 9 |
| 7 | HR & Staff, Communication | 1 | 3 | 0 | 4 |
| 8 | Parent & Student Portal | 4 | 0 | 1 | 5 |
| 9 | SaaS Billing Layer | 0 | 2 | 3 | 5 |
| 10 | Production-Grade Cross-Cutting Concerns | 1 | 5 | 3 | 9 |
| 11 | Testing Discipline | 1 | 2 | 1 | 4 |
| 12 | HCI / Usability | 3 | 4 | 1 | 8 |
| 13 | Deployment Readiness | 2 | 1 | 1 | 4 |
| | **TOTAL** | **31** | **25** | **21** | **77** |

40% fully done, 32% partial, 27% missing. The foundation (tenant isolation, RLS, auth, payments correctness) is genuinely solid. The gaps cluster in three places: **Pakistani-market fee-collection specifics** (bank-challan PDF, late fines), **billing/monetization enforcement** (plan limits not enforced), and **bulk/background-job infrastructure** (no queue exists anywhere, so bulk report cards and large broadcasts run synchronously in-request).

---

## 2. Full list of ⚠️ / ❌ items

### Section 1 — Multi-Tenant Architecture & Isolation
- ⚠️ **Cross-tenant security-sweep test suite is incomplete.** Dedicated "School A token vs. School B ID" tests exist for auth, students, staff, attendance, notifications, and portal — but **not** for academics (subjects/timetable), exams/grading/marks, fees/invoices/payments, payroll, or 5 of 6 SIS sub-resources (academic years, classes, sections, guardians, enrollments). Postgres RLS (item 3, ✅ and independently verified with `FORCE ROW LEVEL SECURITY`) still protects all of these at the DB layer even without an app-level test — so this is a **regression-detection gap**, not a live leak, but it means an accidental RLS-bypass (e.g., someone querying with the raw `prisma` client instead of `runWithTenant`) in one of those modules would go undetected by CI.

### Section 2 — Auth & RBAC
- ⚠️ No isolated unit test of the RBAC middleware's literal "unassigned role" default-deny behavior — correct by code inspection and well-covered indirectly (every module has a 403-for-wrong-role test), just not tested in isolation.
- ⚠️ **No "Principal" role exists.** The schema's 7th role is `FRONT_DESK` (admissions/front-office), not `PRINCIPAL`. If a distinct Principal role (oversight/approval above Teacher, below School Admin) is a real requirement, this needs a product decision — rename, or add a genuinely new role with its own permissions.

### Section 3 — Student Information System
- ⚠️ **Admission form is missing required fields.** CNIC/B-Form is free text with **no format validation** (no regex for Pakistan's `XXXXX-XXXXXXX-X` pattern). **No roll number field exists anywhere in the schema** — schools use roll numbers as the primary identifier on registers and report cards; this is a real gap. No student contact/phone field (only the guardian's). Photo upload and guardian linkage are not available on the admission form itself (guardian is a separate step after creation).
- ⚠️ Student list filtering only supports section, not class (a client must already know every section ID under a class to filter by it). Pagination itself is genuinely DB-level (`skip`/`take` in the Prisma query, confirmed by reading the code) — that part is solid.
- ❌ **No promotion (move-to-next-class) or transfer-certificate generation exists at all.** Zero code, zero tests. This is a core year-end workflow every school needs — promoting a whole class up a grade, and issuing a TC for a leaving student.

### Section 4 — Attendance
- ⚠️ Daily attendance only — no subject/period-wise attendance dimension (no `subjectId` on the attendance record).
- ⚠️ Grid UI is real (an actual `<table>` register, not a form) but shows only a single spinner during save, not incremental "25/40 marked" progress — consistent with the backend also processing the whole roster as one atomic request rather than incrementally.
- ❌ **Future-dated attendance is not rejected.** No validation exists anywhere in the schema or handler; confirmed by reading both files. A teacher could mark attendance for a date next month with nothing stopping it.
- ❌ **No audit trail on attendance edits.** Re-marking a student overwrites the existing record in place (`upsert`). Directly proven by an existing test: marking a student `ABSENT` then `PRESENT` leaves exactly one record, with no trace the `ABSENT` mark ever existed. The app already has a generic `AuditLog` model used elsewhere (signup, staff changes, tenant status changes) — it's simply never called from the attendance module.

### Section 5 — Academics: Timetable, Exams, Grading, Report Cards
- ❌ **Grading bands are hardcoded, not per-tenant configurable.** A single fixed scale (90=A+, 80=A, 70=B...) applies to every school; the code comment literally says "a natural place to make per-tenant configurable later." Given the target market spans Nursery through Matric/O/A-Levels — multiple boards with different grading conventions — every school currently gets the same grades regardless of their actual policy. This can produce a report card with the *wrong* grade relative to what the school expects, which is a correctness issue, not just a missing nicety.
- ❌ **Grading is never tested at boundary values.** Only mid-range percentages (87%, 20%) are exercised by any test; whether exactly 90.0% gets A+ or A, or exactly 32.999% gets E or F, is completely unverified — and there's no unit test file for the grading function at all.
- ⚠️ Report-card PDF includes marks/total/%/grade correctly, but has **no school branding at all** (the Tenant model has no logo/letterhead field, and the PDF header doesn't even print the school's name) and **no attendance summary** (never queries the attendance table).
- ❌ **There is no bulk/whole-class report-card generation, synchronous or background-job.** Not "over-claimed and partially built" — it does not exist in any form, and there is zero queue/Redis infrastructure anywhere in the codebase to build it on. A school generating report cards for a class of 40 must call the single-student PDF endpoint 40 separate times by hand; there's no batch endpoint and no "generate for class" button anywhere in the UI.
- ❌ No PDF tests for missing-marks or special-character-name edge cases exist.

### Section 6 — Fee & Finance
- ❌ **No Pakistani bank-slip/challan-style voucher PDF exists.** Grepped the entire fees module — zero PDF/voucher/challan code. The only PDF in the whole app is the exam report card. Parents cannot be handed a physical bank-payable slip, which is core to how Pakistani schools actually collect fees.
- ❌ **No late-fine auto-calculation.** `Invoice` has no fine field; the `OVERDUE` status exists in the enum but is never actually set by any code path (confirmed live: created an invoice with a due date 7 months in the past — it stayed `UNPAID` at exactly the original amount, no fine, no status change). Schools relying on this must calculate fines manually outside the system.
- ❌ No defaulter list (filterable by class/section, or at all) — the only invoice list filter is by status/student, with no way to see "who owes money, broken down by class."
- The rest of this section is genuinely solid: FeeStructure model, duplicate-voucher prevention (both app check and hard DB constraint), payment recording wrapped in a real DB transaction, idempotency (DB-constraint-backed, tested with a replay test proving no double-charge), and partial-payment status transitions all check out and are test-verified. A generic, swappable SMS/WhatsApp/Email provider interface exists (currently backed by a logging stub) — real plumbing, just not yet wired to any fee-reminder trigger.

### Section 7 — HR & Staff, Communication
- ⚠️ Staff model has no subject-specialization field (only a free-text "department").
- ⚠️ **Leave management barely exists** — there's no Leave/LeaveRequest model, no request/approval workflow, no balance tracking; only a manually-settable `ON_LEAVE` status flag with no behavior behind it. Payroll, by contrast, is real and well-tested (salary, allowances, deductions, net calculation, duplicate-month prevention).
- ⚠️ No dedicated Notice/Announcement model — it's overloaded onto the generic per-recipient `Notification` table, which means no titles, no "list of notices I created" admin view, and broadcasts can only target staff-by-role or a section's guardians (not a school-wide "all Parents" audience).
- Audience targeting itself is structurally leak-proof (each notification is created for exactly one recipient) and tested.

### Section 8 — Parent & Student Portal
- ❌ **No Homework model exists at all** — zero code on either the teacher-post or student/parent-read side.
- The rest of this section is strong: multi-child parent access, a **dedicated** (not just inferred) cross-family isolation test suite that was independently re-verified with an additional two-children-plus-a-stranger-child scenario, a genuinely read-only portal API (verified: every portal route is a GET, zero writes), and a portal frontend that is a real separate, lighter layout — not the staff dashboard with a role check bolted on.

### Section 9 — SaaS Billing Layer
- ⚠️ Plans are a hardcoded TypeScript config, not a DB model — fine functionally, but SMS credits (one of the three explicitly required limit types) doesn't exist as a concept anywhere.
- ❌ **Plan limits are computed but never enforced.** The Super Admin's tenant-detail view can tell you a tenant is over its student/staff limit — but the actual student-creation and staff-creation endpoints never check this before inserting. A TRIAL-plan school can add unlimited students or staff with zero pushback from the API. This is a real gap in the billing model's teeth.
- ⚠️ Super Admin's tenant-management **backend is fully built and tested** (list/search/suspend/reactivate/change-plan, with an audit log) — but the **frontend for it is a literal placeholder stub** ("The Schools module UI is being built next."). Today, actually running the business (viewing tenants, suspending one) requires calling the API directly.
- ❌ No visibility into new signups for the Super Admin — no "pending" concept exists (self-signup creates a live, active tenant immediately), and even the proxy metric (new TRIAL tenants) has no UI surfacing it.
- ❌ Signup is one flat form, not a multi-step wizard — no plan-selection step exists at all (every signup silently lands on TRIAL).

### Section 10 — Production-Grade Cross-Cutting Concerns
- ⚠️ Two endpoints aren't paginated (exams list; a student's attendance history with no default time-range cap) — not dangerous today, but unbounded as data grows.
- ⚠️ Roughly half of tenant-scoped tables lack a composite `(tenantId, X)` index matching their actual filter columns (e.g. staff filtered by status/department has only a bare tenantId index) — a performance concern that will bite as data grows, not an immediate issue at launch scale.
- ⚠️ **N+1 write patterns exist on bulk operations** — bulk invoice generation, bulk attendance marking, and bulk marks entry each do one DB round-trip per record in a loop (acceptable at typical class sizes). The worst case is the **notifications broadcast endpoint**, which does 2-3 queries per recipient synchronously inside the HTTP request — for a large guardian list this risks a slow response or timeout. The code has its own comment acknowledging this should move to a background queue, which doesn't exist.
- ❌ **No timeouts or retry logic on any external/IO-heavy call** — moot today only because there is no real external gateway wired in yet (SMS/WhatsApp/Email all route to a logging stub); this becomes a real production risk the moment a real provider is plugged in, and should be built in from the start rather than retrofitted.
- ❌ **No correlation/request IDs anywhere** — two log lines from the same request share no identifier, so tracing one request end-to-end through the logs is not possible today.
- ❌ **The `/health` endpoint returns `{status:"ok"}` unconditionally — it never actually checks the database.** This is the single most impactful cross-cutting finding: if Postgres goes down, an uptime monitor watching `/health` will keep reporting healthy, which delays incident response for the most likely real-world failure mode. Redis isn't used anywhere in this app, so that half of the check is genuinely not applicable.
- ⚠️ One confirmed plaintext PII log: the notification-sending stub logs the raw recipient phone number/email at `info` level on every send.
- ⚠️ **Validated request bodies are solid (zod schemas with real min/max/positive constraints, confirmed live with negative-amount and invalid-date curl tests all correctly returning 400) — but route-param IDs bypass validation.** The shared `param()` helper (used 59 times across every module) only checks a param is a non-empty string, not a valid UUID. Live-tested: `GET /api/students/not-a-uuid` returns a raw **500**, not a clean 400 — a malformed ID in any URL crashes into an internal-error response instead of being rejected cleanly (the response body itself still doesn't leak a stack trace, so the earlier error-handler protection holds).

### Section 11 — Testing Discipline
- ✅ Full suite run twice cleanly by me directly (not from an agent's claim): **backend 130/130, frontend 26/26.** One flaky failure was observed during a noisy run (headless-Chromium/Jest-teardown race under heavy concurrent load in this shared sandbox) and did not reproduce on a clean re-run — noted, not hidden.
- ❌ No unit tests exist for grading-boundary calculation (ties to Section 5) or plan-limit enforcement (ties to Section 9 — there's nothing to test since the feature isn't enforced).
- ⚠️ Attendance validation rules are partially tested (duplicate-blocking and bulk-mark are, future-date rejection isn't — because the rule itself doesn't exist).
- ⚠️ Payment→invoice-status integration is tested and passing. "Admission→user account creation" doesn't map cleanly onto this app's actual data model — a Student is not a User; only Staff and Guardians get login accounts (via a separate provisioning step) — worth flagging as a checklist/architecture mismatch rather than a gap.
- The tenant-isolation sweep does **not** pass against the *whole* app in the literal "every tenant-scoped endpoint" sense — see Section 1's finding on coverage.

### Section 12 — HCI / Usability
- ⚠️ Loading/success/error feedback is genuinely good everywhere it's implemented (bulk invoices, bulk attendance, payments all show spinners + success/error alerts) — but **PDF report-card generation has no frontend UI at all**, despite a working backend endpoint. Combined with Section 5's finding (no bulk generation exists either), the entire "get report cards out of the system" workflow is currently unusable by an actual school admin through the UI.
- ❌ No destructive-action confirmation exists anywhere — but only because **no delete functionality exists anywhere in the frontend at all** (confirmed: zero delete buttons across the whole app; a `danger` button variant is defined in the design system but used nowhere). Several whole modules (Staff, Payroll, Notifications, Exams, both Platform-admin pages) are still literal `"...module UI is being built next"` placeholder stubs, so this item is untestable for most of the product surface.
- ⚠️ Domain terminology inside the actual dashboard/portal is clean plain English throughout (and consistently "Invoice" — never mixed with "Voucher"/"Challan" anywhere, so no cross-screen inconsistency) — but the **public marketing landing page renders "Multi-tenant school management for schools in Pakistan"** directly to visitors, which is internal SaaS-architecture jargon a school administrator wouldn't recognize. (Worth flagging separately: the checklist assumed "Voucher"/"Fee Challan" would be the product's chosen term — it isn't; the app uses "Invoice" exclusively. That's internally consistent, just worth confirming it matches what was actually intended for the Pakistani market.)
- ⚠️ Mobile responsiveness is real (dedicated slide-in mobile nav, responsive breakpoints throughout, tables wrapped for horizontal scroll) but several core tap targets — notably the bulk-attendance status buttons and the mobile hamburger menu — are 36px, under the commonly-recommended 40-44px minimum.
- ⚠️ Typography uses a real custom font setup (`next/font`, Geist + a pre-loaded Urdu font for future use) but no custom type scale — every page just uses Tailwind's stock text-size classes.

### Section 13 — Deployment Readiness
- ❌ No Dockerfile/docker-compose exists — **this is a deliberate choice, not an oversight**: `docs/DEPLOYMENT.md` explicitly documents a bare-VPS + pm2 deployment path instead, and that path is complete and workable. Flagged here only because the checklist explicitly asked for one; functionally this is a non-issue given the chosen deployment strategy.
- ⚠️ Filter columns are indexed correctly across the sampled tables (students, invoices, attendance), but the `ORDER BY` columns used by the default (unfiltered) list views on students (`fullName`) and invoices (`issueDate`) have no supporting index — a real but low-severity performance gap, not a correctness issue.

---

## 3. Launch-blocking vs. safe to fix post-launch

**Launch-blocking** (would cause real harm to a school, its money, or a user's experience of a common action — or directly undermines the ability to run the SaaS business):

1. **No Pakistani bank-challan voucher PDF** (Section 6) — schools can't collect fees the way they actually operate without this.
2. **No late-fine auto-calculation** (Section 6) — real revenue miscounted/lost, or forces error-prone manual work outside the system.
3. **Plan limits not enforced at creation** (Section 9) — the billing model has no teeth; any tenant can exceed its paid tier for free.
4. **Super Admin frontend is a placeholder stub** (Section 9) — you cannot actually run tenant operations (view, suspend, reactivate) without calling the API by hand.
5. **No bulk report-card generation, and no PDF download button in the UI at all** (Sections 5 & 12 together) — the entire "produce report cards for a class" workflow — arguably the single most important recurring task in a school's calendar — is not usable through the product today.
6. **`/health` never checks the database** (Section 10) — false-positive uptime signal during the most likely real production outage.
7. **Malformed route-param IDs crash into a raw 500** (Section 10) — this is the literal "crash on common input" scenario called out in the brief; a bad link, a buggy integration, or routine endpoint scanning all trigger it.
8. **Grading bands are hardcoded across all tenants** (Section 5) — can produce a report card with a grade that doesn't match what a specific school's policy actually says, which is a correctness/trust issue on a document parents rely on.

**Important, but safe to ship and fix shortly after launch** (real gaps, lower immediate blast radius):

- Cross-tenant security-sweep coverage gaps in academics/exams/fees/payroll (Section 1) — RLS already covers these at the DB layer independently; this is about regression-testing, not a live hole.
- Missing roll number field and CNIC format validation on admission (Section 3).
- No promotion / transfer-certificate workflow (Section 3) — becomes urgent at the first academic year-end, not day one.
- Future-dated attendance not rejected, and no attendance audit trail (Section 4) — data-quality/trust issues, not crashes or leaks.
- No defaulter list (Section 6) — painful but workable via manual queries as a stopgap.
- Leave management, Notice/Announcement model limitations, missing staff subject-specialization field (Section 7).
- No Homework model (Section 8).
- No new-signup visibility for Super Admin, no onboarding wizard (Section 9).
- Composite-index gaps, N+1 patterns on bulk writes, missing correlation IDs, one plaintext PII log line, no timeout/retry scaffolding for external calls not yet wired in (Section 10) — all real, none urgent at initial launch scale; the external-call timeout item should be built in at the same time a real SMS/payment gateway is added, not bolted on after.
- No delete functionality anywhere, several placeholder module pages (Staff/Payroll/Notifications/Exams UI), landing-page jargon, small touch targets, no custom type scale (Section 12).
- Missing Dockerfile (Section 13) — non-issue given the deliberately chosen pm2/VPS deployment path.

**Needs a product decision, not a code fix:**
- No distinct "Principal" role — `FRONT_DESK` fills the 7th role slot instead (Section 2). Confirm with the stakeholder whether this is acceptable or whether a genuine Principal role/permission set is required.

---

## 4. What was *not* independently re-verified by me

Everything above was investigated by 8 parallel agents against the live codebase, each instructed to run real commands and quote real evidence rather than assume. I did not personally re-read every line of evidence they cited (file:line references, quoted code, and test output are taken as reported). I *did* personally, directly re-run the full test suites myself on a freshly migrated, isolated database as the authoritative Section 11 result (backend 130/130, frontend 26/26, confirmed clean twice) rather than relying solely on the agents' individually-scoped test runs, several of which noted transient environment flakiness from concurrent execution in this shared sandbox. One agent added a scratch test file to the repo during its investigation (`__verify_parent_multichild.test.ts`); I removed it afterward so the codebase is left unchanged by this audit, as requested — this was a check, not a modification pass.
