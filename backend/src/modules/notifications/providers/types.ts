/**
 * Pluggable outbound-channel abstraction. Every real gateway (Twilio SMS,
 * Meta WhatsApp Business Cloud API, SES/SendGrid for email, ...) implements
 * this interface; call sites never talk to a vendor SDK directly. Swapping
 * a channel's real-world provider is a one-line change in `registry.ts` —
 * no changes needed anywhere notifications are sent from.
 */
export interface SendResult {
  success: boolean;
  providerMessageId?: string;
  error?: string;
}

export interface OutboundNotificationInput {
  to: string; // phone number (SMS/WhatsApp) or email address (EMAIL)
  subject?: string;
  body: string;
}

export interface NotificationProvider {
  send(input: OutboundNotificationInput): Promise<SendResult>;
}
