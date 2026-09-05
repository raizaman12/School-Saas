-- Backfills User.loginId for accounts that existed before the "log in by
-- ID" feature — otherwise only staff/students created AFTER this ships
-- would get one. Idempotent (only touches rows where loginId IS NULL),
-- so it's safe to re-run and safe alongside the app-level code that also
-- sets loginId going forward.

-- Non-admin staff: derive from their own employeeCode (e.g.
-- "EDU-EMP-000001" -> "eduemp000001"). SCHOOL_ADMIN ("Principal") is
-- deliberately excluded — that role stays email-only.
UPDATE "users" u
SET "loginId" = lower(regexp_replace(sp."employeeCode", '-', '', 'g'))
FROM "staff_profiles" sp
WHERE sp."userId" = u.id
  AND u.role <> 'SCHOOL_ADMIN'
  AND u."loginId" IS NULL;

-- Every student with a portal login: derive from their own studentCode
-- (e.g. "EDU-2026-000001" -> "edu2026000001").
UPDATE "users" u
SET "loginId" = lower(regexp_replace(s."studentCode", '-', '', 'g'))
FROM "students" s
WHERE s."userId" = u.id
  AND u."loginId" IS NULL;
