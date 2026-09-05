import type { NotificationProvider, OutboundNotificationInput, SendResult } from './types';
import { normalizePakistaniPhone } from './phoneFormat';

export interface TwilioCredentials {
  accountSid: string;
  authToken: string;
  fromNumber: string; // Twilio number in E.164 format, e.g. "+15551234567"
}

/**
 * Real SMS delivery via Twilio's REST API — no `twilio` SDK dependency,
 * just a plain authenticated POST (Twilio's Messages API is a simple
 * form-encoded endpoint, not worth pulling in the full SDK for one call).
 * https://www.twilio.com/docs/sms/api/message-resource#create-a-message-resource
 */
export class TwilioSmsProvider implements NotificationProvider {
  constructor(private readonly creds: TwilioCredentials) {}

  async send(input: OutboundNotificationInput): Promise<SendResult> {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.creds.accountSid}/Messages.json`;
    const body = new URLSearchParams({
      To: normalizePakistaniPhone(input.to, true),
      From: this.creds.fromNumber,
      Body: input.body,
    });

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(`${this.creds.accountSid}:${this.creds.authToken}`).toString('base64')}`,
        },
        body,
      });

      const payload = (await res.json().catch(() => null)) as { sid?: string; message?: string } | null;

      if (!res.ok) {
        return {
          success: false,
          error: payload?.message ?? `Twilio API returned ${res.status}`,
        };
      }

      return { success: true, providerMessageId: payload?.sid };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Twilio request failed' };
    }
  }
}
