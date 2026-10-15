"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Langkah verifikasi sesi dengan kode 2FA.
 *
 * Halaman ini hanya dapat dibuka oleh pemilik yang sudah masuk tetapi sesinya
 * belum diverifikasi. Berhasil berarti server menandai sesi ini dan konsol
 * terbuka; pemilik juga dapat memakai satu kode pemulihan bila perangkat
 * autentikatornya hilang.
 */
export function OwnerStepUpForm({ ownerEmail }: { ownerEmail: string }) {
  const router = useRouter();
  const [mode, setMode] = React.useState<"code" | "recovery">("code");
  const [value, setValue] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const body = mode === "code" ? { code: value } : { recoveryCode: value };
      const response = await fetch("/api/owner/2fa/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; message?: string }
        | null;

      if (!response.ok || !payload?.ok) {
        setPending(false);
        setError(payload?.message ?? "Kode tidak dapat diverifikasi.");
        return;
      }

      router.replace("/owner");
      router.refresh();
    } catch {
      setPending(false);
      setError("Tidak dapat menghubungi server.");
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error ? (
        <Alert variant="danger" title="Verifikasi gagal">
          {error}
        </Alert>
      ) : null}

      <div className="space-y-1.5">
        <label
          htmlFor="owner-2fa-code"
          className="block text-xs font-semibold uppercase tracking-[0.14em] text-white/45"
        >
          {mode === "code" ? "Kode 6 angka dari aplikasi autentikator" : "Kode pemulihan"}
        </label>
        <Input
          id="owner-2fa-code"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          inputMode={mode === "code" ? "numeric" : "text"}
          autoComplete="one-time-code"
          autoFocus
          required
          maxLength={24}
          placeholder={mode === "code" ? "123456" : "XXXX-XXXX-XXXX"}
        />
        <p className="text-xs text-white/45">
          Masuk sebagai {ownerEmail}. Satu kode hanya dapat dipakai sekali.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={pending || value.trim().length === 0}>
          {pending ? "Memverifikasi..." : "Buka konsol"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setMode(mode === "code" ? "recovery" : "code");
            setValue("");
            setError(null);
          }}
        >
          {mode === "code" ? "Pakai kode pemulihan" : "Pakai kode autentikator"}
        </Button>
      </div>
    </form>
  );
}
