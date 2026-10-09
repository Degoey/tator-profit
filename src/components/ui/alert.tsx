import { AlertTriangle, CheckCircle2, Info, ShieldAlert } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

type AlertVariant = "info" | "success" | "warning" | "danger";

const styles: Record<AlertVariant, { wrapper: string; icon: React.ReactNode }> = {
  info: {
    wrapper: "border-white/12 bg-white/[0.04] text-white/80",
    icon: <Info className="size-4 text-white/60" aria-hidden />,
  },
  success: {
    wrapper: "border-[var(--color-neon)]/35 bg-[var(--color-neon)]/10 text-[var(--color-neon)]",
    icon: <CheckCircle2 className="size-4" aria-hidden />,
  },
  warning: {
    wrapper: "border-[var(--color-gold)]/40 bg-[var(--color-gold)]/10 text-[var(--color-gold)]",
    icon: <AlertTriangle className="size-4" aria-hidden />,
  },
  danger: {
    wrapper: "border-red-500/40 bg-red-500/10 text-red-200",
    icon: <ShieldAlert className="size-4" aria-hidden />,
  },
};

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: AlertVariant;
  title?: string;
}

export function Alert({ className, variant = "info", title, children, ...props }: AlertProps) {
  const style = styles[variant];
  /**
   * Only errors interrupt a screen reader. Informational, success and warning
   * alerts are static page content, so they are announced politely instead of
   * being forced to the front of the queue on every page load.
   */
  const isAssertive = variant === "danger";
  return (
    <div
      role={isAssertive ? "alert" : "status"}
      aria-live={isAssertive ? "assertive" : "polite"}
      className={cn("flex gap-3 rounded-xl border p-3.5 text-sm", style.wrapper, className)}
      {...props}
    >
      <span className="mt-0.5">{style.icon}</span>
      <div className="space-y-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className="text-sm opacity-90">{children}</div> : null}
      </div>
    </div>
  );
}
