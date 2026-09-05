"use client";

import { useState } from "react";
import { Button, Alert } from "@/components/ui";
import { portalAdminApi } from "@/lib/resources/portalAdmin";
import { ApiError } from "@/lib/api";

/**
 * Admin-triggered "reset this account's password" — for when a student,
 * parent, or staff member forgot their password and can't self-service
 * it (see /forgot-password). Generates + emails a fresh one-time temp
 * password and shows it once here, since the admin is often the one who
 * has to hand it to the person directly (over the phone, in person).
 */
export function ResetPasswordButton({ userId, triggerSize = "sm" }: { userId: string; triggerSize?: "sm" | "md" }) {
  const [isPending, setIsPending] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ email: string; tempPassword: string } | null>(null);

  if (result) {
    return (
      <Alert tone="success" title="Password reset">
        <p className="mb-1">
          New temporary password for <span className="font-medium">{result.email}</span>:
        </p>
        <p className="mb-2 rounded bg-white px-2 py-1 font-mono text-base font-semibold text-slate-900">
          {result.tempPassword}
        </p>
        <p className="mb-2 text-xs text-slate-500">
          This has also been emailed to them and won&apos;t be shown again — share it with them now.
        </p>
        <Button type="button" size="sm" variant="outline" onClick={() => setResult(null)}>
          Close
        </Button>
      </Alert>
    );
  }

  if (!isPending) {
    return (
      <Button
        type="button"
        variant="outline"
        size={triggerSize}
        onClick={() => {
          setError(null);
          setIsPending(true);
        }}
      >
        Reset password
      </Button>
    );
  }

  const handleConfirm = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await portalAdminApi.resetPassword(userId);
      setResult({ email: res.data.email, tempPassword: res.tempPassword });
      setIsPending(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reset the password. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Alert tone="warning" title="Reset this account's password?">
      <p className="mb-2">
        A new temporary password will be generated and emailed to them. Their current password will stop working
        immediately.
      </p>
      {error && <p className="mb-2 text-red-700">{error}</p>}
      <div className="flex gap-2">
        <Button type="button" size="sm" variant="danger" isLoading={isSubmitting} onClick={handleConfirm}>
          Reset password
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={isSubmitting} onClick={() => setIsPending(false)}>
          Cancel
        </Button>
      </div>
    </Alert>
  );
}
