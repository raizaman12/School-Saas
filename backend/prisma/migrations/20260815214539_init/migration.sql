-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('TRIAL', 'ACTIVE', 'SUSPENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TenantPlan" AS ENUM ('TRIAL', 'BASIC', 'STANDARD', 'PREMIUM');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER', 'ACCOUNTANT', 'FRONT_DESK', 'PARENT', 'STUDENT');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('INVITED', 'ACTIVE', 'DISABLED');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'TRIAL',
    "plan" "TenantPlan" NOT NULL DEFAULT 'TRIAL',
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Karachi',
    "trialEndsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "role" "UserRole" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedByTokenHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "actorUserId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE INDEX "users_tenantId_idx" ON "users"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenantId_email_key" ON "users"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- CreateIndex
CREATE INDEX "refresh_tokens_tenantId_idx" ON "refresh_tokens"("tenantId");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_createdAt_idx" ON "audit_logs"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- Platform-admin email uniqueness (tenantId IS NULL rows are not
-- covered by the (tenantId, email) unique constraint since NULL <> NULL)
-- ============================================================
CREATE UNIQUE INDEX "users_email_platform_admin_key" ON "users"("email") WHERE "tenantId" IS NULL;

-- ============================================================
-- Row-Level Security: tenant isolation (defense-in-depth)
--
-- Session variable `app.tenant_id` is set per-request by the API's
-- tenant-context middleware (see src/middleware/tenantContext.ts)
-- right after the tenant is resolved (from JWT claims, or from the
-- slug lookup during login/signup, before any password check).
--
-- Contract:
--   - app.tenant_id = '<uuid>'  -> only rows for that tenant are visible
--   - app.tenant_id unset/''    -> only platform-level rows (tenantId IS NULL)
--     are visible (used by SUPER_ADMIN / platform auth flows)
--
-- The `school_saas_owner` role (used for migrations/admin tooling) has
-- BYPASSRLS and is unaffected by any of this. The `school_saas_app`
-- role (used by the running API at request time) is fully subject to it.
-- ============================================================

-- tenants: not itself tenant-scoped (a row IS a tenant). Reads are left
-- open because tenant resolution-by-slug must happen pre-authentication
-- (before app.tenant_id can be set) and this table holds no student/fee/
-- academic data. Writes are restricted to the tenant's own row.
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenants_select_all" ON "tenants"
  FOR SELECT USING (true);

CREATE POLICY "tenants_insert_signup" ON "tenants"
  FOR INSERT WITH CHECK (true);

CREATE POLICY "tenants_update_self" ON "tenants"
  FOR UPDATE USING (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- No DELETE policy for the app role -> tenant deletion is denied by
-- default at the DB layer and must go through owner-level tooling.

-- users
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;

CREATE POLICY "users_tenant_isolation" ON "users"
  USING (
    ("tenantId" IS NOT NULL AND "tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    OR
    ("tenantId" IS NULL AND NULLIF(current_setting('app.tenant_id', true), '') IS NULL)
  )
  WITH CHECK (
    ("tenantId" IS NOT NULL AND "tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    OR
    ("tenantId" IS NULL AND NULLIF(current_setting('app.tenant_id', true), '') IS NULL)
  );

-- refresh_tokens
ALTER TABLE "refresh_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "refresh_tokens" FORCE ROW LEVEL SECURITY;

CREATE POLICY "refresh_tokens_tenant_isolation" ON "refresh_tokens"
  USING (
    ("tenantId" IS NOT NULL AND "tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    OR
    ("tenantId" IS NULL AND NULLIF(current_setting('app.tenant_id', true), '') IS NULL)
  )
  WITH CHECK (
    ("tenantId" IS NOT NULL AND "tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    OR
    ("tenantId" IS NULL AND NULLIF(current_setting('app.tenant_id', true), '') IS NULL)
  );

-- audit_logs
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;

CREATE POLICY "audit_logs_tenant_isolation" ON "audit_logs"
  USING (
    ("tenantId" IS NOT NULL AND "tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    OR
    ("tenantId" IS NULL AND NULLIF(current_setting('app.tenant_id', true), '') IS NULL)
  )
  WITH CHECK (
    ("tenantId" IS NOT NULL AND "tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    OR
    ("tenantId" IS NULL AND NULLIF(current_setting('app.tenant_id', true), '') IS NULL)
  );
