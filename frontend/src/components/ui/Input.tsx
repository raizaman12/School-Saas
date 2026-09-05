"use client";

import { forwardRef, useId, useState } from "react";
import type { InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, hint, id, required, type, ...props }, ref) => {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const hintId = hint ? `${inputId}-hint` : undefined;
    const errorId = error ? `${inputId}-error` : undefined;

    // Every password field in the app funnels through this one component
    // (login, signup, change-password, reset-password, staff/student
    // login-credential entry) — adding the show/hide toggle once here
    // covers all of them, rather than one-off eye icons scattered across
    // each page. Only engages for type="password"; every other input type
    // renders exactly as before.
    const isPassword = type === "password";
    const [revealed, setRevealed] = useState(false);

    const inputEl = (
      <input
        ref={ref}
        id={inputId}
        type={isPassword ? (revealed ? "text" : "password") : type}
        required={required}
        aria-invalid={!!error}
        aria-describedby={cn(hintId, errorId) || undefined}
        className={cn(
          "focus-ring h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400",
          isPassword && "pr-11",
          error && "border-red-500",
          className,
        )}
        {...props}
      />
    );

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="text-sm font-medium text-slate-700">
            {label}
            {required && (
              <span className="text-red-600" aria-hidden="true">
                {" "}
                *
              </span>
            )}
          </label>
        )}
        {isPassword ? (
          <div className="relative">
            {inputEl}
            <button
              type="button"
              onClick={() => setRevealed((v) => !v)}
              aria-label={revealed ? "Hide password" : "Show password"}
              aria-pressed={revealed}
              className="focus-ring absolute inset-y-0 right-0 flex w-11 items-center justify-center text-slate-400 hover:text-slate-600"
            >
              {revealed ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
            </button>
          </div>
        ) : (
          inputEl
        )}
        {hint && !error && (
          <p id={hintId} className="text-xs text-slate-500">
            {hint}
          </p>
        )}
        {error && (
          <p id={errorId} role="alert" className="text-xs text-red-600">
            {error}
          </p>
        )}
      </div>
    );
  },
);
Input.displayName = "Input";
