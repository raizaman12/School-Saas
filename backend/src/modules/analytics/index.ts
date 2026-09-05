import { Router } from 'express';
import { analyticsRouter } from './analytics';

export const analyticsModuleRouter = Router();
analyticsModuleRouter.use('/analytics', analyticsRouter);
