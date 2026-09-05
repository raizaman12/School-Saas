import nodemailer from 'nodemailer';
import type { NotificationProvider, OutboundNotificationInput, SendResult } from './types';

export interface SmtpCredentials {
  host: string;
  port: number;
  secure: boolean; // true for port 465 (implicit TLS), false for 587/25 (STARTTLS)
  user: string;
  pass: string;
  from: string; // "School SaaS <noreply@yourschool.com>" or similar
}

/**
 * Real email delivery via plain SMTP (nodemailer) — works with any
 * provider that exposes SMTP credentials (SendGrid, Mailgun, Amazon SES,
 * a school's own Google Workspace/Microsoft 365 account, or a generic
 * mail server), rather than binding to one vendor's proprietary HTTP API.
 */
export class SmtpEmailProvider implements NotificationProvider {
  private readonly transporter: ReturnType<typeof nodemailer.createTransport>;

  constructor(private readonly creds: SmtpCredentials) {
    this.transporter = nodemailer.createTransport({
      host: creds.host,
      port: creds.port,
      secure: creds.secure,
      auth: { user: creds.user, pass: creds.pass },
    });
  }

  async send(input: OutboundNotificationInput): Promise<SendResult> {
    try {
      const info = await this.transporter.sendMail({
        from: this.creds.from,
        to: input.to,
        subject: input.subject || '(no subject)',
        text: input.body,
      });
      return { success: true, providerMessageId: info.messageId };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'SMTP send failed' };
    }
  }
}
