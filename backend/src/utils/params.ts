import type { Request } from 'express';
import { AppError } from './AppError';

/**
 * Express 5's ParamsDictionary types route params as `string | string[]`
 * (to support repeated-segment routes). None of our routes use those, so
 * this narrows to a plain string and fails loudly if that assumption is
 * ever wrong, rather than silently mis-querying the database.
 */
export function param(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw AppError.badRequest(`Missing or invalid route parameter: ${name}`);
  }
  return value;
}

// Every Prisma model in this schema uses a `@db.Uuid` primary key, so a
// route param naming a record id (`:id`, `:studentId`, `:examId`, ...) is
// always expected to be a UUID. Passing a non-UUID string straight to
// Prisma (`where: { id: "not-a-uuid" }`) throws a raw Postgres
// "invalid input syntax for type uuid" error that the global error handler
// treats as an unexpected 500 — a malformed URL segment shouldn't crash
// into an internal-error response. Validating the shape here rejects it
// with a clean 400 before it ever reaches the database.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function uuidParam(req: Request, name: string): string {
  const value = param(req, name);
  if (!UUID_RE.test(value)) {
    throw AppError.badRequest(`Invalid route parameter: ${name} must be a UUID`);
  }
  return value;
}
