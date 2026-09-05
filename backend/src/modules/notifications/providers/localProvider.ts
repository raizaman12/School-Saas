import { randomUUID } from 'crypto';
import { logger } from '../../../lib/logger';
import { maskContact } from '../../../utils/maskPii';
import type { NotificationProvider, OutboundNotificationInput, SendResult } from './types';

/**
 * Local/mock provider used until a real SMS/WhatsApp/email gateway is
 * wired up (Twilio, Meta Cloud API, SES, ...). It "delivers" a message by
 * logging it and, in test mode, recording it in an in-memory outbox so
 * tests can assert on what would have been sent — without ever making a
 * network call or requiring vendor credentials.
 */
export class LocalNotificationProvider implements NotificationProvider {
  // Exposed for tests only; harmless in dev/prod (just an unread array).
  static outbox: Array<OutboundNotificationInput & { providerMessageId: string }> = [];

  async send(input: OutboundNotificationInput): Promise<SendResult> {
    const providerMessageId = `local-${randomUUID()}`;
    LocalNotificationProvider.outbox.push({ ...input, providerMessageId });
    logger.info('Notification dispatched via LocalNotificationProvider', {
      to: maskContact(input.to),
      subject: input.subject,
      providerMessageId,
    });
    return { success: true, providerMessageId };
  }
}
