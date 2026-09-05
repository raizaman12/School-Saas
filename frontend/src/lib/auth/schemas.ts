import { z } from "zod";

// Mirrors the backend's validation (src/modules/auth/auth.validation.ts) so
// the user gets the same feedback client-side before a round trip.
const slugSchema = z
  .string()
  // A stray leading/trailing space — easy to pick up from autocomplete,
  // copy-paste, or a mobile keyboard's auto-space-after-word — would
  // otherwise fail the regex below with a confusing "lowercase letters,
  // numbers and hyphens only" error even though the slug itself is fine.
  .trim()
  .min(3)
  .max(63)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lowercase letters, numbers and hyphens only");

const passwordSchema = z
  .string()
  .min(8, "Must be at least 8 characters")
  .max(72)
  .regex(/[a-z]/, "Must contain a lowercase letter")
  .regex(/[A-Z]/, "Must contain an uppercase letter")
  .regex(/[0-9]/, "Must contain a number");

// Named `email` for backward compatibility with the field the app has
// always posted, but it now accepts EITHER a real email address OR a
// system-generated login ID (staff employeeCode / student studentCode,
// dashes/case ignored — see the backend's lib/loginId.ts). The backend
// decides which one this is purely by whether it contains "@", so no
// `.email()` format check here — just "something was typed".
export const loginSchema = z.object({
  slug: slugSchema,
  email: z.string().trim().min(1, "Required"),
  password: z.string().min(1),
});
export type LoginFormValues = z.infer<typeof loginSchema>;

export const platformLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type PlatformLoginFormValues = z.infer<typeof platformLoginSchema>;

export const PLAN_OPTIONS = [
  { value: "TRIAL", label: "Trial — free for 14 days" },
  { value: "BASIC", label: "Basic — Rs 5,000/mo" },
  { value: "STANDARD", label: "Standard — Rs 12,000/mo" },
  { value: "PREMIUM", label: "Premium — Rs 25,000/mo" },
] as const;

export const signupSchema = z.object({
  schoolName: z.string().min(2).max(150),
  slug: slugSchema,
  adminFullName: z.string().min(2).max(150),
  adminEmail: z.string().email(),
  adminPassword: passwordSchema,
  // Set via useForm's `defaultValues` from the plan-selection wizard step
  // rather than a registered input (there's no <input name="plan">) — RHF
  // still carries defaultValues through validation for unregistered
  // fields, and the submit handler also merges the selected plan in
  // explicitly as a second safety net (see onSubmit below).
  plan: z.enum(['TRIAL', 'BASIC', 'STANDARD', 'PREMIUM']),
  // Same pattern as `plan` above, but for the theme-picker wizard step —
  // not validated against a fixed id list here (that catalog is fetched
  // from the backend, see lib/theme), the backend rejects an unknown id.
  themeId: z.string().min(1),
});
export type SignupFormValues = z.infer<typeof signupSchema>;

// Multi-branch registration — mirrors the backend's signupMultiBranchSchema
// (auth.validation.ts). `slug` here is the shared GROUP login URL; each
// branch's own internal tenant slug is derived server-side, never entered
// here. `useFieldArray`-friendly: `branches` is a plain array of objects.
export const signupMultiBranchSchema = z.object({
  schoolName: z.string().min(2).max(150),
  slug: slugSchema,
  branches: z
    .array(
      z.object({
        branchName: z.string().min(2, "Required").max(100),
        city: z.string().min(1, "Required").max(100),
        adminFullName: z.string().min(2, "Required").max(150),
        adminEmail: z.string().email(),
        adminPassword: passwordSchema,
      }),
    )
    .min(2, "Add at least 2 branches"),
});
export type SignupMultiBranchFormValues = z.infer<typeof signupMultiBranchSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Required"),
    newPassword: passwordSchema,
    confirmNewPassword: z.string().min(1, "Required"),
  })
  .refine((d) => d.newPassword === d.confirmNewPassword, {
    message: "New password and confirmation do not match",
    path: ["confirmNewPassword"],
  })
  .refine((d) => d.currentPassword !== d.newPassword, {
    message: "New password must be different from the current password",
    path: ["newPassword"],
  });
export type ChangePasswordFormValues = z.infer<typeof changePasswordSchema>;

export const forgotPasswordSchema = z.object({
  slug: slugSchema,
  email: z.string().email(),
});
export type ForgotPasswordFormValues = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordCodeSchema = z
  .object({
    token: z.string().min(1, "Required"),
    newPassword: passwordSchema,
    confirmNewPassword: z.string().min(1, "Required"),
  })
  .refine((d) => d.newPassword === d.confirmNewPassword, {
    message: "New password and confirmation do not match",
    path: ["confirmNewPassword"],
  });
export type ResetPasswordCodeFormValues = z.infer<typeof resetPasswordCodeSchema>;

// Self-service "edit my own contact info" — same fields for every role;
// see the backend's authService.updateMe for where "phone" actually lands
// depending on role.
export const updateProfileSchema = z.object({
  email: z.string().email("Enter a valid email"),
  phone: z
    .string()
    .max(30, "Must be 30 characters or fewer")
    .optional()
    .or(z.literal("")),
});
export type UpdateProfileFormValues = z.infer<typeof updateProfileSchema>;

// Student portal's My Profile → About tab — same email/phone as above, plus
// the two Student-only self-editable fields (see backend updateMeSchema's
// doc comment for why these don't exist for other roles).
export const updateStudentContactSchema = z.object({
  email: z.string().email("Enter a valid email"),
  phone: z
    .string()
    .max(30, "Must be 30 characters or fewer")
    .optional()
    .or(z.literal("")),
  address: z.string().max(255, "Must be 255 characters or fewer").optional().or(z.literal("")),
  emergencyContact: z.string().max(100, "Must be 100 characters or fewer").optional().or(z.literal("")),
});
export type UpdateStudentContactFormValues = z.infer<typeof updateStudentContactSchema>;

// Staff dashboard's My Profile → About tab, via PATCH /api/staff/me
// (address/emergencyContact) — email/phone still go through
// updateProfileSchema/PATCH /api/auth/me separately, unchanged.
export const updateStaffContactSchema = z.object({
  address: z.string().max(300, "Must be 300 characters or fewer").optional().or(z.literal("")),
  emergencyContact: z.string().max(100, "Must be 100 characters or fewer").optional().or(z.literal("")),
});
export type UpdateStaffContactFormValues = z.infer<typeof updateStaffContactSchema>;
