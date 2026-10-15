"use client";

import {
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
} from "@simplewebauthn/browser";
import { useRouter } from "next/navigation";
import * as React from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { describePasskeyError, passkeySupported } from "@/lib/owner/passkey-client";

/**
 * Pendaftaran passkey (sidik jari / Face ID) untuk Konsol Pemilik.
 *
 * Satu tombol: peramban membuka dialog sidik jari perangkat, lalu server
 * memverifikasi balasannya dan menyimpan kunci publiknya. Tidak ada kode, tidak ada
 * rahasia yang ditampilkan, dan tidak ada yang perlu disalin — kunci privat tidak
 * pernah meninggalkan perangkat.
 */
export function OwnerPasskeyEnrollment({ account }: { account: string }) {
  const router = useRouter();
  const [deviceName, setDeviceName] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [registered, setRegistered] = React.useState(false);

  async function register() {
    /**
     * Dukungan WebAuthn diperiksa saat tombol ditekan, bukan lewat efek: server
     * tidak punya `window`, jadi memeriksanya saat render akan menyebabkan
     * ketidakcocokan hidrasi.
     */
    if (!passkeySupported()) {
      setError(
        "Peramban ini tidak menyediakan WebAuthn. Pakai peramban terbaru di perangkat yang punya sensor sidik jari / Face ID.",
      );
      return;
    }

    setPending(true);
    setError(null);

    try {
      const optionsResponse = await fetch("/api/owner/passkey/register-options", {
        method: "POST",
      });
      const optionsPayload = (await optionsResponse.json().catch(() => null)) as
        | { ok?: boolean; message?: string; data?: PublicKeyCredentialCreationOptionsJSON }
        | null;

      if (!optionsResponse.ok || !optionsPayload?.ok || !optionsPayload.data) {
        setPending(false);
        setError(optionsPayload?.message ?? "Pendaftaran sidik jari tidak dapat dimulai.");
        return;
      }

      const attestation = await startRegistration({ optionsJSON: optionsPayload.data });

      const verifyResponse = await fetch("/api/owner/passkey/register-verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          response: attestation,
          friendlyName: deviceName.trim() || undefined,
        }),
      });
      const verifyPayload = (await verifyResponse.json().catch(() => null)) as
        | { ok?: boolean; message?: string }
        | null;

      if (!verifyResponse.ok || !verifyPayload?.ok) {
        setPending(false);
        setError(verifyPayload?.message ?? "Sidik jari tidak dapat didaftarkan.");
        return;
      }

      setRegistered(true);
      setPending(false);
      router.refresh();
    } catch (caught) {
      setPending(false);
      setError(describePasskeyError(caught, "pendaftaran"));
    }
  }

  if (registered) {
    return (
      <div className="space-y-4">
        <Alert variant="success" title="Sidik jari terdaftar">
          Perangkat ini sekarang dapat dipakai untuk membuka Konsol Pemilik. Verifikasi berlaku{" "}
          terbatas per sesi dan akan diminta lagi setelah masa berlakunya habis.
        </Alert>
        <Button type="button" onClick={() => router.push("/owner")}>
          Buka konsol
        </Button>
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
        Konsol Pemilik mewajibkan sidik jari. Selama belum ada sidik jari terdaftar, seluruh halaman
        dan API konsol menolak permintaan — termasuk untuk akunmu sendiri. Kunci privat tidak pernah
        dikirim ke server.
      </p>

      <div className="space-y-1.5">
        <label
          htmlFor="owner-passkey-name"
          className="block text-xs font-semibold uppercase tracking-[0.14em] text-white/45"
        >
          Nama perangkat (opsional)
        </label>
        <Input
          id="owner-passkey-name"
          value={deviceName}
          onChange={(event) => setDeviceName(event.target.value)}
          maxLength={60}
          placeholder="HP Samsung"
        />
        <p className="text-xs text-white/45">
          Dipakai untuk membedakan perangkat di daftar kredensial. Masuk sebagai {account}.
        </p>
      </div>

      <Button type="button" onClick={register} disabled={pending}>
        {pending ? "Menunggu sidik jari..." : "Daftarkan sidik jari"}
      </Button>
    </div>
  );
}
