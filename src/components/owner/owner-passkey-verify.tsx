"use client";

import {
  startAuthentication,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { useRouter } from "next/navigation";
import * as React from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { describePasskeyError, passkeySupported } from "@/lib/owner/passkey-client";

/**
 * Verifikasi sesi (step-up) dengan passkey.
 *
 * Halaman ini hanya dapat dibuka oleh pemilik yang sudah masuk tetapi sesinya belum
 * diverifikasi. Satu tombol membuka dialog sidik jari perangkat; berhasil berarti
 * server menandai sesi ini dan konsol terbuka.
 */
export function OwnerPasskeyVerify({ ownerEmail }: { ownerEmail: string }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function verify() {
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
      const optionsResponse = await fetch("/api/owner/passkey/authenticate-options", {
        method: "POST",
      });
      const optionsPayload = (await optionsResponse.json().catch(() => null)) as
        | { ok?: boolean; message?: string; data?: PublicKeyCredentialRequestOptionsJSON }
        | null;

      if (!optionsResponse.ok || !optionsPayload?.ok || !optionsPayload.data) {
        setPending(false);
        setError(optionsPayload?.message ?? "Verifikasi sidik jari tidak dapat dimulai.");
        return;
      }

      const assertion = await startAuthentication({ optionsJSON: optionsPayload.data });

      const verifyResponse = await fetch("/api/owner/passkey/authenticate-verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ response: assertion }),
      });
      const verifyPayload = (await verifyResponse.json().catch(() => null)) as
        | { ok?: boolean; message?: string }
        | null;

      if (!verifyResponse.ok || !verifyPayload?.ok) {
        setPending(false);
        setError(verifyPayload?.message ?? "Sidik jari tidak dapat diverifikasi.");
        return;
      }

      router.replace("/owner");
      router.refresh();
    } catch (caught) {
      setPending(false);
      setError(describePasskeyError(caught, "verifikasi"));
    }
  }

  return (
    <div className="space-y-4">
      {error ? (
        <Alert variant="danger" title="Verifikasi gagal">
          {error}
        </Alert>
      ) : null}

      <p className="text-sm text-white/70">
        Masuk sebagai {ownerEmail}. Sentuh sensor sidik jari untuk melanjutkan.
      </p>

      <Button type="button" onClick={verify} disabled={pending} autoFocus>
        {pending ? "Menunggu sidik jari..." : "Verifikasi dengan sidik jari"}
      </Button>
    </div>
  );
}
