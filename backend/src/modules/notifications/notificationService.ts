import { randomUUID } from 'crypto';
import type { Prisma, NotificationChannel } from '@prisma/client';
import { AppError } from '../../utils/AppError';
import { getProvider } from './providers/registry';
import { checkSmsCredits } from '../../lib/planLimits';

interface DispatchInput {
  channel: NotificationChannel;
  recipientUserId?: string;
  recipientPhone?: string;
  recipientEmail?: string;
  subject?: string;
  body: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  createdByUserId?: string;
  // Set ONLY by an internal caller that already resolved recipientUserId
  // via its own tenant-scoped query in this same transaction (e.g. a
  // broadcast looping over `tx.user.findMany(...)` results) AND already
  // supplied the phone/email the channel needs from that same query.
  // Skips the redundant re-fetch-and-validate lookup below — safe because
  // the caller (not end-user input) already proved recipientUserId
  // resolves within this tenant's RLS scope. The public `/send` endpoint,
  // where recipientUserId is attacker-controllable, must NEVER set this.
  trustedRecipient?: boolean;
}

/**
 * Creates a Notification row and dispatches it.
 *
 * NOTE (background-job trade-off, same as bulk invoice generation in
 * Day 6): this sends synchronously, inline with the HTTP request. For a
 * single notification that's fine; for a large broadcast it means the
 * request stays open for the whole batch. The Notification row already
 * models PENDING/SENT/FAILED as distinct states specifically so this can
 * be swapped for "create as PENDING, hand off to a queue worker that calls
 * the same provider and flips the status" later without changing the data
 * model or the call sites.
 */
export async function dispatchNotification(
  tx: Prisma.TransactionClient,
  tenantId: string,
  input: DispatchInput,
) {
  let recipientPhone = input.recipientPhone;
  let recipientEmail = input.recipientEmail;

  if (input.recipientUserId && !input.trustedRecipient) {
    // Always re-validated here (RLS-scoped to the current tenant) even when
    // the caller already supplied phone/email explicitly — this is what
    // stops a recipientUserId belonging to a different tenant from ever
    // being written onto a Notification row, closing a cross-tenant
    // dangling-reference edge case.
    const user = await tx.user.findUnique({
      where: { id: input.recipientUserId },
      select: { phone: true, email: true },
    });
    if (!user) throw AppError.badRequest('Unknown recipientUserId');
    recipientPhone = recipientPhone ?? user.phone ?? undefined;
    // user.email is nullable now (an ID-only login — see
    // createStudentLogin/staff.ts's doc comments) — falls through to the
    // "Recipient has no email address on file" guard right below exactly
    // like it always did for a user with no email.
    recipientEmail = recipientEmail ?? user.email ?? undefined;
  }

  if ((input.channel === 'SMS' || input.channel === 'WHATSAPP') && !recipientPhone) {
    throw AppError.badRequest('Recipient has no phone number on file');
  }
  if (input.channel === 'EMAIL' && !recipientEmail) {
    throw AppError.badRequest('Recipient has no email address on file');
  }

  // SMS/WhatsApp are metered by the tenant's plan (see config/plans.ts).
  // Checked *before* creating the row so the quota count (this month's
  // already-created SMS/WhatsApp rows) isn't thrown off by counting the
  // in-flight row against itself, and before calling the provider so a
  // tenant that's out of quota doesn't incur a real provider cost once a
  // real provider is wired in. Still recorded as a FAILED row (not
  // silently dropped) so it shows up in the tenant's notification history
  // and audit trail like any other failed send.
  let quotaExceededMessage: string | null = null;
  if (input.channel === 'SMS' || input.channel === 'WHATSAPP') {
    const credits = await checkSmsCredits(tx, tenantId);
    if (!credits.allowed) {
      quotaExceededMessage =
        credits.limit === 0
          ? 'SMS/WhatsApp notifications are not available on your current plan. Upgrade to Standard or higher.'
          : `Monthly SMS/WhatsApp quota (${credits.limit}) reached for this billing period. Upgrade your plan for more.`;
    }
  }

  const notification = await tx.notification.create({
    data: {
      id: randomUUID(),
      tenantId,
      channel: input.channel,
      recipientUserId: input.recipientUserId,
      recipientPhone,
      recipientEmail,
      subject: input.subject,
      body: input.body,
      relatedEntityType: input.relatedEntityType,
      relatedEntityId: input.relatedEntityId,
      createdByUserId: input.createdByUserId,
      ...(quotaExceededMessage ? { status: 'FAILED', errorMessage: quotaExceededMessage } : {}),
    },
  });

  if (quotaExceededMessage) {
    return notification;
  }

  if (input.channel === 'IN_APP') {
    return tx.notification.update({
      where: { id: notification.id },
      data: { status: 'SENT', sentAt: new Date() },
    });
  }

  const provider = getProvider(input.channel);
  if (!provider) {
    // Should be unreachable given the channel checks above, but fail safe.
    return tx.notification.update({
      where: { id: notification.id },
      data: { status: 'FAILED', errorMessage: 'No provider configured for this channel' },
    });
  }

  const to = input.channel === 'EMAIL' ? recipientEmail! : recipientPhone!;

  try {
    const result = await provider.send({ to, subject: input.subject, body: input.body });
    if (result.success) {
      return tx.notification.update({
        where: { id: notification.id },
        data: { status: 'SENT', sentAt: new Date(), providerMessageId: result.providerMessageId },
      });
    }
    return tx.notification.update({
      where: { id: notification.id },
      data: { status: 'FAILED', errorMessage: result.error ?? 'Unknown provider error' },
    });
  } catch (err) {
    return tx.notification.update({
      where: { id: notification.id },
      data: { status: 'FAILED', errorMessage: err instanceof Error ? err.message : 'Unknown error' },
    });
  }
}
