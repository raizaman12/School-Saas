import nodemailer from 'nodemailer';
import { TwilioSmsProvider } from '../../src/modules/notifications/providers/twilioSmsProvider';
import { WhatsAppCloudProvider } from '../../src/modules/notifications/providers/whatsappCloudProvider';
import { SmtpEmailProvider } from '../../src/modules/notifications/providers/smtpEmailProvider';
import { normalizePakistaniPhone } from '../../src/modules/notifications/providers/phoneFormat';

/**
 * These exercise the real provider implementations without ever making a
 * real network call — `global.fetch` and nodemailer's transport are
 * mocked so we can assert on request shape (correct URL, auth header,
 * body) and on success/failure/error-handling behavior, which is exactly
 * what's testable without live vendor credentials.
 */

describe('normalizePakistaniPhone', () => {
  it('converts local 11-digit format (0XXXXXXXXXX) to E.164 with country code 92', () => {
    expect(normalizePakistaniPhone('03001234567', true)).toBe('+923001234567');
    expect(normalizePakistaniPhone('03001234567', false)).toBe('923001234567');
  });

  it('handles dashes/spaces in the local format', () => {
    expect(normalizePakistaniPhone('0300-1234567', true)).toBe('+923001234567');
    expect(normalizePakistaniPhone('0300 123 4567', true)).toBe('+923001234567');
  });

  it('trusts an already-international number (leading +)', () => {
    expect(normalizePakistaniPhone('+92 300 1234567', true)).toBe('+923001234567');
  });

  it('leaves an already-92-prefixed number (no +) as-is', () => {
    expect(normalizePakistaniPhone('923001234567', false)).toBe('923001234567');
  });
});

describe('TwilioSmsProvider', () => {
  const provider = new TwilioSmsProvider({
    accountSid: 'AC_test_sid',
    authToken: 'test_auth_token',
    fromNumber: '+15551234567',
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sends a correctly-formed request and reports success', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ sid: 'SM123abc' }),
    } as Response);

    const result = await provider.send({ to: '03001234567', body: 'Test message' });

    expect(result).toEqual({ success: true, providerMessageId: 'SM123abc' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC_test_sid/Messages.json');
    expect(options?.method).toBe('POST');
    expect((options?.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from('AC_test_sid:test_auth_token').toString('base64')}`,
    );
    const sentBody = new URLSearchParams(options?.body as string);
    expect(sentBody.get('To')).toBe('+923001234567');
    expect(sentBody.get('From')).toBe('+15551234567');
    expect(sentBody.get('Body')).toBe('Test message');
  });

  it('reports failure with Twilio\'s error message on a non-2xx response', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ message: 'The number is unverified' }),
    } as Response);

    const result = await provider.send({ to: '03001234567', body: 'Test' });

    expect(result).toEqual({ success: false, error: 'The number is unverified' });
  });

  it('reports failure gracefully on a network error', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await provider.send({ to: '03001234567', body: 'Test' });

    expect(result).toEqual({ success: false, error: 'ECONNREFUSED' });
  });
});

describe('WhatsAppCloudProvider', () => {
  const provider = new WhatsAppCloudProvider({
    accessToken: 'test_access_token',
    phoneNumberId: '1234567890',
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sends a correctly-formed request and reports success', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: 'wamid.123' }] }),
    } as Response);

    const result = await provider.send({ to: '03001234567', body: 'Test message' });

    expect(result).toEqual({ success: true, providerMessageId: 'wamid.123' });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v21.0/1234567890/messages');
    expect((options?.headers as Record<string, string>).Authorization).toBe('Bearer test_access_token');
    const sentBody = JSON.parse(options?.body as string);
    expect(sentBody).toEqual({
      messaging_product: 'whatsapp',
      to: '923001234567',
      type: 'text',
      text: { body: 'Test message' },
    });
  });

  it('reports failure with the Graph API\'s error message', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'Invalid OAuth access token' } }),
    } as Response);

    const result = await provider.send({ to: '03001234567', body: 'Test' });

    expect(result).toEqual({ success: false, error: 'Invalid OAuth access token' });
  });
});

describe('SmtpEmailProvider', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sends via nodemailer and reports success', async () => {
    const sendMailMock = jest.fn().mockResolvedValue({ messageId: '<abc@school.test>' });
    jest.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail: sendMailMock } as never);

    const provider = new SmtpEmailProvider({
      host: 'smtp.example.test',
      port: 587,
      secure: false,
      user: 'user@example.test',
      pass: 'secret',
      from: 'School <noreply@school.test>',
    });

    const result = await provider.send({ to: 'parent@example.test', subject: 'Hello', body: 'Body text' });

    expect(result).toEqual({ success: true, providerMessageId: '<abc@school.test>' });
    expect(sendMailMock).toHaveBeenCalledWith({
      from: 'School <noreply@school.test>',
      to: 'parent@example.test',
      subject: 'Hello',
      text: 'Body text',
    });
  });

  it('reports failure when nodemailer rejects', async () => {
    const sendMailMock = jest.fn().mockRejectedValue(new Error('Authentication failed'));
    jest.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail: sendMailMock } as never);

    const provider = new SmtpEmailProvider({
      host: 'smtp.example.test',
      port: 587,
      secure: false,
      user: 'user@example.test',
      pass: 'wrong',
      from: 'School <noreply@school.test>',
    });

    const result = await provider.send({ to: 'parent@example.test', body: 'Body text' });

    expect(result).toEqual({ success: false, error: 'Authentication failed' });
  });
});

describe('provider registry — channel status', () => {
  const REAL_ENV = process.env;

  afterEach(() => {
    process.env = REAL_ENV;
    jest.resetModules();
  });

  it('falls back to the local/simulated provider for every channel when no credentials are configured', () => {
    jest.resetModules();
    process.env = { ...REAL_ENV };
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_SMS_FROM;
    delete process.env.WHATSAPP_CLOUD_API_TOKEN;
    delete process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID;
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    delete process.env.SMTP_FROM;

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getChannelStatus } = require('../../src/modules/notifications/providers/registry');
    const status = getChannelStatus();

    expect(status.SMS).toEqual({ live: false, provider: 'none (simulated)' });
    expect(status.WHATSAPP).toEqual({ live: false, provider: 'none (simulated)' });
    expect(status.EMAIL).toEqual({ live: false, provider: 'none (simulated)' });
  });

  it('reports a channel as live once its full credential set is present', () => {
    jest.resetModules();
    process.env = {
      ...REAL_ENV,
      TWILIO_ACCOUNT_SID: 'AC_test',
      TWILIO_AUTH_TOKEN: 'token_test',
      TWILIO_SMS_FROM: '+15551234567',
    };
    delete process.env.WHATSAPP_CLOUD_API_TOKEN;
    delete process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID;
    delete process.env.SMTP_HOST;

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getChannelStatus } = require('../../src/modules/notifications/providers/registry');
    const status = getChannelStatus();

    expect(status.SMS).toEqual({ live: true, provider: 'Twilio' });
    expect(status.WHATSAPP.live).toBe(false);
    expect(status.EMAIL.live).toBe(false);
  });

  it('does not go live on a partial credential set (e.g. Twilio SID without an auth token)', () => {
    jest.resetModules();
    process.env = { ...REAL_ENV, TWILIO_ACCOUNT_SID: 'AC_test' };
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_SMS_FROM;

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getChannelStatus } = require('../../src/modules/notifications/providers/registry');
    const status = getChannelStatus();

    expect(status.SMS).toEqual({ live: false, provider: 'none (simulated)' });
  });
});
