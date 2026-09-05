import type { Server } from 'http';
import { createApp } from './app';
import { env } from './config/env';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { assertRlsIsEnforcedOrLog } from './lib/dbSafety';
import { closePdfBrowser, warmUpPdfBrowser } from './lib/pdfBrowser';

const app = createApp();

let server: Server | undefined;

async function start() {
  // See dbSafety.ts's doc comment — every tenant-isolation guarantee in
  // this app rests on Postgres Row-Level Security being enforced for
  // whatever role DATABASE_URL connects as. Checking this once before
  // binding the port turns "silently serves every tenant's data mixed
  // together, with nothing in the response to hint anything is wrong"
  // into "refuses to start, with a log line telling you exactly why".
  const rlsOk = await assertRlsIsEnforcedOrLog(prisma);
  if (!rlsOk) {
    await prisma.$disconnect();
    process.exit(1);
    return;
  }

  server = app.listen(env.PORT, () => {
    logger.info(`🚀 API listening on port ${env.PORT} [${env.NODE_ENV}]`);
    // Pre-launch headless Chromium now rather than on whichever request
    // happens to ask for the first PDF — see warmUpPdfBrowser()'s doc comment.
    warmUpPdfBrowser();
  });
}

start().catch((err) => {
  logger.error('Failed to start server', { err: (err as Error)?.message });
  process.exitCode = 1;
});

async function shutdown(signal: string) {
  logger.info(`${signal} received — shutting down gracefully`);
  if (!server) {
    // Startup never finished binding a port (e.g. the RLS check above is
    // still in flight, or already refused to start) — nothing to close.
    await Promise.all([prisma.$disconnect(), closePdfBrowser()]);
    process.exit(0);
    return;
  }
  server.close(async () => {
    await Promise.all([prisma.$disconnect(), closePdfBrowser()]);
    process.exit(0);
  });

  // Force-exit if shutdown hangs.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason });
});
