import { z } from 'zod';

const CHANNELS = ['IN_APP', 'SMS', 'EMAIL', 'WHATSAPP'] as const;

export const sendNotificationSchema = z
  .object({
    channel: z.enum(CHANNELS),
    recipientUserId: z.string().uuid().optional(),
    recipientPhone: z.string().min(5).max(30).optional(),
    recipientEmail: z.string().email().optional(),
    subject: z.string().max(200).optional(),
    body: z.string().min(1).max(2000),
    relatedEntityType: z.string().max(50).optional(),
    relatedEntityId: z.string().uuid().optional(),
  })
  .refine((v) => (v.channel === 'IN_APP' ? !!v.recipientUserId : true), {
    message: 'recipientUserId is required for IN_APP notifications',
    path: ['recipientUserId'],
  })
  .refine((v) => (v.channel === 'SMS' || v.channel === 'WHATSAPP' ? !!(v.recipientPhone || v.recipientUserId) : true), {
    message: 'recipientPhone or recipientUserId is required for SMS/WHATSAPP notifications',
    path: ['recipientPhone'],
  })
  .refine((v) => (v.channel === 'EMAIL' ? !!(v.recipientEmail || v.recipientUserId) : true), {
    message: 'recipientEmail or recipientUserId is required for EMAIL notifications',
    path: ['recipientEmail'],
  });
export type SendNotificationInput = z.infer<typeof sendNotificationSchema>;

export const listNotificationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  unreadOnly: z.coerce.boolean().default(false),
});

const BROADCASTABLE_ROLES = ['SCHOOL_ADMIN', 'TEACHER', 'ACCOUNTANT', 'FRONT_DESK'] as const;

export const broadcastNotificationSchema = z
  .object({
    channel: z.enum(CHANNELS),
    target: z.enum(['SECTION_GUARDIANS', 'STAFF_ROLE']),
    sectionId: z.string().uuid().optional(),
    role: z.enum(BROADCASTABLE_ROLES).optional(),
    subject: z.string().max(200).optional(),
    body: z.string().min(1).max(2000),
  })
  .refine((v) => (v.target === 'SECTION_GUARDIANS' ? !!v.sectionId : true), {
    message: 'sectionId is required when target is SECTION_GUARDIANS',
    path: ['sectionId'],
  })
  .refine((v) => (v.target === 'STAFF_ROLE' ? !!v.role : true), {
    message: 'role is required when target is STAFF_ROLE',
    path: ['role'],
  })
  .refine((v) => (v.target === 'SECTION_GUARDIANS' ? v.channel !== 'IN_APP' : true), {
    message: 'IN_APP is not supported for SECTION_GUARDIANS broadcasts (guardians may have no login)',
    path: ['channel'],
  });
export type BroadcastNotificationInput = z.infer<typeof broadcastNotificationSchema>;
