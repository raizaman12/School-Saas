import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { runWithRequestId } from '../lib/requestContext';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      id: string;
    }
  }
}

/**
 * Correlates every log line produced while handling a request — trusts an
 * inbound `X-Request-Id` when present (so a request can be traced across
 * a reverse proxy / upstream service that already assigned one), otherwise
 * mints a fresh UUID. Echoed back on the response so a client (or the
 * proxy) can report "this exact request" when following up on an error.
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const inbound = req.headers['x-request-id'];
  const requestId = typeof inbound === 'string' && inbound.length > 0 ? inbound : randomUUID();
  req.id = requestId;
  res.setHeader('X-Request-Id', requestId);
  runWithRequestId(requestId, next);
}
