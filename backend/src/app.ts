import express from 'express';
import path from 'path';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import { env } from './config/env';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { isSubdomainOfOrigin } from './utils/subdomain';
import { globalRateLimiter } from './middleware/rateLimiter';
import { requestIdMiddleware } from './middleware/requestId';
import { notFoundHandler, errorHandler } from './middleware/errorHandler';
import { authRouter } from './modules/auth/auth.routes';
import { sisRouter } from './modules/sis';
import { academicsRouter } from './modules/academics';
import { attendanceRouter } from './modules/attendance/attendance';
import { holidaysRouter } from './modules/attendance/holidays';
import { examsRouter } from './modules/exams/exams';
import { classTestsRouter } from './modules/exams/classTests';
import { gradingBandsRouter } from './modules/exams/gradingBands';
import { reportCardBatchRouter } from './modules/exams/reportCardBatch';
import { feesRouter } from './modules/fees';
import { staffModuleRouter } from './modules/staff';
import { notificationsRouter } from './modules/notifications';
import { portalModuleRouter } from './modules/portal';
import { platformRouter } from './modules/platform';
import { noticesRouter } from './modules/notices/notices';
import { tenantRouter } from './modules/tenant/tenant';
import { uploadsRouter } from './modules/uploads/uploads';
import { disciplineModuleRouter } from './modules/discipline';
import { supportNeedsModuleRouter } from './modules/supportNeeds';
import { healthModuleRouter } from './modules/health';
import { analyticsModuleRouter } from './modules/analytics';
import { customFieldsModuleRouter } from './modules/customFields';
import { examGeneratorModuleRouter } from './modules/examGenerator';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1); // needed for correct req.ip behind a reverse proxy/load balancer

  // First in the stack — every downstream middleware/route/log line runs
  // inside this request's AsyncLocalStorage context, so logger.ts can
  // attach `requestId` to every log line without each call site passing
  // it explicitly. See src/lib/requestContext.ts.
  app.use(requestIdMiddleware);

  app.use(helmet());
  const corsAllowlist = env.CORS_ORIGIN.split(',').map((s) => s.trim());
  app.use(
    cors({
      // A static allowlist can't express "any school's subdomain" — the
      // browser treats alpha-school.example.com and beta-school.example.com
      // as distinct origins even though they're the same app. So: exact
      // match against CORS_ORIGIN first (covers the marketing site, the
      // bare app domain, etc.), then fall back to the wildcard subdomain
      // check when CORS_WILDCARD_DOMAIN is configured. Requests with no
      // Origin header (curl, server-to-server, same-origin) are allowed
      // through, same as cors()'s own default behavior.
      origin: (origin, callback) => {
        if (!origin || corsAllowlist.includes(origin)) {
          callback(null, true);
          return;
        }
        if (env.CORS_WILDCARD_DOMAIN && isSubdomainOfOrigin(origin, env.CORS_WILDCARD_DOMAIN)) {
          callback(null, true);
          return;
        }
        // Reject without an Error: cors() treats callback(null, false) as
        // "no CORS headers, but let the request continue" (next() with no
        // error), matching the browser-side effect of a same-origin
        // request. Passing an Error instead would 500 every disallowed
        // cross-origin request, which is unnecessary noise — the browser
        // is what actually blocks the response from being read.
        callback(null, false);
      },
      credentials: true,
    }),
  );
  app.use(compression());

  // Public, unauthenticated file serving for uploaded images (student/staff
  // photos, school logo) — see uploads.ts's doc comment for why this isn't
  // an auth-gated streaming route like reportCardBatch.ts's zip download.
  // Mounted ahead of the global rate limiter so a page rendering dozens of
  // <img> tags never competes with that tenant's own API request budget.
  //
  // helmet() above sets `Cross-Origin-Resource-Policy: same-origin` on every
  // response by default (a Spectre-era protection against other origins
  // reading your API's JSON via a <script>/<img> side-channel). That's the
  // right default for the JSON API, but it also silently blocks the exact
  // thing this route exists for: the frontend (its own origin — a
  // different port, e.g. localhost:3000 vs this API's localhost:4000, or
  // <slug>.<appDomain> vs the bare API host in production) loading a
  // student/staff photo via a plain <img src="...">. Chrome enforces this
  // client-side with no server-visible request and no way to opt out from
  // the requesting page's side — the fix has to live here, on the
  // response. A plain <img> load isn't a CORS request (no Origin
  // negotiation), so the cors() middleware's Access-Control-Allow-Origin
  // above doesn't help; CORP is a separate, independent check. Since this
  // route is explicitly "public, unauthenticated" already, there's no
  // additional exposure in telling the browser these specific responses
  // are intentionally OK to load cross-origin.
  app.use('/uploads', (_req, res, next) => {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
  });
  app.use('/uploads', express.static(path.resolve(env.STORAGE_DIR, 'uploads'), { maxAge: '7d' }));

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(cookieParser());
  app.use(globalRateLimiter);

  if (env.NODE_ENV !== 'test') {
    app.use(
      morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev', {
        stream: { write: (msg) => logger.info(msg.trim()) },
      }),
    );
  }

  // Checks actual DB connectivity rather than just "the process is up" —
  // a process that's alive but can't reach Postgres should fail health
  // checks so an orchestrator (or pm2) knows to restart/alert on it.
  app.get('/health', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
    } catch (err) {
      logger.error('Health check DB connectivity failed', { err: (err as Error)?.message });
      res.status(503).json({ status: 'error', timestamp: new Date().toISOString() });
    }
  });

  app.use('/api/auth', authRouter);
  // Mounted before the broad `/api` routers below (sisRouter,
  // academicsRouter, feesRouter each catch essentially all `/api/*`
  // sub-paths that fall through their own specific routes, some via a
  // catch-all `/` sub-router with its own unconditional requireAuth) —
  // otherwise a request to /api/tenant/theme-presets never reaches this
  // router at all and 401s from someone else's auth-gated catch-all
  // before Express even tries matching this prefix.
  app.use('/api/tenant', tenantRouter);
  app.use('/api', sisRouter);
  app.use('/api', academicsRouter);
  app.use('/api/attendance', attendanceRouter);
  app.use('/api/holidays', holidaysRouter);
  app.use('/api/exams', examsRouter);
  app.use('/api/exams/class-tests', classTestsRouter);
  app.use('/api/exams', reportCardBatchRouter);
  app.use('/api/grading-bands', gradingBandsRouter);
  app.use('/api', feesRouter);
  app.use('/api/staff', staffModuleRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/portal', portalModuleRouter);
  app.use('/api/platform', platformRouter);
  app.use('/api/notices', noticesRouter);
  app.use('/api/uploads', uploadsRouter);
  app.use('/api', disciplineModuleRouter);
  app.use('/api', supportNeedsModuleRouter);
  app.use('/api', healthModuleRouter);
  app.use('/api', analyticsModuleRouter);
  app.use('/api', customFieldsModuleRouter);
  app.use('/api', examGeneratorModuleRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
