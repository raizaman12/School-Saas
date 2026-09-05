"use client";

import { useState } from "react";
import { Button, type ButtonProps } from "./Button";
import { Alert } from "./Alert";
import { ApiError } from "@/lib/api";

interface ConfirmButtonProps {
  /** Label on the initial, idle trigger button. */
  triggerLabel: string;
  /** Label on the confirm button once the inline warning is showing. */
  confirmLabel: string;
  /** Heading of the inline confirmation warning. */
  title: string;
  /** Body copy explaining the consequence of confirming. */
  description: string;
  /** Called when the user confirms. Throwing (or a rejected promise) keeps the panel open and shows the error. */
  onConfirm: () => Promise<unknown> | unknown;
  triggerVariant?: ButtonProps["variant"];
  confirmVariant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
}

/**
 * A destructive (or otherwise consequential) action rendered as a two-step
 * inline confirmation: an idle trigger button that, on click, swaps itself
 * for a warning + Confirm/Cancel pair in place — no modal. This is the same
 * interaction the platform tenant suspend/reactivate flow used first; it's
 * extracted here so every future destructive action (delete homework,
 * delete a notice, ...) gets the same accessible, low-ceremony pattern for
 * free instead of being reinvented ad hoc per page.
 */
export function ConfirmButton({
  triggerLabel,
  confirmLabel,
  title,
  description,
  onConfirm,
  triggerVariant = "danger",
  confirmVariant = "danger",
  size = "sm",
  className,
}: ConfirmButtonProps) {
  const [isPending, setIsPending] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isPending) {
    return (
      <Button
        type="button"
        variant={triggerVariant}
        size={size}
        className={className}
        onClick={() => {
          setError(null);
          setIsPending(true);
        }}
      >
        {triggerLabel}
      </Button>
    );
  }

  const handleConfirm = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      await onConfirm();
      setIsPending(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Alert tone="warning" title={title} className={className}>
      <p className="mb-2">{description}</p>
      {error && <p className="mb-2 text-red-700">{error}</p>}
      <div className="flex gap-2">
        <Button type="button" size="sm" variant={confirmVariant} isLoading={isSubmitting} onClick={handleConfirm}>
          {confirmLabel}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={isSubmitting} onClick={() => setIsPending(false)}>
          Cancel
        </Button>
      </div>
    </Alert>
  );
}
