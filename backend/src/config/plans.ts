import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma';

export interface PlanDefinition {
  id: string;
  code: string;
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
  active: boolean;
  sortOrder: number;
}

type Client = PrismaClient | Prisma.TransactionClient;

/**
 * The subscription-tier catalog used to be a fixed, static TS object
 * (PLAN_CATALOG, keyed by the TenantPlan Prisma enum) — deliberately kept
 * as config rather than a DB table "for now", with a comment flagging this
 * exact file as the one place to swap in a `Plan` table without touching
 * any call site. That's what this file now does: every function below
 * keeps the same PlanDefinition shape and the same call signatures
 * (`listPlans()`, plus the new `getPlan(code)`) so planLimits.ts,
 * platform/tenants.ts, etc. needed only a one-line change each (static
 * lookup -> await a DB read).
 */
function toDefinition(row: {
  id: string;
  code: string;
  name: string;
  priceMonthlyPKR: number;
  maxStudents: number | null;
  maxStaff: number | null;
  maxSmsCreditsPerMonth: number | null;
  features: Prisma.JsonValue;
  active: boolean;
  sortOrder: number;
}): PlanDefinition {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    priceMonthlyPKR: row.priceMonthlyPKR,
    maxStudents: row.maxStudents,
    maxStaff: row.maxStaff,
    maxSmsCreditsPerMonth: row.maxSmsCreditsPerMonth,
    features: Array.isArray(row.features) ? (row.features as string[]) : [],
    active: row.active,
    sortOrder: row.sortOrder,
  };
}

export async function getPlan(code: string, client: Client = prisma): Promise<PlanDefinition | null> {
  const row = await client.plan.findUnique({ where: { code } });
  return row ? toDefinition(row) : null;
}

export async function listPlans(
  opts: { includeInactive?: boolean } = {},
  client: Client = prisma,
): Promise<PlanDefinition[]> {
  const rows = await client.plan.findMany({
    where: opts.includeInactive ? undefined : { active: true },
    orderBy: { sortOrder: 'asc' },
  });
  return rows.map(toDefinition);
}
