-- AlterTable
ALTER TABLE "staff_profiles" ADD COLUMN     "dateOfBirth" DATE,
ADD COLUMN     "gender" "Gender";

-- AlterTable
ALTER TABLE "students" ADD COLUMN     "emergencyContact" TEXT;
