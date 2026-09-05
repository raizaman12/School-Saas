import { Router } from 'express';
import { supportNeedsRouter } from './supportNeeds';

export const supportNeedsModuleRouter = Router();
supportNeedsModuleRouter.use('/support-needs', supportNeedsRouter);
