import { Router } from 'express';
import { portalRouter } from './portal';
import { portalProvisioningRouter } from './provisioning';
import { portalLeaveRequestsRouter } from './leaveRequests';

export const portalModuleRouter = Router();

// Staff-only login provisioning, namespaced away from the PARENT/STUDENT
// read routes so the two role sets never share a path prefix.
portalModuleRouter.use('/admin', portalProvisioningRouter);
// PARENT-only: requesting/viewing/cancelling a leave request for their
// own child — mounted ahead of portalRouter's own broader PORTAL_ROLES
// (PARENT + STUDENT) so this stays PARENT-only regardless.
portalModuleRouter.use('/leave-requests', portalLeaveRequestsRouter);
portalModuleRouter.use('/', portalRouter);
