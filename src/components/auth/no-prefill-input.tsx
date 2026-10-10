"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";

/**
 * Text input that the browser is not allowed to pre-fill.
 *
 * `autoComplete="off"` alone does not work: Chrome and Edge ignore it for
 * personal fields (name, e-mail, phone) and type the visitor's saved profile
 * into the form before they touch it, so "Nama lengkap" already shows a name
 * nobody in this session typed. Autofill only fills writable controls, so the
 * field stays `readOnly` until the visitor interacts with it and is unlocked
 * on the first focus — mouse, tap or keyboard, all of which focus the control.
 *
 * Used everywhere the app asks for someone's own data: sign-up, the profile
 * editor (where autofill would overwrite the value loaded from the database),
 * the password-reset e-mail and the withdrawal destination.
 *
 * The wrapper never owns the value: it only decides *when* the field becomes
 * editable, so the caller keeps its controlled `value`/`onChange` untouched.
 */
export function NoPrefillInput({ onFocus, ...props }: React.ComponentProps<typeof Input>) {
  const [locked, setLocked] = React.useState(true);

  return (
    <Input
      {...props}
      readOnly={locked}
      onFocus={(event) => {
        setLocked(false);
        onFocus?.(event);
      }}
    />
  );
}
