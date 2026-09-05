import { Router } from 'express';
import { authRateLimiter, refreshRateLimiter } from '../../middleware/rateLimiter';
import { requireAuth } from '../../middleware/auth';
import {
  signupHandler,
  signupMultiBranchHandler,
  loginHandler,
  platformLoginHandler,
  refreshHandler,
  logoutHandler,
  meHandler,
  updateMeHandler,
  changePasswordHandler,
  forgotPasswordHandler,
  resetPasswordHandler,
  tenantBySlugHandler,
  resolveSchoolHandler,
} from './auth.controller';

export const authRouter = Router();

authRouter.post('/signup', authRateLimiter, signupHandler);
// Multi-branch school registration — shares signup's own rate-limit
// budget (same abuse surface: an unauthenticated account-creation POST).
authRouter.post('/signup-multi-branch', authRateLimiter, signupMultiBranchHandler);
authRouter.post('/login', authRateLimiter, loginHandler);
authRouter.post('/platform-login', authRateLimiter, platformLoginHandler);
// Its own, much more generous limiter — see refreshRateLimiter's doc
// comment in rateLimiter.ts for why /refresh can't share the login/signup
// budget without causing valid sessions to get bounced under real load.
authRouter.post('/refresh', refreshRateLimiter, refreshHandler);
authRouter.post('/logout', logoutHandler);
authRouter.get('/me', requireAuth, meHandler);
// Self-service "edit my own email/phone" — any authenticated role.
authRouter.patch('/me', requireAuth, updateMeHandler);
// Self-service password change — any authenticated role. Rate-limited like
// login/signup since it's a repeated-guess-of-currentPassword surface too.
authRouter.post('/change-password', authRateLimiter, requireAuth, changePasswordHandler);
// Self-service "forgot password" — unauthenticated, both steps rate-limited
// (same as login) since they're both a repeated-guess surface: the first
// against real email addresses, the second against the reset code itself.
authRouter.post('/forgot-password', authRateLimiter, forgotPasswordHandler);
authRouter.post('/reset-password', authRateLimiter, resetPasswordHandler);
// Public — no auth. See tenantBySlugHandler's comment for why this is safe.
authRouter.get('/tenant-by-slug/:slug', tenantBySlugHandler);
// Public — no explicit rate limiter, matching tenant-by-slug's own
// convention (the global rate limiter still applies as a backstop). See
// resolveSchoolHandler's comment for why this is safe to leave open.
authRouter.get('/resolve-school/:slug', resolveSchoolHandler);
