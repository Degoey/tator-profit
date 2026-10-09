"use client";

import { KeyRound, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

import { FormField } from "@/components/auth/form-field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Completes the password reset that `/forgot-password` starts. The token arrives
 * through the link the user received; the new password is validated again on the
 * server before it is hashed and every existing session is revoked.
 */
export function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tokenFromUrl = searchParams.get("token") ?? "";

  const [token, setToken] = React.useState(tokenFromUrl);
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [done, setDone] = React.useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFieldErrors({});

    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password, confirmPassword }),
      });
      const payload = (await response.json()) as {
        ok: boolean;
        message?: string;
        fieldErrors?: Record<string, string>;
      };

      if (!response.ok || !payload.ok) {
        setError(payload.message ?? "Kata sandi tidak dapat diubah saat ini.");
        setFieldErrors(payload.fieldErrors ?? {});
        return;
      }

      setDone(true);
      router.refresh();
    } catch {
      setError("Gangguan jaringan. Silakan coba lagi.");
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <div className="space-y-5">
        <Alert variant="success" title="Kata sandi diperbarui">
          Kata sandi baru sudah tersimpan dan seluruh sesi lama dicabut. Silakan masuk kembali dengan
          kata sandi baru Anda.
        </Alert>
        <Button asChild className="w-full">
          <Link href="/login">Masuk ke akun</Link>
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      {error ? (
        <Alert variant="danger" title="Atur ulang gagal">
          {error}
        </Alert>
      ) : null}

      <FormField
        label="Token atur ulang"
        htmlFor="reset-token"
        error={fieldErrors.token}
        hint="Token dikirim melalui tautan atur ulang. Tautan hanya dapat dipakai satu kali."
      >
        <Input
          id="reset-token"
          name="token"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          autoComplete="one-time-code"
          required
        />
      </FormField>

      <FormField
        label="Kata sandi baru"
        htmlFor="reset-password"
        error={fieldErrors.password}
        hint="Minimal 8 karakter, memuat huruf besar, huruf kecil, dan angka."
      >
        <Input
          id="reset-password"
          name="password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </FormField>

      <FormField
        label="Ulangi kata sandi baru"
        htmlFor="reset-password-confirm"
        error={fieldErrors.confirmPassword}
      >
        <Input
          id="reset-password-confirm"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          required
        />
      </FormField>

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <KeyRound aria-hidden />}
        {pending ? "Menyimpan..." : "Simpan kata sandi baru"}
      </Button>

      <p className="text-xs leading-relaxed text-white/50">
        Belum punya token?{" "}
        <Link href="/forgot-password" className="text-[var(--color-neon)] underline-offset-4 hover:underline">
          Minta tautan atur ulang
        </Link>
        .
      </p>
    </form>
  );
}
