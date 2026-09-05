// Base class for all "expected" application errors (validation failures,
// auth failures, not-found, conflicts, ...). Anything NOT thrown as an
// AppError is treated as an unexpected bug by the global error handler and
// gets a generic 500 response (so we never leak internals to clients).
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational = true;
  public readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message: string, details?: unknown) {
    return new AppError(400, 'BAD_REQUEST', message, details);
  }
  static unauthorized(message = 'Unauthorized') {
    return new AppError(401, 'UNAUTHORIZED', message);
  }
  static forbidden(message = 'Forbidden') {
    return new AppError(403, 'FORBIDDEN', message);
  }
  static notFound(message = 'Not found') {
    return new AppError(404, 'NOT_FOUND', message);
  }
  static conflict(message: string, details?: unknown) {
    return new AppError(409, 'CONFLICT', message, details);
  }
  static tooManyRequests(message = 'Too many requests') {
    return new AppError(429, 'TOO_MANY_REQUESTS', message);
  }
  /** A tenant's current subscription plan doesn't allow the requested operation (e.g. student/staff/SMS quota reached). */
  static planLimitExceeded(message: string, details?: unknown) {
    return new AppError(402, 'PLAN_LIMIT_EXCEEDED', message, details);
  }
}
