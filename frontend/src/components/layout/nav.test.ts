import { describe, it, expect } from "vitest";
import { navItemsForRole } from "./nav";

describe("navItemsForRole", () => {
  it("returns an empty list when there is no role", () => {
    expect(navItemsForRole(undefined)).toHaveLength(0);
  });

  it("shows platform-only items to SUPER_ADMIN and hides tenant modules", () => {
    const items = navItemsForRole("SUPER_ADMIN");
    const hrefs = items.map((i) => i.href);
    expect(hrefs).toContain("/dashboard/platform/tenants");
    expect(hrefs).not.toContain("/dashboard/students");
  });

  it("hides staff/payroll and platform items from TEACHER", () => {
    const items = navItemsForRole("TEACHER");
    const hrefs = items.map((i) => i.href);
    expect(hrefs).toContain("/dashboard/attendance");
    expect(hrefs).not.toContain("/dashboard/staff");
    expect(hrefs).not.toContain("/dashboard/platform/tenants");
  });

  // A SCHOOL_ADMIN can't be assigned as a section-subject's teacher (see
  // the backend's assertTeacherRole), so GET /api/timetable/me — and this
  // nav item pointing at it — is TEACHER-only.
  it("shows the Timetable link to TEACHER but not SCHOOL_ADMIN", () => {
    expect(navItemsForRole("TEACHER").map((i) => i.href)).toContain("/dashboard/timetable");
    expect(navItemsForRole("SCHOOL_ADMIN").map((i) => i.href)).not.toContain("/dashboard/timetable");
  });

  it("gives SCHOOL_ADMIN access to every tenant-scoped module", () => {
    const items = navItemsForRole("SCHOOL_ADMIN");
    const hrefs = items.map((i) => i.href);
    expect(hrefs).toEqual(
      expect.arrayContaining([
        "/dashboard",
        "/dashboard/students",
        "/dashboard/academics",
        "/dashboard/attendance",
        "/dashboard/exams",
        "/dashboard/fees",
        "/dashboard/staff",
        "/dashboard/staff/payroll",
        "/dashboard/notifications",
      ]),
    );
  });
});
