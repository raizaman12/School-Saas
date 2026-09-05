"use client";

import { use, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { feesApi, type InvoiceDetail, type PaymentMethod } from "@/lib/resources/fees";
import { useAsync } from "@/lib/hooks/useAsync";
import { useAuth } from "@/lib/auth/AuthProvider";
import { ApiError, downloadFile } from "@/lib/api";
import {
  Button,
  ConfirmButton,
  Input,
  Select,
  Badge,
  Alert,
  Spinner,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
  EmptyState,
} from "@/components/ui";

const paymentSchema = z.object({
  amount: z.coerce.number().positive("Must be greater than 0"),
  method: z.enum(["CASH", "BANK_TRANSFER", "CARD", "ONLINE", "CHEQUE"]),
  referenceNumber: z.string().max(100).optional(),
});
type PaymentFormValues = z.infer<typeof paymentSchema>;

const STATUS_TONE: Record<string, "success" | "default" | "warning" | "danger"> = {
  PAID: "success",
  PARTIALLY_PAID: "warning",
  UNPAID: "default",
  OVERDUE: "danger",
  CANCELLED: "default",
};

export default function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useAuth();
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const { data, isLoading, error } = useAsync(() => feesApi.getInvoice(id), [id]);
  const current = invoice ?? data;
  const [revertError, setRevertError] = useState<string | null>(null);

  const [formError, setFormError] = useState<string | null>(null);
  const [paymentSuccess, setPaymentSuccess] = useState<string | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);
  const [isDownloadingChallan, setIsDownloadingChallan] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<z.input<typeof paymentSchema>, unknown, PaymentFormValues>({
    resolver: zodResolver(paymentSchema),
    defaultValues: { method: "CASH" },
  });

  // Balance owed = total + late fine - paid, matching the backend's formula
  // (invoices.ts's remaining/amountDue calc) — a late fine sits outside
  // totalAmount, so leaving it out here understated what a family still owes.
  const remainingOf = (inv: InvoiceDetail) => Number(inv.totalAmount) + Number(inv.lateFineAmount) - Number(inv.paidAmount);
  const remaining = current ? remainingOf(current) : 0;

  const onSubmit = async (values: PaymentFormValues) => {
    setFormError(null);
    setPaymentSuccess(null);
    try {
      const idempotencyKey = crypto.randomUUID();
      const res = await feesApi.recordPayment(id, { ...values, idempotencyKey, referenceNumber: values.referenceNumber || undefined });
      setInvoice(res.invoice);
      const newRemaining = remainingOf(res.invoice);
      setPaymentSuccess(
        `Payment of Rs ${values.amount.toLocaleString()} (${values.method.replace("_", " ")}) recorded. ${
          newRemaining > 0
            ? `Remaining balance: Rs ${newRemaining.toLocaleString()}.`
            : "Invoice is now fully paid."
        }`,
      );
      reset();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not record payment.");
    }
  };

  const handleMarkPaid = async () => {
    setFormError(null);
    setPaymentSuccess(null);
    try {
      const res = await feesApi.markPaid(id);
      setInvoice(res.invoice);
      setPaymentSuccess(
        res.payment
          ? `Marked fully paid — Rs ${Number(res.payment.amount).toLocaleString()} recorded as ${res.payment.method.replace("_", " ")}.`
          : "This invoice was already fully paid.",
      );
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not mark the invoice as paid.");
    }
  };

  // Accountant-only escape hatch for a mistaken "Mark fully paid" — the
  // backend enforces the role too (PAYMENT_REVERSAL_ROLES), this just keeps
  // the button off screen for everyone else.
  const handleRevertToUnpaid = async () => {
    setRevertError(null);
    setPaymentSuccess(null);
    try {
      const res = await feesApi.revertToUnpaid(id);
      setInvoice(res.invoice);
    } catch (err) {
      setRevertError(err instanceof ApiError ? err.message : "Could not revert this invoice.");
    }
  };

  const handleDownloadChallan = async () => {
    setPrintError(null);
    setIsDownloadingChallan(true);
    try {
      await downloadFile(`/api/invoices/${id}/challan-pdf`, `challan-${id}.pdf`);
    } catch (err) {
      setPrintError(err instanceof ApiError ? err.message : "Could not generate the fee challan.");
    } finally {
      setIsDownloadingChallan(false);
    }
  };

  if (isLoading) return <Spinner label="Loading invoice" />;
  if (error) return <Alert tone="danger">Failed to load invoice: {error.message}</Alert>;
  if (!current) return null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-page-title font-semibold text-slate-900">{current.invoiceNumber}</h1>
          <p className="text-sm text-slate-500">{current.student.fullName}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={STATUS_TONE[current.status] ?? "default"}>{current.status.replace("_", " ")}</Badge>
          {current.status === "PAID" && user?.role === "ACCOUNTANT" && (
            <ConfirmButton
              triggerLabel="Revert to unpaid"
              triggerVariant="outline"
              confirmLabel="Yes, revert this"
              confirmVariant="danger"
              title="Revert this invoice to unpaid?"
              description="This undoes the most recent payment that settled it — use this only to correct a mistake."
              onConfirm={handleRevertToUnpaid}
            />
          )}
          <Button variant="outline" size="sm" onClick={handleDownloadChallan} isLoading={isDownloadingChallan}>
            Download challan
          </Button>
        </div>
      </div>

      {revertError && <Alert tone="danger">{revertError}</Alert>}
      {printError && <Alert tone="danger">{printError}</Alert>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Line items</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Description</TableHeaderCell>
                  <TableHeaderCell>Amount</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {current.lineItems.map((li) => (
                  <TableRow key={li.id}>
                    <TableCell>{li.description}</TableCell>
                    <TableCell>Rs {Number(li.amount).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">Total</dt>
                <dd className="font-medium text-slate-900">Rs {Number(current.totalAmount).toLocaleString()}</dd>
              </div>
              {Number(current.lateFineAmount) > 0 && (
                <div className="flex justify-between">
                  <dt className="text-slate-500">Late fine</dt>
                  <dd className="font-medium text-red-600">Rs {Number(current.lateFineAmount).toLocaleString()}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-slate-500">Paid</dt>
                <dd className="font-medium text-slate-900">Rs {Number(current.paidAmount).toLocaleString()}</dd>
              </div>
              <div className="flex justify-between border-t border-slate-100 pt-2">
                <dt className="text-slate-500">Remaining</dt>
                <dd className={`font-semibold ${remaining > 0 ? "text-red-600" : "text-emerald-600"}`}>
                  Rs {remaining.toLocaleString()}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Due date</dt>
                <dd className="text-slate-900">{new Date(current.dueDate).toLocaleDateString()}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Payment history</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {paymentSuccess && <Alert tone="success">{paymentSuccess}</Alert>}
          {current.payments.length === 0 ? (
            <EmptyState message="No payments recorded yet." />
          ) : (
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Date</TableHeaderCell>
                  <TableHeaderCell>Amount</TableHeaderCell>
                  <TableHeaderCell>Method</TableHeaderCell>
                  <TableHeaderCell>Reference</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {current.payments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{new Date(p.createdAt).toLocaleDateString()}</TableCell>
                    <TableCell>Rs {Number(p.amount).toLocaleString()}</TableCell>
                    <TableCell>{p.method.replace("_", " ")}</TableCell>
                    <TableCell>{p.referenceNumber ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {remaining > 0 && (
            <>
              {formError && <Alert tone="danger">{formError}</Alert>}

              <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm text-slate-600">
                  Received the full remaining balance? Mark it paid in one step — no need to type the amount below.
                </p>
                <ConfirmButton
                  triggerLabel="Mark fully paid"
                  triggerVariant="primary"
                  confirmLabel="Confirm mark paid"
                  confirmVariant="primary"
                  title="Mark this invoice as fully paid?"
                  description={`Rs ${remaining.toLocaleString()} will be recorded as a payment for ${current.student.fullName}.`}
                  onConfirm={handleMarkPaid}
                />
              </div>

              <form onSubmit={handleSubmit(onSubmit)} noValidate className="rounded-lg border border-slate-200 p-4">
                <p className="mb-3 text-sm font-medium text-slate-700">Or record a specific (e.g. partial) amount</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Input
                    label="Amount (Rs)"
                    type="number"
                    min={0}
                    max={remaining}
                    step="0.01"
                    required
                    hint={`Remaining balance: Rs ${remaining.toLocaleString()}`}
                    error={errors.amount?.message}
                    {...register("amount")}
                  />
                  <Select label="Method" required {...register("method")}>
                    {(["CASH", "BANK_TRANSFER", "CARD", "ONLINE", "CHEQUE"] as PaymentMethod[]).map((m) => (
                      <option key={m} value={m}>
                        {m.replace("_", " ")}
                      </option>
                    ))}
                  </Select>
                  <Input label="Reference number" {...register("referenceNumber")} />
                </div>
                <div className="mt-3 flex justify-end">
                  <Button type="submit" size="sm" isLoading={isSubmitting}>
                    Record payment
                  </Button>
                </div>
              </form>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
