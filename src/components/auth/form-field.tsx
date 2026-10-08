import * as React from "react";

import { Label } from "@/components/ui/label";

export interface FormFieldProps {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}

/** Label + control + inline error/hint, shared by the auth forms. */
export function FormField({ label, htmlFor, error, hint, children }: FormFieldProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? <p className="text-xs font-medium text-red-300">{error}</p> : null}
      {!error && hint ? <p className="text-xs text-white/40">{hint}</p> : null}
    </div>
  );
}
