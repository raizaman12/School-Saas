-- AlterTable
ALTER TABLE "users" ADD COLUMN     "loginId" TEXT,
ALTER COLUMN "email" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "users_tenantId_loginId_key" ON "users"("tenantId", "loginId");
