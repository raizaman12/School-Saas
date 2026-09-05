import { Router } from 'express';
import { staffRouter } from './staff';
import { payrollRouter } from './payroll';
import { leaveRequestsRouter } from './leaveRequests';

export const staffModuleRouter = Router();

// Mounted before the generic staff sub-router so `/staff/payroll/*` and
// `/staff/leave-requests/*` are never swallowed by staff's `/:id` route.
staffModuleRouter.use('/payroll', payrollRouter);
staffModuleRouter.use('/leave-requests', leaveRequestsRouter);
staffModuleRouter.use('/', staffRouter);
