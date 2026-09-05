/**
 * Shared helpers for the "log in with your ID instead of email" feature.
 * A student (or non-admin staff member) may have no email at all — see
 * User.loginId's doc comment in schema.prisma — so the single "email"
 * field on the login form now accepts either a real email address or the
 * system-generated code (StaffProfile.employeeCode / Student.studentCode)
 * printed on their credentials slip. Which one the caller typed is
 * decided purely by whether it contains "@" — matching how the feature
 * was specified: no separate "login type" toggle, no guessing.
 */

/** True if the given login string is email-shaped — the sole signal used to distinguish an email login from an ID login. */
export function looksLikeEmail(value: string): boolean {
  return value.includes('@');
}

/**
 * Normalizes a generated ID — or a user's attempt at typing one — into a
 * comparable login key: trimmed, lowercased, and with every "-" removed.
 * "EDU-EMP-000001", "eduemp000001", and " Edu-Emp-000001 " all normalize
 * to the same "eduemp000001", so a user can type the code with or without
 * its dashes, in any case, and still log in. Stored on User.loginId at
 * account-creation time from the account's own generated code; the same
 * function is applied again to whatever the user types at login, and the
 * two are compared for an exact match.
 */
export function normalizeLoginId(value: string): string {
  return value.trim().toLowerCase().replace(/-/g, '');
}
