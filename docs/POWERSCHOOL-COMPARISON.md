# School Management SaaS vs. PowerSchool SIS — Honest Feature Comparison

**Method:** PowerSchool's feature claims below come from their own feature flyer, public documentation subdomains, district-published user guides, and third-party review sites (G2/Capterra/TrustRadius) — powerschool.com's own product pages were blocked to automated fetching, so a few areas (marked below) are lower-confidence and worth a live demo before betting a roadmap on them. Every claim about **our** system was traced to an actual route, model, or frontend page — not a comment or a summary. This is written for internal use: it does not flatter either product.

Legend: ✅ have it · ⚠️ partial / weaker · ❌ missing entirely

---

## 0. The one-paragraph version

PowerSchool is not one product — it's roughly a dozen acquired products (SIS, eSchoolPlus, Special Programs, Behavior Support/ex-Kickboard, Schoology/ex-LMS, Naviance, SchoolMessenger, Schoolzilla/Analytics, eFinancePlus/ERP, Enrollment Express) wearing one brand, most sold and priced separately. Its **core SIS** is genuinely deeper than ours in exactly the areas you'd expect from 25+ years of US K-12 compliance requirements: a real scheduling-simulation engine, special-education/IEP case management, health/immunization records, discipline tracking, and a mature integration/SSO ecosystem. It is also, by its own users' account (G2/Capterra/TrustRadius, consistently), dated-feeling, cluttered, and expensive once you add up implementation ($5k–$50k+), training, and the separately-priced modules a real deployment needs. **Our system is materially ahead on things PowerSchool treats as separate paid products** — fee/finance, payroll, multi-audience communication, and the parent/student portal are all native and free at any plan tier — and it is built for Pakistan specifically (CNIC/B-Form validation, PKR pricing, Matric/O-Level/A-Level grading, bank-challan invoicing) in a way PowerSchool, a US product, structurally cannot be. **The most urgent gap is not a missing feature category — it's that SMS/WhatsApp/Email notifications are currently mocked, not actually wired to a real provider**, which matters more for a Pakistan-market product than most of what PowerSchool has and we don't.

---

## 1. Architecture & business model

| | PowerSchool | Us |
|---|---|---|
| Tenancy model | Cloud-hosted, appears to be per-district instance ("Student Information Cloud") rather than one shared multi-tenant pool | True shared-DB multi-tenant SaaS: one Postgres schema, tenant isolation enforced by **Postgres Row-Level Security**, not just app-code checks |
| Onboarding | Sales-quote implementation cycle: **$5,000–$50,000+** per district, base license **$10,000–$20,000/yr** + maintenance (third-party estimates — PowerSchool doesn't publish a rate card) | Self-service signup, live tenant in seconds, 14-day trial, no sales process |
| Pricing model | Quote-based, per-district, add-on modules separately priced (reviewers specifically complain about surprise costs — one G2 reviewer cited a $60k quote after a failed migration) | Published flat PKR tiers (TRIAL free / BASIC 5,000 / STANDARD 12,000 / PREMIUM 25,000 per month), enforced in code (student/staff caps checked atomically at creation, SMS credits metered) |
| Payment collection | ⚠️ Not found natively for SaaS billing itself | ❌ Also missing — plan is "self-declared," a Super Admin manually flips it. **Neither product has this solved**; not a PowerSchool advantage |
| Product scope | ~12 formerly-independent products under one brand, mostly separately sold | One codebase, one price, features bundled by plan tier not by product |

---

## 2. Core student records / SIS

| Capability | PowerSchool | Us |
|---|---|---|
| Student CRUD, search, enrollment history | ✅ mature | ✅ full CRUD, search by name/code/roll/CNIC, role-scoped visibility |
| Guardian/contact management | ✅ | ✅ CRUD, link/unlink, primary-guardian flag |
| Custom fields / custom tables | ✅ (praised by reviewers as a real strength) | ❌ schema is fixed; no tenant-defined custom fields |
| Bulk CSV/Excel import | ✅ Data Import Manager | ❌ every record is created one-at-a-time through a form |
| File/photo upload | ⚠️ (assumed, not detailed in research) | ❌ **`photoUrl`/`logoUrl` are plain URL strings — there is no actual upload endpoint.** A school must host images elsewhere and paste a link. This is a real, fixable gap. |
| Field-level / page-level permission granularity | ✅ three-tier field security (Full/View-only/No-access), independent of page access | ⚠️ role-based only (`SCHOOL_ADMIN`/`TEACHER`/etc.); no per-field visibility control |
| Transfer certificates | ❌ not a US concept in the same form | ✅ auto-numbered TC issuance **and void/undo** — genuinely more useful for Pakistan's context than anything PowerSchool documents here |
| Admission form / paperwork PDF | ❌ not found as a single artifact | ✅ full admission packet (student + guardians + fee structure + ledger) as one PDF |
| Class promotion (year-end bulk move-up) | ⚠️ handled via scheduling rollover, "not as seamless as it should be" per reviewers | ✅ dedicated bulk promote-with-holdback-option flow |
| CNIC/B-Form validation | n/a (US identity docs) | ✅ Pakistani CNIC/B-Form regex enforced on both student and guardian records |
| Change/audit history | ✅ deep — per-record change history across student/staff/health/attendance/contacts, gated by field permission | ⚠️ an `AuditLog` model exists but is only written from 5 call sites (attendance edits, tenant settings, platform actions, signup, staff creation) — not a system-wide log |

---

## 3. Attendance

| Capability | PowerSchool | Us |
|---|---|---|
| Daily + period attendance | ✅ | ✅ bulk mark/re-mark per section per date |
| Seating-chart-based attendance | ✅ (PowerTeacher Pro) | ❌ no seating charts at all |
| Holiday / non-instructional-day awareness | ✅ | ✅ date-range holidays + configurable weekly off-days (defaults to **Sunday-only**, correctly matching Pakistani convention rather than assuming Sat+Sun) |
| Attendance-change audit trail | ✅ | ✅ status changes (not initial marks) logged with before/after |
| Attendance reporting/PDF | ✅ | ✅ per-student PDF, per-section summary over a date range |

Close to parity here — this is one of the stronger areas of our system.

---

## 4. Scheduling / Timetable

| Capability | PowerSchool (PowerScheduler) | Us |
|---|---|---|
| Basic weekly timetable | ✅ | ✅ day/time/room slots per section-subject |
| Conflict detection | ✅ | ✅ **real** — section double-booking and teacher double-booking both checked on create/edit |
| Student-choice / course-request scheduling | ✅ students/parents submit elective requests, feeds an automated build | ❌ no elective/course-request concept; sections and subjects are entirely admin-assigned |
| Master-schedule build engine / "what-if" simulation | ✅ genuinely sophisticated — evaluates large numbers of combinations to minimize conflicts, has a distinct test-scenario mode | ❌ nothing like this exists; ours is a straightforward slot editor |
| Walk-in / ad hoc mid-year scheduling | ✅ dedicated mode | ⚠️ possible manually, no dedicated ad hoc flow |
| Study-hall auto-fill | ✅ | ❌ |

**This is PowerSchool's single strongest, most defensible technical advantage** — PowerScheduler is a real constraint-solving engine built over decades. Worth being honest that closing this gap is a multi-month engineering project, not a quick add, if it's ever prioritized (and for most Pakistani school sizes, may not need to be — this kind of engine mainly pays off for large US high schools with hundreds of elective combinations).

---

## 5. Gradebook / Exams / Report cards

| Capability | PowerSchool (PowerTeacher Pro) | Us |
|---|---|---|
| Marks/score entry | ✅ point, percentage, letter, formula-based | ✅ bulk marks entry per exam-subject, validated against `maxMarks` |
| Standards-based grading | ✅ deep — standards trees, per-standard progress, separate standards-based report cards | ❌ single overall grading-band model only |
| Configurable grading scale per school | ⚠️ exists but less explicitly "board-aware" | ✅ per-tenant grading bands, **seeded to match Matric-board convention (33% pass mark)** and explicitly designed so an O-Level/A-Level school can configure its own scale too |
| Seating-chart attendance-from-gradebook | ✅ | ❌ |
| Comment banks | ✅ | ❌ |
| Report cards | ✅ | ✅ includes **attendance summary baked into the same report card** — a nice detail PowerSchool's docs don't call out as clearly |
| Batch report-card generation | ⚠️ not detailed in research | ✅ background job renders one PDF per student in a class, zips it, pollable status |
| Bulk assignment tools, extra credit, missing/late/incomplete flags | ✅ extensive | ❌ we have no assignment concept at all — only exam-based marks (see Homework note below) |

PowerTeacher Pro is a genuinely richer day-to-day gradebook for teachers doing continuous coursework grading. Our exam-centric model matches how Pakistani schools actually run (periodic exams, not constant graded assignments) reasonably well, but there's a real gap if any target schools want ongoing assignment/classwork tracking.

---

## 6. Fees / Finance

| Capability | PowerSchool | Us |
|---|---|---|
| Native fee/billing engine in the SIS | ❌ **core SIS only has basic fee-tracking fields** — real billing runs through a separately-sold ERP product, **PowerSchool eFinancePlus** | ✅ full native fee module: categories, per-class-per-year structure, bulk invoice generation, ledger, payments, late-fee policy, defaulters list |
| Cafeteria/meal payments | ⚠️ native "PowerLunch" is basic account tracking only; real online payment goes through third parties (MySchoolBucks, Meals Plus) | n/a — not a Pakistani-school pattern in the same way |
| Online payment gateway | ❌ not native either | ❌ also not integrated (JazzCash/Easypaisa/Stripe/etc. — none wired up) |
| Localized invoice format | n/a | ✅ **Pakistani-style 3-copy bank/school/student challan PDF** — this is exactly the format Pakistani parents expect and PowerSchool has no equivalent for |
| Idempotent payment recording | not documented | ✅ `idempotencyKey` guards against double-recording on retry |

**This is one of our clearest wins.** PowerSchool explicitly does not solve fee/finance inside its SIS — it sells a whole separate ERP for that. We give it away natively at every plan tier, in a format built for how Pakistani schools actually invoice.

---

## 7. Staff / HR / Payroll

| Capability | PowerSchool | Us |
|---|---|---|
| Native payroll in the SIS | ❌ sold separately as part of **eFinancePlus** | ✅ native: generate per staff/month, net-salary computation, mark-paid, blocks negative net salary and terminated-staff generation |
| Staff leave management | ⚠️ not clearly documented as a distinct SIS feature | ✅ file/cancel own, admin approve/reject, state-machine guarded |
| Staff records | ✅ | ✅ CRUD, auto employee codes, department/designation/employment-type |

Same story as fees — another product PowerSchool sells separately that we bundle natively.

---

## 8. Communication (Notices / Notifications)

| Capability | PowerSchool | Us |
|---|---|---|
| Mass SMS/email/voice | ✅ via **SchoolMessenger** (an acquired, separately-branded product layered on top of core SIS) | ⚠️ **channel exists in code (SMS/WhatsApp/Email/In-app) but every provider currently resolves to a local logging mock — nothing is actually delivered externally today.** This is the single most urgent gap in the whole system for a live product. |
| Two-way messaging | ✅ (SchoolMessenger "Two-Way Messaging") | ❌ |
| Multi-audience notice in one publish action | ⚠️ not documented as a single-action feature | ✅ one notice can target any combination of all-staff / all-guardians / all-students / a section / named individuals, with a tone tag (General/Important/Urgent/Event/Holiday) |
| WhatsApp as a first-class channel | ❌ not mentioned anywhere in PowerSchool's stack | ✅ modeled as a first-class, plan-metered channel — correctly reflects that WhatsApp, not email, is the dominant parent-communication channel in Pakistan |
| Push notifications | ✅ | ❌ no native mobile app, so no push |

The notice/audience design is genuinely more flexible than what PowerSchool documents for SchoolMessenger, and WhatsApp-as-first-class is the right call for this market. But "more flexible and currently non-functional" is worse than "less flexible and works" — **wiring a real SMS/WhatsApp provider (e.g. an actual Twilio or Meta WhatsApp Cloud API integration) should be treated as higher priority than most feature gaps below.**

---

## 9. Parent / Student Portal

| Capability | PowerSchool Parent Portal + app | Us |
|---|---|---|
| Grades/attendance/report card viewing | ✅ | ✅ |
| Fee/meal balance viewing | ✅ | ✅ fee ledger (view-only) |
| Online fee payment | ⚠️ via third-party integration, not native | ❌ view-only, no payment |
| Multi-child single login | ✅ | ✅ parent account lists all linked children with primary flag |
| Course requests | ✅ | n/a (no elective system) |
| Native mobile app | ✅ (though reviewed as buggy — frequent refresh failures, unreliable push, per Play Store reviews) | ❌ web-only |
| Leave-request workflow, parent-initiated, routed to actual teachers | ❌ nothing like this found in PowerSchool's stack | ✅ parent files a leave request that auto-notifies **every teacher who actually teaches that child** (class + subject teachers) plus admin — a genuinely useful, specific feature PowerSchool has no equivalent for |
| Email alert subscriptions | ✅ | ⚠️ in-app notifications exist; no configurable per-channel subscription preferences |

Solid parity on the viewing side; the parent-initiated leave-request-to-actual-teachers flow is a real point in our favor that has no PowerSchool equivalent in the research. The gap is a native mobile app and online payment.

---

## 10. Areas PowerSchool has that we do not have at all

Confirmed by direct search of the codebase — these are not "weaker," they are **absent**:

- ❌ **Discipline/behavior tracking** — no incident reports, detentions, or behavior points (PowerSchool has this in core SIS plus a dedicated add-on, PowerSchool Behavior Support)
- ❌ **Health/medical/immunization records** — no nurse visit log, allergy tracking, vaccination records
- ❌ **Special education / IEP / 504 case management** — PowerSchool has a deep, compliance-driven module for this (Special Programs); we have nothing
- ❌ **Transportation/bus routing** — PowerSchool doesn't have real routing either (handled by third-party partners), but does have transportation data fields; we have neither
- ❌ **Cafeteria/food service** — less relevant for most Pakistani schools, but PowerSchool has basic native tracking (PowerLunch) and we have none
- ❌ **SSO / third-party app marketplace / Ed-Fi / OneRoster interoperability** — PowerSchool has real (if complex) integration standards support and an app marketplace; we have zero external integrations or SSO
- ❌ **Analytics/BI dashboards** — PowerSchool sells this separately (Unified Insights/ex-Schoolzilla); we have no reporting/analytics layer beyond simple lists
- ❌ **Assignment/coursework workflow with submissions** — we have a `Homework` model (title/description/due-date) but it has **no submission, no attachments, no grading, and critically no frontend UI at all** — it's a working backend API nobody can reach
- ❌ **Bulk CSV/Excel import** for students or staff
- ❌ **Real file/image upload** — URL strings only

---

## 11. Where we're genuinely ahead — with actual reasoning, not flattery

1. **Everything PowerSchool sells as a separate paid product, we give away natively**: fee/finance (vs. eFinancePlus), payroll (vs. eFinancePlus), mass communication with multi-audience+tone (vs. SchoolMessenger as a bolt-on), notices. A school evaluating PowerSchool has to price in 3-4 additional modules to match what our single price tier already includes.
2. **True multi-tenant SaaS architecture** (shared DB + Postgres RLS) vs. PowerSchool's apparent per-district-instance cloud model — ours can spin up a new school in seconds with no implementation project; PowerSchool's own reviewers describe $5k-$50k implementation costs and multi-week onboarding.
3. **Built for Pakistan, not adapted to it**: CNIC/B-Form validation, PKR-denominated pricing, Matric-board 33%-pass grading convention (configurable alongside O/A-Levels), Sunday-only weekly off default, and a genuinely Pakistani bank-challan 3-copy fee voucher — none of this is retrofittable onto a US product without real engineering, and PowerSchool has no reason to ever do it.
4. **Modern, coherent UI** vs. PowerSchool's own users' consistent complaints (G2/Capterra/TrustRadius) about a dated, cluttered interface with a steep learning curve.
5. **Transparent, published, flat pricing** vs. PowerSchool's quote-based model with reviewer-reported surprise add-on costs.
6. **The parent-leave-request-to-actual-teachers flow and TC void/undo** are specific, real features with no documented PowerSchool equivalent — small but genuinely useful details.

---

## 12. Where PowerSchool is genuinely ahead — the honest list, prioritized

Ranked by how much it would actually matter for a Pakistani school, not by how impressive it sounds:

1. **Real notification delivery** (see §8) — not really "PowerSchool being ahead" so much as us having a half-finished feature; still, this is the top priority.
2. **PowerScheduler-grade scheduling** — a genuine, deep technical advantage, but arguably lower priority for schools that don't run US-style elective course selection.
3. **Bulk import + real file upload** — both are common, expected, relatively low-effort wins (standard CSV parsing / standard S3-style upload) that would close a real day-to-day admin-experience gap.
4. **Special education / IEP-style tracking** — matters if the target market includes schools with formal inclusive-education programs; currently zero coverage.
5. **Discipline/behavior tracking** — a fairly standard SIS feature we're missing entirely; relatively low engineering cost to add a basic version.
6. **Health records** — lower priority for most Pakistani private schools unless a specific customer segment needs it.
7. **Analytics/BI, SSO/integrations, custom fields, field-level permissions** — all real, all missing, all more about scaling up-market (large multi-campus groups, enterprise IT requirements) than about a typical single-campus Pakistani school's day-to-day needs.

---

## 13. Bottom line

Feature-count alone, PowerSchool "wins" — it's a 25-year-old product line with a dozen acquisitions behind it. But feature-count is the wrong scoreboard: a large chunk of what PowerSchool has is sold as separate, expensive, bolt-on products that this system gives away natively, and another chunk (state reporting, IEP compliance timelines, bus routing) exists because of US regulatory requirements that simply don't apply here. Measured against what a Pakistani school actually needs day-to-day — admissions, attendance, fees in the right format, exams on the right grading convention, and communication on the channel parents actually use — this system is closer to PowerSchool than the raw feature list suggests, with the one real, urgent exception that the communication channels aren't actually wired to a live provider yet.
