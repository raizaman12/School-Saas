import winston from 'winston';
import { env } from '../config/env';
import { getRequestId } from './requestContext';

// Injects the current request's correlation id (see requestId middleware +
// requestContext.ts) into every log line automatically — call sites never
// need to pass it explicitly, so this works retroactively for every
// existing `logger.info/warn/error(...)` call across the codebase, not
// just ones written after correlation ids were added. Falls back to
// nothing outside a request (startup logs, background jobs not run via
// runWithRequestId, ...).
const withRequestId = winston.format((info) => {
  const requestId = getRequestId();
  if (requestId) info.requestId = requestId;
  return info;
});

// Structured (JSON) logging in production so logs are machine-parseable by
// whatever aggregator we point at later (CloudWatch/Loki/etc). Pretty
// console output locally for readability.
export const logger = winston.createLogger({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  silent: env.NODE_ENV === 'test',
  format:
    env.NODE_ENV === 'production'
      ? winston.format.combine(withRequestId(), winston.format.timestamp(), winston.format.json())
      : winston.format.combine(
          withRequestId(),
          winston.format.colorize(),
          winston.format.timestamp({ format: 'HH:mm:ss' }),
          winston.format.printf(({ level, message, timestamp, ...meta }) => {
            const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
            return `${timestamp} ${level}: ${message}${metaStr}`;
          }),
        ),
  transports: [new winston.transports.Console()],
});
