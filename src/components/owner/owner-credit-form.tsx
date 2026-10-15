"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { ConfirmDialog } from "@/components/payments/modal";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Kredit saldo dari Konsol Pemilik.
 *
 * Nomor referensi wajib: server memakainya sebagai kunci idempotensi, sehingga
 * permintaan yang terkirim dua kali tidak menambah saldo dua kali. Konfirmasi
 * eksplisit ditampilkan sebelum permintaan dikirim.
 */
export function OwnerCreditForm({ userId, username }: { userId: string; username: string }) {
  const router = useRouter();
  const [amount, setAmount] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [reference, setReference] = React.useState("");
  const [confirming, setConfirming] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [feedback, setFeedback] = React.useState<{ tone: "success" | "danger"; text: string } | null>(
    null,
  );

  const valid =
    /^\d+(\.\d{1,2})?$/.test(amount.trim()) &&
    Number(amount) > 0 &&
    reason.trim().length >= 3 &&
    reference.trim().length >= 3;

  async function submit() {
    setPending(true);
    try {
      const response = await fetch("/api/owner/credits", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId,
          amount: amount.trim(),
          reason: reason.trim(),
          reference: reference.trim(),
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; message?: string }
        | null;

      setPending(false);
      setConfirming(false);

      if (!response.ok || !payload?.ok) {
        setFeedback({ tone: "danger", text: payload?.message ?? "Kredit saldo gagal." });
        return;
      }

      setFeedback({ tone: "success", text: `Kredit ${amount} USDT tercatat untuk @${username}.` });
      setAmount("");
      setReason("");
      setReference("");
      router.refresh();
    } catch {
      setPending(false);
      setConfirming(false);
      setFeedback({ tone: "danger", text: "Tidak dapat menghubungi server." });
    }
  }

  return (
    <div className="space-y-4">
      {feedback ? (
        <Alert variant={feedback.tone} title={feedback.tone === "success" ? "Berhasil" : "Gagal"}>
          {feedback.text}
        </Alert>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <label htmlFor="owner-credit-amount" className="block text-xs font-semibold uppercase tracking-[0.14em] text-white/45">
            Jumlah (USDT)
          </label>
          <Input
            id="owner-credit-amount"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            placeholder="100.00"
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <label htmlFor="owner-credit-reason" className="block text-xs font-semibold uppercase tracking-[0.14em] text-white/45">
            Alasan
          </label>
          <Input
            id="owner-credit-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={200}
            placeholder="Contoh: koreksi setoran yang gagal tercatat"
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <label htmlFor="owner-credit-reference" className="block text-xs font-semibold uppercase tracking-[0.14em] text-white/45">
            Nomor referensi (kunci idempotensi)
          </label>
          <Input
            id="owner-credit-reference"
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            maxLength={120}
            placeholder="OWNER-2026-0001"
          />
        </div>
      </div>

      <Button type="button" onClick={() => setConfirming(true)} disabled={!valid || pending}>
        Kredit saldo
      </Button>
      <p className="text-xs text-white/45">
        Kredit menulis satu entri ledger ADMIN_CREDIT, satu jejak audit, dan satu notifikasi untuk
        anggota — semuanya dalam satu transaksi database. Koreksi tidak pernah menimpa riwayat.
      </p>

      <ConfirmDialog
        open={confirming}
        title="Kredit saldo anggota?"
        description={`@${username} · ${amount} USDT · referensi ${reference}`}
        confirmLabel="Kredit sekarang"
        pending={pending}
        onCancel={() => setConfirming(false)}
        onConfirm={submit}
      >
        <p className="text-sm text-white/70">
          Saldo anggota akan bertambah {amount} USDT dengan alasan &ldquo;{reason}&rdquo;. Referensi{" "}
          {reference} hanya dapat dipakai sekali; permintaan berulang dengan referensi sama
          mengembalikan entri yang sudah ada.
        </p>
      </ConfirmDialog>
    </div>
  );
}
