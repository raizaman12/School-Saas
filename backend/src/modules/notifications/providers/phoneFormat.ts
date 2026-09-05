/**
 * Normalizes a phone number, stored however staff/parents typed it (e.g.
 * "0300-1234567", "+92 300 1234567", "923001234567"), into E.164 digits
 * for an outbound SMS/WhatsApp API call. No phone-format validation is
 * enforced anywhere else in this app (unlike CNIC/B-Form), so this has to
 * be tolerant rather than assume a canonical input shape.
 *
 * Defaults to Pakistan's country code (92) for the common local
 * "0XXXXXXXXXX" (11-digit, leading 0) format used throughout this
 * product's test fixtures and UI copy — this is a Pakistan-market system,
 * so that's the right default rather than a generic/no-op strip.
 *
 * @param withPlus  Twilio's API wants a leading "+" (true); Meta's
 *   WhatsApp Cloud API wants digits only, no "+" (false).
 */
export function normalizePakistaniPhone(phone: string, withPlus: boolean): string {
  const trimmed = phone.trim();
  const hadPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/[^\d]/g, '');

  let normalized: string;
  if (hadPlus) {
    // Already gave us a country code explicitly — trust it as-is.
    normalized = digits;
  } else if (digits.length === 11 && digits.startsWith('0')) {
    // Local Pakistani format: 03001234567 -> 923001234567
    normalized = `92${digits.slice(1)}`;
  } else if (digits.startsWith('92')) {
    // Already has the country code, just no "+" (e.g. 923001234567).
    normalized = digits;
  } else {
    // Unknown shape — pass the digits through rather than guess further.
    normalized = digits;
  }

  return withPlus ? `+${normalized}` : normalized;
}
