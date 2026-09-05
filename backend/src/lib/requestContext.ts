import { AsyncLocalStorage } from 'async_hooks';

interface RequestContext {
  requestId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Runs `fn` with `requestId` available to every logger call made anywhere
 * in its async call chain (see logger.ts's format, which reads this),
 * without threading a `requestId` parameter through every function
 * signature in the codebase. Set up once by the requestId middleware at
 * the top of the middleware stack.
 */
export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return storage.run({ requestId }, fn);
}

export function getRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}
