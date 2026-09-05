import type { HTMLAttributes } from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "info" | "success" | "warning" | "danger";

const toneStyles: Record<Tone, { container: string; icon: typeof Info }> = {
  info: { container: "bg-primary-50 text-primary-800 border-primary-200", icon: Info },
  success: { container: "bg-emerald-50 text-emerald-800 border-emerald-200", icon: CheckCircle2 },
  warning: { container: "bg-amber-50 text-amber-800 border-amber-200", icon: AlertTriangle },
  danger: { container: "bg-red-50 text-red-800 border-red-200", icon: XCircle },
};

export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  tone?: Tone;
  title?: string;
}

export function Alert({ className, tone = "info", title, children, ...props }: AlertProps) {
  const { container, icon: Icon } = toneStyles[tone];
  return (
    <div
      role="alert"
      className={cn("flex gap-3 rounded-lg border p-3 text-sm", container, className)}
      {...props}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="flex flex-col gap-0.5">
        {title && <p className="font-medium">{title}</p>}
        {children && <div>{children}</div>}
      </div>
    </div>
  );
}
