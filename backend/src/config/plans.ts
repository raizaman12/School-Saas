import type { TenantPlan } from '@prisma/client';

export interface PlanDefinition {
  code: TenantPlan;
  name: string;
  priceMonthlyPKR: number;
  maxStudents: number | null; // null = unlimited
  maxStaff: number | null;
  // SMS/WhatsApp sends allowed per calendar month (IN_APP and EMAIL are
  // never metered). null = unlimited, 0 = feature not available on this
  // tier. Usage is computed on read (COUNT of this month's Notification
  // rows on SMS/WHATSAPP channels) rather than stored as a running
  // counter — same "derive, don't track" approach already used for the
  // student/staff limits, and it needs no month-end reset job.
  maxSmsCreditsPerMonth: number | null;
  features: string[];
}

/**
 * Static subscription-tier catalog. A fixed, small set of tiers like this
 * is deliberately kept as config rather than a DB table for now — there's
 * no need for a platform admin to define arbitrary new tiers at runtime
 * yet. If/when that changes, this is the one place to replace with a
 * `Plan` table without touching any call site (same pattern as the
 * notification provider registry).
 */
export const PLAN_CATALOG: Record<TenantPlan, PlanDefinition> = {
  TRIAL: {
    code: 'TRIAL',
    name: 'Trial',
    priceMonthlyPKR: 0,
    maxStudents: 50,
    maxStaff: 10,
    maxSmsCreditsPerMonth: 0,
    features: ['Core SIS', 'Attendance', 'Basic fee management', '14-day trial'],
  },
  BASIC: {
    code: 'BASIC',
    name: 'Basic',
    priceMonthlyPKR: 5000,
    maxStudents: 300,
    maxStaff: 30,
    maxSmsCreditsPerMonth: 0,
    features: ['Core SIS', 'Attendance', 'Fee management', 'Exams & report cards'],
  },
  STANDARD: {
    code: 'STANDARD',
    name: 'Standard',
    priceMonthlyPKR: 12000,
    maxStudents: 1000,
    maxStaff: 100,
    maxSmsCreditsPerMonth: 1000,
    features: ['Everything in Basic', 'HR & payroll', 'SMS/WhatsApp notifications (1000/mo)', 'Parent portal'],
  },
  PREMIUM: {
    code: 'PREMIUM',
    name: 'Premium',
    priceMonthlyPKR: 25000,
    maxStudents: null,
    maxStaff: null,
    maxSmsCreditsPerMonth: null,
    features: ['Everything in Standard', 'Unlimited students & staff', 'Unlimited SMS/WhatsApp', 'Priority support'],
  },
};

export function listPlans(): PlanDefinition[] {
  return Object.values(PLAN_CATALOG);
}
