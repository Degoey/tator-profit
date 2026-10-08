import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-11 w-full rounded-xl border border-white/12 bg-white/[0.04] px-3.5 py-2 text-sm text-white shadow-sm transition-colors",
          "placeholder:text-white/35 focus-visible:border-[var(--color-neon)]/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-neon)]/25",
          "disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-red-500/70",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
