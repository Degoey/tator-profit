"use client";

import { KeyRound, Loader2, MailCheck } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { FormField } from "@/components/auth/form-field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ForgotPasswordForm() {
  const [email, setEmail] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [devToken, setDevToken] = React.useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setMessage(null);
    setDevToken(null);

    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const payload = (await response.json()) as {
        ok: boolean;
        message?: string;
        data?: { devToken?: string; expiresAt?: string };
      };

      if (!response.ok || !payload.ok) {
        setError(payload.message ?? "Permintaan tidak dapat diproses saat ini.");
        return;
      }

      setMessage(
        "Jika surel terdaftar, instruksi atur ulang kata sandi telah dibuat dan berlaku 60 menit.",
      );
      if (payload.data?.devToken) setDevToken(payload.data.devToken);
    } catch {
      setError("Gangguan jaringan. Silakan coba lagi.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      {error ? (
        <Alert variant="danger" title="Permintaan gagal">
          {error}
        </Alert>
      ) : null}
      {message ? (
        <Alert variant="success" title="Permintaan diterima">
          {message}
        </Alert>
      ) : null}

      <FormField
        label="Surel terdaftar"
        htmlFor="email"
        hint="Kami tidak mengungkap apakah surel terdaftar atau tidak (mencegah enumerasi akun)."
      >
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="anda@contoh.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </FormField>

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <MailCheck aria-hidden />}
        {pending ? "Mengirim..." : "Minta atur ulang"}
      </Button>

      {devToken ? (
        <Alert variant="info" title="Mode pengembangan: token atur ulang">
          <p className="break-all font-mono text-xs">{devToken}</p>
          <p className="mt-2 text-xs opacity-80">
            Token ini hanya muncul karena pengalih pengembangan lokal
            (<span className="font-mono">ALLOW_DEV_RESET_TOKEN=1</span>) aktif. Di produksi token
            dikirim melalui surel dan tidak pernah dikembalikan oleh API.
          </p>
          <p className="mt-2 text-xs">
            <Link
              href={`/reset-password?token=${encodeURIComponent(devToken)}`}
              className="font-semibold text-[var(--color-neon)] underline-offset-4 hover:underline"
            >
              Lanjutkan ke halaman atur ulang
            </Link>
          </p>
        </Alert>
      ) : null}

      <p className="flex items-center gap-2 text-xs text-white/60">
        <KeyRound className="size-3.5" aria-hidden />
        Struktur atur ulang kata sandi sudah tersedia: token disimpan sebagai hash, sekali pakai, dan
        berlaku 60 menit.
      </p>

      <p className="text-xs text-white/60">
        Sudah punya token?{" "}
        <Link
          href="/reset-password"
          className="text-[var(--color-neon)] underline-offset-4 hover:underline"
        >
          Buka halaman atur ulang kata sandi
        </Link>
        .
      </p>
    </form>
  );
}
