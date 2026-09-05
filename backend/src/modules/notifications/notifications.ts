import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { requireAuth, requireRole } from '../../middleware/auth';
import { runWithTenant } from '../../lib/tenantContext';
import { AppError } from '../../utils/AppError';
import { uuidParam } from '../../utils/params';
import { paginationMeta, toSkipTake } from '../../utils/pagination';
import { sendNotificationSchema, listNotificationsQuerySchema, broadcastNotificationSchema } from './validation';
import { dispatchNotification } from './notificationService';
import { getChannelStatus } from './providers/registry';

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

const SEND_ROLES = ['SCHOOL_ADMIN', 'TEACHER', 'ACCOUNTANT', 'FRONT_DESK'] as const;

// Lets anyone who can send a notification see, at a glance, whether SMS/
// WhatsApp/Email will actually reach the recipient or just be simulated
// (see providers/registry.ts) — no secrets are exposed, only which
// provider (if any) is active per channel. Registered before `GET /:id`
// so "channel-status" isn't swallowed by that route's `:id` param.
notificationsRouter.get('/channel-status', requireRole(...SEND_ROLES), (_req: Request, res: Response) => {
  res.json({ data: getChannelStatus() });
});

notificationsRouter.post('/send', requireRole(...SEND_ROLES), async (req: Request, res: Response) => {
  const input = sendNotificationSchema.parse(req.body);
  const tenantId = req.auth!.tenantId!;

  const notification = await runWithTenant(tenantId, (tx) =>
    dispatchNotification(tx, tenantId, { ...input, createdByUserId: req.auth!.userId }),
  );

  res.status(201).json({ data: notification });
});

notificationsRouter.post(
  '/broadcast',
  requireRole(...SEND_ROLES),
  async (req: Request, res: Response) => {
    const input = broadcastNotificationSchema.parse(req.body);
    const tenantId = req.auth!.tenantId!;

    const result = await runWithTenant(tenantId, async (tx) => {
      if (input.target === 'SECTION_GUARDIANS') {
        const section = await tx.section.findUnique({ where: { id: input.sectionId! } });
        if (!section) throw AppError.badRequest('Unknown sectionId');

        const guardianLinks = await tx.studentGuardian.findMany({
          where: { student: { currentSectionId: input.sectionId } },
          include: { guardian: true },
        });
        const guardiansById = new Map(guardianLinks.map((l) => [l.guardian.id, l.guardian]));
        const guardians = [...guardiansById.values()];

        let sent = 0;
        let failed = 0;
        for (const guardian of guardians) {
          try {
            const notification = await dispatchNotification(tx, tenantId, {
              channel: input.channel,
              recipientPhone: input.channel === 'SMS' || input.channel === 'WHATSAPP' ? guardian.phone : undefined,
              recipientEmail: input.channel === 'EMAIL' ? (guardian.email ?? undefined) : undefined,
              subject: input.subject,
              body: input.body,
              relatedEntityType: 'Section',
              relatedEntityId: input.sectionId,
              createdByUserId: req.auth!.userId,
            });
            if (notification.status === 'SENT') sent++;
            else failed++;
          } catch {
            failed++;
          }
        }
        return { target: 'SECTION_GUARDIANS', totalRecipients: guardians.length, sent, failed };
      }

      // STAFF_ROLE
      const staffUsers = await tx.user.findMany({
        where: { role: input.role, status: 'ACTIVE' },
        select: { id: true, phone: true, email: true },
      });

      let sent = 0;
      let failed = 0;
      for (const user of staffUsers) {
        try {
          const notification = await dispatchNotification(tx, tenantId, {
            channel: input.channel,
            recipientUserId: user.id,
            // Already fetched via the tenant-scoped query above — passing
            // it here (with trustedRecipient) skips a redundant per-user
            // findUnique that would otherwise re-fetch the exact same row.
            recipientPhone: user.phone ?? undefined,
            recipientEmail: user.email ?? undefined,
            trustedRecipient: true,
            subject: input.subject,
            body: input.body,
            relatedEntityType: 'StaffRoleBroadcast',
            createdByUserId: req.auth!.userId,
          });
          if (notification.status === 'SENT') sent++;
          else failed++;
        } catch {
          failed++;
        }
      }
      return { target: 'STAFF_ROLE', totalRecipients: staffUsers.length, sent, failed };
    });

    res.status(201).json({ data: result });
  },
);

notificationsRouter.get('/', async (req: Request, res: Response) => {
  const query = listNotificationsQuerySchema.parse(req.query);
  const { skip, take } = toSkipTake(query.page, query.limit);
  const tenantId = req.auth!.tenantId;
  const userId = req.auth!.userId;

  const result = await runWithTenant(tenantId, async (tx) => {
    const where: Prisma.NotificationWhereInput = {
      recipientUserId: userId,
      ...(query.unreadOnly ? { readAt: null } : {}),
    };

    const [data, total, unreadCount] = await Promise.all([
      tx.notification.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
      tx.notification.count({ where }),
      tx.notification.count({ where: { recipientUserId: userId, readAt: null } }),
    ]);

    return { data, total, unreadCount };
  });

  res.json({
    data: result.data,
    meta: { ...paginationMeta(query.page, query.limit, result.total), unreadCount: result.unreadCount },
  });
});

notificationsRouter.get('/:id', async (req: Request, res: Response) => {
  const tenantId = req.auth!.tenantId;

  const notification = await runWithTenant(tenantId, (tx) =>
    tx.notification.findUnique({ where: { id: uuidParam(req, 'id') } }),
  );

  if (!notification) throw AppError.notFound('Notification not found');

  const isOwner = notification.recipientUserId === req.auth!.userId;
  const isAdmin = req.auth!.role === 'SCHOOL_ADMIN';
  if (!isOwner && !isAdmin) throw AppError.forbidden('You do not have access to this notification');

  res.json({ data: notification });
});

notificationsRouter.patch('/:id/read', async (req: Request, res: Response) => {
  const tenantId = req.auth!.tenantId;

  const notification = await runWithTenant(tenantId, async (tx) => {
    const existing = await tx.notification.findUnique({ where: { id: uuidParam(req, 'id') } });
    if (!existing) throw AppError.notFound('Notification not found');
    if (existing.recipientUserId !== req.auth!.userId) {
      throw AppError.forbidden('You do not have access to this notification');
    }
    if (existing.readAt) return existing; // idempotent

    return tx.notification.update({ where: { id: existing.id }, data: { readAt: new Date() } });
  });

  res.json({ data: notification });
});
