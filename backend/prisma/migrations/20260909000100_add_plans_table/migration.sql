-- Replace the fixed TenantPlan enum with a real, editable "plans" table.
-- See Plan model's doc comment in schema.prisma for the full rationale.

-- CreateTable
CREATE TABLE "plans" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceMonthlyPKR" INTEGER NOT NULL,
    "maxStudents" INTEGER,
    "maxStaff" INTEGER,
    "maxSmsCreditsPerMonth" INTEGER,
    "features" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");

-- Seed the 4 tiers that existed as static config (config/plans.ts's old
-- PLAN_CATALOG) so every tenant already on one of these keeps resolving to
-- the exact same limits/features it had before this migration.
INSERT INTO "plans" ("id", "code", "name", "priceMonthlyPKR", "maxStudents", "maxStaff", "maxSmsCreditsPerMonth", "features", "sortOrder", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid(), 'TRIAL', 'Trial', 0, 50, 10, 0,
   '["Core SIS", "Attendance", "Basic fee management", "14-day trial"]'::jsonb, 0, now(), now()),
  (gen_random_uuid(), 'BASIC', 'Basic', 5000, 300, 30, 0,
   '["Core SIS", "Attendance", "Fee management", "Exams & report cards"]'::jsonb, 1, now(), now()),
  (gen_random_uuid(), 'STANDARD', 'Standard', 12000, 1000, 100, 1000,
   '["Everything in Basic", "HR & payroll", "SMS/WhatsApp notifications (1000/mo)", "Parent portal"]'::jsonb, 2, now(), now()),
  (gen_random_uuid(), 'PREMIUM', 'Premium', 25000, NULL, NULL, NULL,
   '["Everything in Standard", "Unlimited students & staff", "Unlimited SMS/WhatsApp", "Priority support"]'::jsonb, 3, now(), now())
ON CONFLICT ("code") DO NOTHING;

-- Tenant.plan: enum -> plain text, same values, nothing to backfill.
ALTER TABLE "tenants" ALTER COLUMN "plan" DROP DEFAULT;
ALTER TABLE "tenants" ALTER COLUMN "plan" TYPE TEXT USING "plan"::text;
ALTER TABLE "tenants" ALTER COLUMN "plan" SET DEFAULT 'TRIAL';

-- The enum type is no longer referenced by any column (Tenant.plan was its
-- only use — verified by grepping the whole schema).
DROP TYPE "TenantPlan";

-- ============================================================
-- Row Level Security for "plans". Mirrors the `tenants`/`school_groups`
-- open-SELECT rationale (schema.prisma top-of-file comment,
-- 20260815214539_init/migration.sql): every context needs to read plan
-- definitions, including the *unauthenticated* public signup page before
-- any app.tenant_id exists. Unlike tenants/school_groups, this table also
-- needs INSERT/UPDATE/DELETE from platform context (Super Admin CRUD,
-- which always runs via runWithTenant(null, ...), i.e. app.tenant_id
-- unset) — same gating predicate already used by tenants_update_platform
-- (20260815231500_platform_tenant_update_policy/migration.sql), just
-- extended to all three write operations since this table has no
-- per-tenant ownership at all to also gate on.
-- ============================================================

ALTER TABLE "plans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "plans" FORCE ROW LEVEL SECURITY;

CREATE POLICY "plans_select_all" ON "plans"
  FOR SELECT USING (true);

CREATE POLICY "plans_platform_write" ON "plans"
  FOR ALL
  USING (NULLIF(current_setting('app.tenant_id', true), '') IS NULL)
  WITH CHECK (NULLIF(current_setting('app.tenant_id', true), '') IS NULL);
