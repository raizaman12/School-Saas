import type { NotificationProvider, OutboundNotificationInput, SendResult } from './types';
import { normalizePakistaniPhone } from './phoneFormat';

export interface WhatsAppCloudCredentials {
  accessToken: string;
  phoneNumberId: string; // Meta "Phone number ID" (not the phone number itself) from the WhatsApp Business app
}

/**
 * Real WhatsApp delivery via Meta's WhatsApp Business Cloud API (Graph API).
 * Sends a plain text session message — a real deployment will likely want
 * to switch to pre-approved message *templates* for anything outside a
 * 24-hour customer-service window (Meta's policy, not this code's
 * limitation); template support can be added as a second `sendTemplate()`
 * method later without touching this interface.
 * https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages
 */
export class WhatsAppCloudProvider implements NotificationProvider {
  constructor(private readonly creds: WhatsAppCloudCredentials) {}

  async send(input: OutboundNotificationInput): Promise<SendResult> {
    const url = `https://graph.facebook.com/v21.0/${this.creds.phoneNumberId}/messages`;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.creds.accessToken}`,
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: normalizePakistaniPhone(input.to, false),
          type: 'text',
          text: { body: input.body },
        }),
      });

      const payload = (await res.json().catch(() => null)) as {
        messages?: { id: string }[];
        error?: { message?: string };
      } | null;

      if (!res.ok) {
        return { success: false, error: payload?.error?.message ?? `WhatsApp API returned ${res.status}` };
      }

      return { success: true, providerMessageId: payload?.messages?.[0]?.id };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'WhatsApp request failed' };
    }
  }
}
