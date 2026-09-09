export type UserRole =
  | "SUPER_ADMIN"
  | "SCHOOL_ADMIN"
  | "TEACHER"
  | "ACCOUNTANT"
  | "FRONT_DESK"
  | "PARENT"
  | "STUDENT";

export interface AuthUser {
  id: string;
  tenantId: string | null;
  email: string;
  fullName: string;
  phone?: string | null;
  role: UserRole;
  status: string;
  lastLoginAt?: string | null;
  createdAt?: string;
}

export interface AuthTenant {
  id: string;
  name: string;
  slug: string;
  status: string;
  /** Chosen dashboard/portal accent-color theme id — see lib/theme. */
  themeId?: string;
}

export interface LoginInput {
  slug: string;
  email: string;
  password: string;
}

export interface PlatformLoginInput {
  email: string;
  password: string;
}

// Was a fixed "TRIAL" | "BASIC" | "STANDARD" | "PREMIUM" union — plans are
// now a Super Admin-editable DB table (backend's Plan model / config/plans.ts),
// so any plan `code` string is valid; see platformApi.listPlans() for the
// current live catalog and PlanDefinition for a plan's full shape.
export type TenantPlan = string;

export interface SignupInput {
  schoolName: string;
  slug: string;
  adminFullName: string;
  adminEmail: string;
  adminPassword: string;
  contactEmail?: string;
  contactPhone?: string;
  address?: string;
  city?: string;
  plan?: TenantPlan;
  /** Chosen dashboard/portal accent-color theme id — see lib/theme. */
  themeId?: string;
}

export interface SignupMultiBranchBranchInput {
  branchName: string;
  city: string;
  adminFullName: string;
  adminEmail: string;
  adminPassword: string;
}

export interface SignupMultiBranchInput {
  schoolName: string;
  slug: string;
  plan?: TenantPlan;
  themeId?: string;
  branches: SignupMultiBranchBranchInput[];
}

export interface SignupMultiBranchBranchResult {
  tenant: { id: string; name: string; slug: string; branchName: string | null };
  user: { id: string; email: string | null; fullName: string };
}

export interface SignupMultiBranchResult {
  schoolGroup: { id: string; name: string; slug: string };
  branches: SignupMultiBranchBranchResult[];
}

/**
 * The result of resolving a login-time school URL (see resources/tenant.ts's
 * resolveSchool) — either the URL belongs to one ordinary school (straight
 * to the login form) or to a multi-branch group's shared URL (show a
 * branch picker first). A tenant result carries branch/group context
 * whenever it's part of a group, whether the caller arrived by picking a
 * branch or by typing that branch's own real slug directly.
 */
export type ResolvedSchool =
  | {
      kind: "tenant";
      tenant: AuthTenant & {
        branchName: string | null;
        groupName: string | null;
        groupSlug: string | null;
      };
    }
  | {
      kind: "group";
      group: {
        id: string;
        name: string;
        slug: string;
        branches: { slug: string; branchName: string | null; city: string | null }[];
      };
    };
