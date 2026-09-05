import { Router } from 'express';
import { healthRouter } from './health';

export const healthModuleRouter = Router();
healthModuleRouter.use('/health', healthRouter);
