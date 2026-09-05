import { z } from 'zod';

const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected date in YYYY-MM-DD format')
  .transform((v) => new Date(`${v}T00:00:00.000Z`));

const monthSchema = z.string().regex(/^\d{4}-\d{2}$/, 'Expected month in YYYY-MM format');

export const STAFF_ROLES = ['SCHOOL_ADMIN', 'TEACHER', 'ACCOUNTANT', 'FRONT_DESK'] as const;

export const createStaffSchema = z
  .object({
    // Optional for everyone EXCEPT SCHOOL_ADMIN (the "Principal" role —
    // see the refine below), since every non-admin staff member now gets
    // a login ID (StaffProfile.employeeCode, dashes/case ignored) that
    // works on its own — email is just an optional extra, used only to
    // also receive the credentials by mail when one happens to exist. A
    // SCHOOL_ADMIN still requires a real email: they're the account an
    // admin-level password reset/recovery has to be able to reach.
    email: z.string().email().max(255).optional(),
    fullName: z.string().min(1).max(150),
    phone: z.string().max(30).optional(),
    role: z.enum(STAFF_ROLES),
    designation: z.string().min(1).max(100),
    department: z.string().max(100).optional(),
    employmentType: z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT']).default('FULL_TIME'),
    joiningDate: dateOnlySchema,
    cnic: z.string().max(30).optional(),
    // Personal detail for the staff member's own "My Profile" → Bio Data tab
    // (read-only to them, admin/front-desk-entered here — see
    // updateMyStaffProfileSchema below for what IS self-editable).
    dateOfBirth: dateOnlySchema.optional(),
    gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
    address: z.string().max(300).optional(),
    emergencyContact: z.string().max(100).optional(),
    monthlySalary: z.coerce.number().positive().max(10_000_000),
    // Lets the admin attach a photo at creation time, from POST
    // /api/uploads/image the same way ImageUploadButton is used everywhere
    // else. Previously missing entirely — a staff member's own self-service
    // PATCH /api/staff/me (updateMyStaffProfileSchema below) has always
    // accepted a photo, so a teacher setting their own picture worked, but
    // an admin had no way to set one while adding the staff member, and
    // updateStaffSchema's photoUrl (admin edit, further below) had no UI
    // wired to it either. See staff.ts's staffRouter.post('/') for how this
    // is stored.
    photoUrl: z.string().url().max(500).optional(),
  })
  .refine((data) => data.role !== 'SCHOOL_ADMIN' || !!data.email, {
    message: 'An email is required for the School Admin role',
    path: ['email'],
  });
export type CreateStaffInput = z.infer<typeof createStaffSchema>;

export const updateStaffSchema = z.object({
  designation: z.string().min(1).max(100).optional(),
  department: z.string().max(100).optional(),
  employmentType: z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT']).optional(),
  status: z.enum(['ACTIVE', 'ON_LEAVE', 'TERMINATED']).optional(),
  leavingDate: dateOnlySchema.optional(),
  cnic: z.string().max(30).optional(),
  dateOfBirth: dateOnlySchema.optional(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
  address: z.string().max(300).optional(),
  emergencyContact: z.string().max(100).optional(),
  monthlySalary: z.coerce.number().positive().max(10_000_000).optional(),
  phone: z.string().max(30).optional(),
  fullName: z.string().min(1).max(150).optional(),
  // Edits the staff member's portal LOGIN email (User.email) — checked for
  // tenant-wide uniqueness the same way as at staff creation.
  email: z.string().email().max(255).optional(),
  photoUrl: z.string().url().max(500).optional(),
});
export type UpdateStaffInput = z.infer<typeof updateStaffSchema>;

// Narrow sibling of updateStaffSchema for PATCH /api/staff/:id/salary — the
// full staff edit (name, contact info, status, Bio Data, ...) stays
// SCHOOL_ADMIN-only (WRITE_ROLES), but a school's Accountant sets teacher/
// staff pay rates as part of their job and previously had no route that let
// them touch monthlySalary without also being handed every other field on
// the record. Zod strips unknown keys by default (non-strict object), so
// even a client that sends other fields here has them silently dropped —
// this endpoint can never be used to smuggle a broader edit through.
export const updateStaffSalarySchema = z.object({
  monthlySalary: z.coerce.number().positive().max(10_000_000),
});
export type UpdateStaffSalaryInput = z.infer<typeof updateStaffSalarySchema>;

// Self-service — GET/PATCH /api/staff/me. Deliberately limited to photo +
// address + emergencyContact: everything else on a staff record
// (designation, salary, status, CNIC, dateOfBirth, gender — the Bio Data
// tab) is admin-managed, not something a staff member should be able to
// edit on themselves. Mirrors updateProfileSchema's "email/phone only"
// scoping on the auth side for the same reason (email/phone are edited via
// PATCH /api/auth/me instead, not here).
export const updateMyStaffProfileSchema = z
  .object({
    photoUrl: z.string().url().max(500).optional(),
    address: z.string().max(300).optional(),
    emergencyContact: z.string().max(100).optional(),
  })
  .refine((data) => data.photoUrl !== undefined || data.address !== undefined || data.emergencyContact !== undefined, {
    message: 'Provide at least one field to update',
  });
export type UpdateMyStaffProfileInput = z.infer<typeof updateMyStaffProfileSchema>;

export const listStaffQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(150).optional(),
  status: z.enum(['ACTIVE', 'ON_LEAVE', 'TERMINATED']).optional(),
  department: z.string().max(100).optional(),
});

export const generatePayrollSchema = z.object({
  staffProfileId: z.string().uuid(),
  month: monthSchema,
  allowances: z.coerce.number().min(0).max(10_000_000).default(0),
  deductions: z.coerce.number().min(0).max(10_000_000).default(0),
});
export type GeneratePayrollInput = z.infer<typeof generatePayrollSchema>;

/**
 * One month, every active staff member — the bulk counterpart of
 * generatePayrollSchema, for "it's the 1st of the month, generate
 * everyone's payslip" instead of repeating the single-staff form once per
 * employee. No allowances/deductions here (those are per-person by
 * nature); a staff member who needs either can still be regenerated
 * individually via POST /generate after this runs, same as any other
 * exception-handling flow in this app.
 */
export const bulkGeneratePayrollSchema = z.object({
  month: monthSchema,
});
export type BulkGeneratePayrollInput = z.infer<typeof bulkGeneratePayrollSchema>;

export const listPayrollQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  month: monthSchema.optional(),
  status: z.enum(['PENDING', 'PAID']).optional(),
  staffProfileId: z.string().uuid().optional(),
});

export const createLeaveRequestSchema = z
  .object({
    leaveType: z.enum(['SICK', 'CASUAL', 'ANNUAL', 'UNPAID', 'OTHER']),
    fromDate: dateOnlySchema,
    toDate: dateOnlySchema,
    reason: z.string().min(2).max(1000),
  })
  .refine((v) => v.toDate >= v.fromDate, { message: 'toDate must be on or after fromDate', path: ['toDate'] });
export type CreateLeaveRequestInput = z.infer<typeof createLeaveRequestSchema>;

export const reviewLeaveRequestSchema = z.object({
  reviewNote: z.string().max(500).optional(),
});

export const listLeaveRequestsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
  staffProfileId: z.string().uuid().optional(),
});
