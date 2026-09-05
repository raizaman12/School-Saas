"use client";

import { use } from "react";
import { useAsync } from "@/lib/hooks/useAsync";
import { portalApi } from "@/lib/resources/portal";
import { PortalStudentHeader } from "@/components/domain/PortalStudentHeader";
import {
  Alert,
  Badge,
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
} from "@/components/ui";

const STATUS_TONE: Record<string, "success" | "default" | "warning" | "danger"> = {
  PAID: "success",
  PARTIALLY_PAID: "warning",
  UNPAID: "default",
  OVERDUE: "danger",
  CANCELLED: "default",
};

export default function PortalStudentFeesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const { data: student, isLoading, error } = useAsync(() => portalApi.student(id), [id]);
  // Always the full history — a paid challan doesn't disappear, it just
  // collapses to a one-line receipt below instead of staying in the way of
  // what's actually still owed. No toggle needed for a parent to see it.
  const { data: ledger } = useAsync(() => portalApi.fees(id, { includePaid: true }), [id]);

  if (isLoading) return <Spinner label="Loading student" />;
  if (error) return <Alert tone="danger">Failed to load student: {error.message}</Alert>;
  if (!student) return null;

  const dueInvoices = ledger?.invoices.filter((inv) => inv.status !== "PAID") ?? [];
  const paidInvoices = ledger?.invoices.filter((inv) => inv.status === "PAID") ?? [];

  return (
    <div className="flex flex-col gap-4">
      <PortalStudentHeader student={student} />

      <Card>
        <CardHeader>
          <CardTitle>Fee ledger</CardTitle>
        </CardHeader>
        <CardContent>
          {ledger ? (
            <dl className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">Total billed</dt>
                <dd className="font-medium text-slate-900">Rs {ledger.summary.totalBilled.toLocaleString()}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Total paid</dt>
                <dd className="font-medium text-slate-900">Rs {ledger.summary.totalPaid.toLocaleString()}</dd>
              </div>
              <div className="flex justify-between border-t border-slate-100 pt-2">
                <dt className="text-slate-500">Balance</dt>
                <dd className={`font-semibold ${ledger.summary.balance > 0 ? "text-red-600" : "text-emerald-600"}`}>
                  Rs {ledger.summary.balance.toLocaleString()}
                </dd>
              </div>
            </dl>
          ) : (
            <Spinner label="Loading ledger" />
          )}

          {ledger && dueInvoices.length === 0 && (
            <p className="mt-4 text-sm text-slate-500">Nothing currently due — all paid up.</p>
          )}

          {dueInvoices.length > 0 && (
            <div className="mt-4">
              <Table>
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>Invoice</TableHeaderCell>
                    <TableHeaderCell>Status</TableHeaderCell>
                    <TableHeaderCell>Amount</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {dueInvoices.slice(0, 10).map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell>{inv.invoiceNumber}</TableCell>
                      <TableCell>
                        <Badge tone={STATUS_TONE[inv.status] ?? "default"}>{inv.status.replace("_", " ")}</Badge>
                      </TableCell>
                      <TableCell>Rs {Number(inv.totalAmount).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {paidInvoices.length > 0 && (
            <div className="mt-5 flex flex-col gap-1.5 border-t border-slate-100 pt-4">
              {paidInvoices.slice(0, 12).map((inv) => (
                <div key={inv.id} className="flex items-center justify-between text-sm text-slate-500">
                  <span>
                    {inv.period} · {new Date(inv.issueDate).toLocaleDateString()}
                  </span>
                  <Badge tone="success">Paid</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
