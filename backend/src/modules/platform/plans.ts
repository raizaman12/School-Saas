import { Router } from 'express';
import type { Request, Response } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth';
import { listPlans } from '../../config/plans';

export const platformPlansRouter = Router();
platformPlansRouter.use(requireAuth, requireRole('SUPER_ADMIN'));

platformPlansRouter.get('/', (_req: Request, res: Response) => {
  res.json({ data: listPlans() });
});
