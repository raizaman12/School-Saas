import { Router } from 'express';
import { feeCategoriesRouter, feeStructureRouter } from './feeCategories';
import { invoicesRouter } from './invoices';
import { lateFeePolicyRouter } from './lateFeePolicy';

export const feesRouter = Router();

feesRouter.use('/fee-categories', feeCategoriesRouter);
feesRouter.use('/fee-structure-items', feeStructureRouter);
feesRouter.use('/invoices', invoicesRouter);
feesRouter.use('/late-fee-policy', lateFeePolicyRouter);
