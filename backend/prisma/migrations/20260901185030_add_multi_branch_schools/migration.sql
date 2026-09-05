-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "branchName" TEXT,
ADD COLUMN     "schoolGroupId" UUID;

-- CreateTable
CREATE TABLE "school_groups" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "school_groups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "school_groups_slug_key" ON "school_groups"("slug");

-- CreateIndex
CREATE INDEX "tenants_schoolGroupId_idx" ON "tenants"("schoolGroupId");

-- AddForeignKey
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_schoolGroupId_fkey" FOREIGN KEY ("schoolGroupId") REFERENCES "school_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ============================================================
-- Row Level Security for the new school_groups table.
-- Mirrors the `tenants` table's own documented rationale exactly (see
-- prisma/migrations/20260815214539_init/migration.sql): a SchoolGroup row
-- is not itself tenant-scoped (nothing here is student/fee/academic data),
-- and reads must be open because resolving a login URL to a school/group
-- happens pre-authentication, before any app.tenant_id context exists.
-- ============================================================

ALTER TABLE "school_groups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "school_groups" FORCE ROW LEVEL SECURITY;

CREATE POLICY "school_groups_select_all" ON "school_groups"
  FOR SELECT USING (true);

CREATE POLICY "school_groups_insert_signup" ON "school_groups"
  FOR INSERT WITH CHECK (true);

-- No UPDATE/DELETE policy for the app role -> a school_groups row is never
-- mutated after creation by this feature; changes must go through
-- owner-level tooling, same convention as `tenants` having no DELETE policy.
