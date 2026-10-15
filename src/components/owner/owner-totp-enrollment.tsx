"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { CopyButton } from "@/components/owner/copy-button";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Pendaftaran 2FA pemilik, dua langkah:
 *
 *  1. server membuat rahasia baru (ditampilkan sekali untuk dimasukkan ke
 *     aplikasi autentikator; di database hanya tersimpan versi terenkripsinya);
 *  2. pemilik memasukkan satu kode yang sah untuk mengaktifkannya, dan menerima
 *     kode pemulihan sekali-pakai yang harus disimpan di luar perangkat.
 *
 * Langkah 2 penting: 2FA tidak pernah "aktif" hanya karena tombol ditekan —
 * harus ada bukti bahwa aplikasi autentikator benar-benar sudah memegang rahasia
 * yang sama.
 */
export function OwnerTotpEnrollment({ account }: { account: string }) {
  const router = useRouter();
  const [stage, setStage] = React.useState<"idle" | "ready" | "done">("idle");
  const [secret, setSecret] = React.useState("");
  const [otpauth, setOtpauth] = React.useState("");
  const [code, setCode] = React.useState("");
  const [recoveryCodes, setRecoveryCodes] = React.useState<string[]>([]);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const grouped = secret.replace(/(.{4})/g, "$1 ").trim();

  async function start() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/owner/2fa/setup", { method: "POST" });
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; message?: string; data?: { secret: string; otpauthUri: string } }
        | null;
      if (!response.ok || !payload?.ok || !payload.data) {
        setPending(false);
        setError(payload?.message ?? "Pendaftaran 2FA tidak dapat dimulai.");
        return;
      }
      setSecret(payload.data.secret);
      setOtpauth(payload.data.otpauthUri);
      setStage("ready");
      setPending(false);
    } catch {
      setPending(false);
      setError("Tidak dapat menghubungi server.");
    }
  }

  async function activate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/owner/2fa/activate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; message?: string; data?: { recoveryCodes: string[] } }
        | null;
      if (!response.ok || !payload?.ok || !payload.data) {
        setPending(false);
        setError(payload?.message ?? "2FA tidak dapat diaktifkan.");
        return;
      }
      setRecoveryCodes(payload.data.recoveryCodes);
      setStage("done");
      setPending(false);
      router.refresh();
    } catch {
      setPending(false);
      setError("Tidak dapat menghubungi server.");
    }
  }

  if (stage === "done") {
    return (
      <div className="space-y-4">
        <Alert variant="success" title="2FA aktif">
          Kode berikut hanya ditampilkan sekali. Simpan di tempat yang aman (bukan di perangkat yang
          sama dengan autentikator). Setiap kode hanya dapat dipakai sekali.
        </Alert>

        <ul className="grid gap-2 sm:grid-cols-2">
          {recoveryCodes.map((item) => (
            <li
              key={item}
              className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 font-mono text-sm text-white"
            >
              {item}
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap gap-2">
          <CopyButton value={recoveryCodes.join("\n")} label="Salin semua kode" />
          <Button type="button" onClick={() => router.push("/owner")}>
            Buka konsol
          </Button>
        </div>
      </div>
    );
  }

  if (stage === "ready") {
    return (
      <div className="space-y-4">
        {error ? (
          <Alert variant="danger" title="2FA belum aktif">
            {error}
          </Alert>
        ) : null}

        <ol className="space-y-2 text-sm text-white/70">
          <li>1. Buka aplikasi autentikator (Google Authenticator, Authy, 1Password, dsb.).</li>
          <li>2. Pilih tambah akun → masukkan kunci secara manual (bukan pindai QR).</li>
          <li>
            3. Nama akun: <span className="font-mono text-white">{account}</span> — jenis: berbasis
            waktu (TOTP).
          </li>
          <li>4. Tempel kunci di bawah, lalu masukkan kode 6 angka yang muncul.</li>
        </ol>

        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/45">Kunci setup</p>
          <p className="break-all rounded-xl border border-white/12 bg-white/[0.04] p-3 font-mono text-sm text-white">
            {grouped}
          </p>
          <div className="flex flex-wrap gap-2">
            <CopyButton value={secret} label="Salin kunci" />
            <CopyButton value={otpauth} label="Salin URI otpauth" />
          </div>
          <p className="break-all text-xs text-white/40">{otpauth}</p>
        </div>

        <form onSubmit={activate} className="space-y-3">
          <div className="space-y-1.5">
            <label
              htmlFor="owner-2fa-activate"
              className="block text-xs font-semibold uppercase tracking-[0.14em] text-white/45"
            >
              Kode 6 angka dari autentikator
            </label>
            <Input
              id="owner-2fa-activate"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              maxLength={16}
              placeholder="123456"
            />
          </div>
          <Button type="submit" disabled={pending || code.trim().length === 0}>
            {pending ? "Mengaktifkan..." : "Aktifkan 2FA"}
          </Button>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error ? (
        <Alert variant="danger" title="Pendaftaran gagal">
          {error}
        </Alert>
      ) : null}
      <p className="text-sm text-white/70">
        Konsol Pemilik mewajibkan 2FA. Selama 2FA belum aktif, seluruh halaman dan API konsol menolak
        permintaan — termasuk untuk akun tuanku sendiri.
      </p>
      <Button type="button" onClick={start} disabled={pending}>
        {pending ? "Menyiapkan..." : "Mulai pendaftaran 2FA"}
      </Button>
    </div>
  );
}
