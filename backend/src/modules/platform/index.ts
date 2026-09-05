import { Router } from 'express';
import { platformTenantsRouter } from './tenants';
import { platformPlansRouter } from './plans';
import { platformStatsRouter } from './stats';

export const platformRouter = Router();
platformRouter.use('/tenants', platformTenantsRouter);
platformRouter.use('/plans', platformPlansRouter);
platformRouter.use('/stats', platformStatsRouter);
