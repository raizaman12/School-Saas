import { PrismaClient } from '@prisma/client';

// A privileged client (BYPASSRLS owner role) used only by tests to reset
// state between specs. The app itself never uses this connection.
export const ownerDb = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_MIGRATE_URL } },
});

export async function resetDb() {
  await ownerDb.$executeRawUnsafe(
    `TRUNCATE TABLE
      "audit_logs", "refresh_tokens",
      "notifications",
      "payroll_records", "staff_profiles",
      "late_fee_policies", "payments", "invoice_line_items", "invoices", "fee_structure_items", "fee_categories",
      "report_card_batch_jobs", "grading_bands", "marks", "exam_subjects", "exams",
      "attendance_records",
      "timetable_slots", "section_subjects", "subjects",
      "transfer_certificates", "enrollments", "student_guardians", "guardians", "students",
      "sections", "school_classes", "academic_years",
      "users", "tenants",
      -- school_groups is referenced BY tenants (tenants.schoolGroupId),
      -- not the other way around, so truncating "tenants" above does NOT
      -- cascade to it automatically (TRUNCATE CASCADE only cascades to
      -- tables that reference the truncated table, not tables it itself
      -- references) — must be listed explicitly or its rows (and slug
      -- uniqueness) would leak across every test in the run.
      "school_groups"
    RESTART IDENTITY CASCADE;`,
  );
}

export async function disconnectDb() {
  await ownerDb.$disconnect();
}
