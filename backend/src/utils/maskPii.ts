/**
 * Masks a recipient contact (phone number or email) for logging. Structured
 * logs are the first thing reached for when debugging a delivery issue, but
 * they also tend to end up in log aggregators/retention systems with wider
 * access than the app's own DB — so the raw phone/email shouldn't appear in
 * them verbatim. Keeps just enough (a couple of trailing digits, the email
 * domain) to be useful for correlating "which message was this" without
 * exposing the full contact.
 */
export function maskContact(value: string): string {
  if (value.includes('@')) {
    const [local, domain] = value.split('@');
    const visible = local.slice(0, 1);
    return `${visible}${'*'.repeat(Math.max(local.length - 1, 1))}@${domain}`;
  }
  const digits = value.replace(/\s+/g, '');
  if (digits.length <= 4) return '*'.repeat(digits.length);
  return `${'*'.repeat(digits.length - 4)}${digits.slice(-4)}`;
}
