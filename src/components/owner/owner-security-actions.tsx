"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { ConfirmDialog } from "@/components/payments/modal";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * Tindakan keamanan pemilik: mencabut sesi lain dan menghapus sidik jari.
 *
 * Tidak ada kode dan tidak ada kode pemulihan: rute-rute ini hanya dapat dicapai
 * dari sesi yang sudah lolos verifikasi passkey, jadi sesi yang sudah dibajak pun
 * tidak bisa memanggilnya tanpa memegang sidik jari.
 */
export interface OwnerPasskeyCredential {
  credentialId: string;
  friendlyName: string | null;
  deviceType: string;
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

type Action = { kind: "sessions" } | { kind: "remove"; credential: OwnerPasskeyCredential };

function formatTime(value: string | null): string {
  if (!value) return "belum pernah";
  return new Date(value).toLocaleString("id-ID");
}

export function OwnerSecurityActions({
  credentials,
}: {
  credentials: OwnerPasskeyCredential[];
}) {
  const router = useRouter();
  const [action, setAction] = React.useState<Action | null>(null);
  const [pending, setPending] = React.useState(false);
  const [feedback, setFeedback] = React.useState<{ tone: "success" | "danger"; text: string } | null>(
    null,
  );

  const isLastCredential = credentials.length <= 1;

  function open(next: Action) {
    setAction(next);
    setFeedback(null);
  }

  function close() {
    if (pending) return;
    setAction(null);
  }

  async function submit() {
    if (!action) return;
    setPending(true);

    try {
      const endpoint =
        action.kind === "sessions" ? "/api/owner/sessions/revoke" : "/api/owner/passkey/remove";
      const body =
        action.kind === "sessions" ? undefined : { credentialId: action.credential.credentialId };

      const response = await fetch(endpoint, {
        method: "POST",
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; message?: string; data?: { revokedCount?: number; remainingCredentials?: number } }
        | null;

      if (!response.ok || !payload?.ok) {
        setPending(false);
        setAction(null);
        setFeedback({ tone: "danger", text: payload?.message ?? "Tindakan gagal." });
        return;
      }

      setPending(false);
      setAction(null);

      if (action.kind === "sessions") {
        setFeedback({
          tone: "success",
          text: `Sesi lain dicabut: ${payload.data?.revokedCount ?? 0}.`,
        });
      } else {
        const remaining = payload.data?.remainingCredentials ?? 0;
        setFeedback({
          tone: "success",
          text:
            remaining === 0
              ? "Sidik jari terakhir dihapus. Konsol kembali meminta pendaftaran sidik jari."
              : `Sidik jari dihapus. Sisa kredensial: ${remaining}.`,
        });
      }
      router.refresh();
    } catch {
      setPending(false);
      setAction(null);
      setFeedback({ tone: "danger", text: "Tidak dapat menghubungi server." });
    }
  }

  return (
    <div className="space-y-4">
      {feedback ? (
        <Alert variant={feedback.tone} title={feedback.tone === "success" ? "Selesai" : "Gagal"}>
          {feedback.text}
        </Alert>
      ) : null}

      <ul className="space-y-2">
        {credentials.map((credential) => (
          <li
            key={credential.credentialId}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 text-xs"
          >
            <span className="flex items-center gap-2">
              <Badge variant="default">{credential.friendlyName ?? "Perangkat passkey"}</Badge>
              <Badge variant="muted">
                {credential.deviceType === "multiDevice" ? "Tersinkron" : "Perangkat tunggal"}
              </Badge>
              {credential.backedUp ? <Badge variant="muted">Dicadangkan</Badge> : null}
            </span>
            <span className="text-white/45">
              Didaftarkan {formatTime(credential.createdAt)} · terakhir dipakai{" "}
              {formatTime(credential.lastUsedAt)}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => open({ kind: "remove", credential })}
            >
              Hapus sidik jari
            </Button>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => open({ kind: "sessions" })}>
          Cabut semua sesi lain
        </Button>
      </div>

      <ConfirmDialog
        open={action?.kind === "sessions"}
        title="Cabut semua sesi lain?"
        description="Setiap sesi Konsol Pemilik selain sesi ini akan dihentikan. Perangkat lain harus masuk dan memverifikasi sidik jari lagi."
        confirmLabel="Cabut sesi lain"
        pending={pending}
        onCancel={close}
        onConfirm={submit}
      />

      <ConfirmDialog
        open={action?.kind === "remove"}
        title="Hapus sidik jari ini?"
        description={
          isLastCredential
            ? "Ini kredensial terakhir. Setelah dihapus, konsol menolak seluruh permintaan sampai sidik jari didaftarkan ulang — termasuk untukmu sendiri."
            : "Perangkat ini tidak akan bisa lagi membuka konsol. Kredensial lain tetap berlaku."
        }
        confirmLabel="Hapus sidik jari"
        tone="danger"
        pending={pending}
        onCancel={close}
        onConfirm={submit}
      />
    </div>
  );
}
