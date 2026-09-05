import type { Invoice, LateFeePolicy } from '@prisma/client';
import type { TenantTx } from '../../lib/tenantContext';

/**
 * No cron job drives late fines — this deployment is a single-VPS pm2
 * setup with no scheduler infra (see docs/DEPLOYMENT.md), and a cron job
 * would also mean the fine is stale for up to 24h after an invoice tips
 * over its due date. Instead this is called lazily wherever an invoice is
 * read or paid against (list/detail/ledger/payment recording), so
 * `Invoice.lateFineAmount`/`status` are always correct by the time a user
 * (or the defaulter list) sees them, with no background process to run or
 * monitor.
 *
 * Only ever moves an invoice forward into OVERDUE — never reopens a PAID
 * or CANCELLED invoice, and never reverts OVERDUE back to UNPAID (a grace
 * period shortened after the fact shouldn't un-fine someone; widening it
 * is a School Admin decision to waive the fine manually, not something
 * this helper does automatically).
 *
 * v1 scope: one flat policy per tenant, applied tenant-wide to every
 * invoice equally (no per-fee-category override, no recurring-invoice
 * awareness needed since bulk-generated invoices are already one row per
 * billing period).
 */
export async function syncInvoiceOverdueState(
  tx: TenantTx,
  invoice: Invoice,
  policy: LateFeePolicy | null,
): Promise<Invoice> {
  if (!policy || !policy.isActive) return invoice;
  if (invoice.status === 'PAID' || invoice.status === 'CANCELLED') return invoice;

  const overdueSince = new Date(invoice.dueDate);
  overdueSince.setUTCDate(overdueSince.getUTCDate() + policy.graceDays);

  const now = new Date();
  if (now < overdueSince) return invoice;

  const fineAmount =
    policy.fineType === 'FIXED'
      ? Number(policy.fineValue)
      : Math.round(((Number(policy.fineValue) / 100) * Number(invoice.totalAmount)) * 100) / 100;

  const alreadyCorrect = invoice.status === 'OVERDUE' && Number(invoice.lateFineAmount) === fineAmount;
  if (alreadyCorrect) return invoice;

  return tx.invoice.update({
    where: { id: invoice.id },
    data: { status: 'OVERDUE', lateFineAmount: fineAmount },
  });
}

/** Every tenant has at most one policy (see schema's `@@unique tenantId`). */
export async function getLateFeePolicy(tx: TenantTx, tenantId: string): Promise<LateFeePolicy | null> {
  return tx.lateFeePolicy.findUnique({ where: { tenantId } });
}
