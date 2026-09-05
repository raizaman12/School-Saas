import { Router } from 'express';
import { customFieldsRouter } from './customFields';

export const customFieldsModuleRouter = Router();
customFieldsModuleRouter.use('/custom-fields', customFieldsRouter);
