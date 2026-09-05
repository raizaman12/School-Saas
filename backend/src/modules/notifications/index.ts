import { Router } from 'express';
import { notificationsRouter as notificationsSubRouter } from './notifications';

export const notificationsRouter = Router();
notificationsRouter.use('/', notificationsSubRouter);

export { LocalNotificationProvider } from './providers/localProvider';
