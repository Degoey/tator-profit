"use client";

import { Loader2, LogIn } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

import { FormField } from "@/components/auth/form-field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next") ?? "/dashboard";

  const [identifier, setIdentifier] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [remember, setRemember] = React.useState(true);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [pending, setPending] = React.useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setFormError(null);
    setFieldErrors({});

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, password, remember }),
      });

      const payload = (await response.json()) as {
        ok: boolean;
        message?: string;
        fieldErrors?: Record<string, string>;
      };

      if (!response.ok || !payload.ok) {
        setFieldErrors(payload.fieldErrors ?? {});
        setFormError(payload.message ?? "Masuk gagal. Periksa kembali kredensial Anda.");
        return;
      }

      router.push(nextPath.startsWith("/") ? nextPath : "/dashboard");
      router.refresh();
    } catch {
      setFormError("Gangguan jaringan. Silakan coba lagi.");
    } finally {
      setPending(false);
    }
  }

  return (
    // The credentials fields deliberately opt out of browser autofill/address
    // pre-fill, so nothing personal shows up before the visitor types. A password
    // manager can still fill the password from its own UI.
    <form onSubmit={handleSubmit} className="space-y-5" autoComplete="off" noValidate>
      {formError ? (
        <Alert variant="danger" title="Masuk gagal">
          {formError}
        </Alert>
      ) : null}

      <FormField
        label="Nama pengguna atau surel"
        error={fieldErrors.identifier}
        htmlFor="identifier"
      >
        <Input
          id="identifier"
          name="identifier"
          autoComplete="off"
          placeholder="nama_pengguna atau anda@contoh.com"
          value={identifier}
          onChange={(event) => setIdentifier(event.target.value)}
          aria-invalid={Boolean(fieldErrors.identifier)}
          required
        />
      </FormField>

      <FormField label="Kata sandi" error={fieldErrors.password} htmlFor="password">
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          placeholder="Kata sandi Anda"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-invalid={Boolean(fieldErrors.password)}
          required
        />
      </FormField>

      <div className="flex items-center justify-between text-sm">
        <label className="flex items-center gap-2 text-white/65">
          <input
            type="checkbox"
            checked={remember}
            onChange={(event) => setRemember(event.target.checked)}
            className="size-4 rounded border-white/25 bg-transparent accent-[var(--color-neon)]"
          />
          Tetap masuk
        </label>
        <Link
          href="/forgot-password"
          className="font-medium text-[var(--color-neon)] hover:underline"
        >
          Lupa kata sandi?
        </Link>
      </div>

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <LogIn aria-hidden />}
        {pending ? "Memproses..." : "Masuk"}
      </Button>

      <p className="text-center text-sm text-white/55">
        Belum punya akun?{" "}
        <Link href="/register" className="font-semibold text-[var(--color-neon)] hover:underline">
          Daftar sekarang
        </Link>
      </p>
    </form>
  );
}
