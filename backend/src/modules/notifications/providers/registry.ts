import type { NotificationChannel } from '@prisma/client';
import { env } from '../../../config/env';
import type { NotificationProvider } from './types';
import { LocalNotificationProvider } from './localProvider';
import { TwilioSmsProvider } from './twilioSmsProvider';
import { WhatsAppCloudProvider } from './whatsappCloudProvider';
import { SmtpEmailProvider } from './smtpEmailProvider';

const localProvider = new LocalNotificationProvider();

function buildSmsProvider(): NotificationProvider {
  if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_SMS_FROM) {
    return new TwilioSmsProvider({
      accountSid: env.TWILIO_ACCOUNT_SID,
      authToken: env.TWILIO_AUTH_TOKEN,
      fromNumber: env.TWILIO_SMS_FROM,
    });
  }
  return localProvider;
}

function buildWhatsAppProvider(): NotificationProvider {
  if (env.WHATSAPP_CLOUD_API_TOKEN && env.WHATSAPP_CLOUD_PHONE_NUMBER_ID) {
    return new WhatsAppCloudProvider({
      accessToken: env.WHATSAPP_CLOUD_API_TOKEN,
      phoneNumberId: env.WHATSAPP_CLOUD_PHONE_NUMBER_ID,
    });
  }
  return localProvider;
}

function buildEmailProvider(): NotificationProvider {
  if (env.SMTP_HOST && env.SMTP_PORT && env.SMTP_USER && env.SMTP_PASS && env.SMTP_FROM) {
    return new SmtpEmailProvider({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE ?? false,
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
      from: env.SMTP_FROM,
    });
  }
  return localProvider;
}

/**
 * Single place that maps a channel to its real-world gateway. Each
 * channel independently goes "live" the moment its full credential set is
 * present in the environment (see config/env.ts) — a tenant can have real
 * SMS working while WhatsApp and Email still fall back to the local mock,
 * no code changes needed as more channels get wired up.
 */
const registry: Record<Exclude<NotificationChannel, 'IN_APP'>, NotificationProvider> = {
  SMS: buildSmsProvider(),
  WHATSAPP: buildWhatsAppProvider(),
  EMAIL: buildEmailProvider(),
};

/** Returns the outbound provider for a channel, or null for IN_APP (no external send needed). */
export function getProvider(channel: NotificationChannel): NotificationProvider | null {
  if (channel === 'IN_APP') return null;
  return registry[channel];
}

/**
 * Reports whether each external channel is backed by a real gateway or
 * still just logging locally — used by GET /api/notifications/channel-status
 * so a School Admin can see at a glance what will actually reach a parent's
 * phone/inbox vs. what's still simulated. Never exposes the credentials
 * themselves, only which provider is active.
 */
export function getChannelStatus(): Record<
  Exclude<NotificationChannel, 'IN_APP'>,
  { live: boolean; provider: string }
> {
  return {
    SMS: { live: registry.SMS !== localProvider, provider: registry.SMS === localProvider ? 'none (simulated)' : 'Twilio' },
    WHATSAPP: {
      live: registry.WHATSAPP !== localProvider,
      provider: registry.WHATSAPP === localProvider ? 'none (simulated)' : 'WhatsApp Cloud API',
    },
    EMAIL: {
      live: registry.EMAIL !== localProvider,
      provider: registry.EMAIL === localProvider ? 'none (simulated)' : 'SMTP',
    },
  };
}
