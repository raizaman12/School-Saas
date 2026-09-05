import { Router } from 'express';
import { disciplineRouter } from './discipline';

export const disciplineModuleRouter = Router();
disciplineModuleRouter.use('/discipline-records', disciplineRouter);
