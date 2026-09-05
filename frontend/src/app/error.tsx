"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui";

/**
 * Root error boundary — catches render/runtime errors anywhere in the app
 * that weren't handled locally, so a bug never shows the user a blank
 * white screen (Nielsen: "help users recognize, diagnose, and recover from
 * errors"). Per-page data-fetch errors are still handled inline (Alert
 * components in each page) rather than through this boundary.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 px-4 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-red-50 text-red-600">
        <AlertTriangle className="size-7" aria-hidden="true" />
      </div>
      <div>
        <h1 className="text-auth-title font-semibold text-slate-900">Something went wrong</h1>
        <p className="mt-1 text-sm text-slate-500">
          An unexpected error occurred. You can try again, or come back later.
        </p>
      </div>
      <Button onClick={reset}>Try again</Button>
    </main>
  );
}
