import type { Request, Response, NextFunction } from 'express';
import { requireRole } from '../../src/middleware/auth';
import { AppError } from '../../src/utils/AppError';

/**
 * Isolated unit coverage for `requireRole`'s default-deny behavior — every
 * module has an indirect "wrong role gets 403" integration test already,
 * but the middleware's own core logic (deny unless the caller's role is
 * explicitly in the allow-list, including the "no req.auth at all" case)
 * had never been tested directly in isolation.
 */
describe('requireRole middleware', () => {
  function callWith(role: string | undefined, allowedRoles: string[]) {
    const req = { auth: role ? { userId: 'u1', tenantId: 't1', role } : undefined } as unknown as Request;
    const next = jest.fn() as unknown as NextFunction;
    const middleware = requireRole(...(allowedRoles as never[]));
    let thrown: unknown;
    try {
      middleware(req, {} as Response, next);
    } catch (err) {
      thrown = err;
    }
    return { next, thrown };
  }

  it('denies by default when the caller\'s role is not in the allow-list', () => {
    const { next, thrown } = callWith('TEACHER', ['SCHOOL_ADMIN', 'ACCOUNTANT']);
    expect(next).not.toHaveBeenCalled();
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).statusCode).toBe(403);
  });

  it('denies a role that simply does not exist in the allow-list at all (unassigned/unknown role)', () => {
    const { next, thrown } = callWith('SOME_FUTURE_ROLE', ['SCHOOL_ADMIN', 'TEACHER', 'ACCOUNTANT', 'FRONT_DESK']);
    expect(next).not.toHaveBeenCalled();
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).statusCode).toBe(403);
  });

  it('denies when there is no req.auth at all (requireAuth was skipped or failed silently)', () => {
    const { next, thrown } = callWith(undefined, ['SCHOOL_ADMIN']);
    expect(next).not.toHaveBeenCalled();
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).statusCode).toBe(401);
  });

  it('allows through and calls next() exactly once when the role IS in the allow-list', () => {
    const { next, thrown } = callWith('SCHOOL_ADMIN', ['SCHOOL_ADMIN', 'ACCOUNTANT']);
    expect(thrown).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('is closed-by-default for an empty allow-list — no role can ever pass', () => {
    const { next, thrown } = callWith('SCHOOL_ADMIN', []);
    expect(next).not.toHaveBeenCalled();
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).statusCode).toBe(403);
  });
});
