"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { ConfirmDialog, Modal } from "@/components/payments/modal";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/money";
import { statusLabel } from "@/lib/status-labels";

/**
 * Panel tinjauan uang untuk Konsol Pemilik (setoran dan penarikan).
 *
 * Setiap tindakan melewati dua langkah: pilih aksi + alasan, lalu konfirmasi
 * eksplisit. Tidak ada satu klik yang langsung memindahkan uang, dan aksi yang
 * ditolak server ditampilkan apa adanya tanpa menutup dialog.
 */

export interface OwnerPaymentRow {
  id: string;
  status: string;
  amount: string;
  currency: string;
  username: string;
  userEmail: string;
  createdAt: string;
  reference: string;
  detail: string;
  note: string | null;
}

export type OwnerPaymentKind = "deposit" | "withdrawal";

interface ActionOption {
  value: string;
  label: string;
  description: string;
  requiresReason: boolean;
}

/** Tupel (bukan array biasa) supaya aksi pertama pasti ada sebagai nilai bawaan. */
const DEPOSIT_ACTIONS: readonly [ActionOption, ...ActionOption[]] = [
  {
    value: "APPROVED",
    label: "Setujui",
    description: "Dana masuk bucket dana program, keanggotaan aktif, dan imbalan periode pertama dibuat.",
    requiresReason: false,
  },
  {
    value: "UNDER_REVIEW",
    label: "Tandai sedang ditinjau",
    description: "Setoran tetap menunggu; tidak ada dana yang berpindah.",
    requiresReason: false,
  },
  {
    value: "FLAGGED",
    label: "Tandai mencurigakan",
    description: "Setoran ditandai untuk pemeriksaan lanjutan; tidak ada dana yang berpindah.",
    requiresReason: true,
  },
  {
    value: "REJECTED",
    label: "Tolak",
    description: "Setoran ditolak dengan alasan tertulis; tidak ada dana yang berpindah.",
    requiresReason: true,
  },
];

/** Tupel (bukan array biasa) supaya aksi pertama pasti ada sebagai nilai bawaan. */
const WITHDRAWAL_ACTIONS: readonly [ActionOption, ...ActionOption[]] = [
  {
    value: "APPROVED",
    label: "Setujui",
    description: "Penarikan disetujui; dana tetap tercadang sampai ditandai selesai.",
    requiresReason: false,
  },
  {
    value: "PROCESSING",
    label: "Tandai sedang diproses",
    description: "Transfer manual sedang dilakukan di luar platform.",
    requiresReason: false,
  },
  {
    value: "COMPLETED",
    label: "Tandai selesai",
    description: "Cadangan dana didebit permanen. Lampirkan bukti transfer bila ada.",
    requiresReason: false,
  },
  {
    value: "UNDER_REVIEW",
    label: "Tandai sedang ditinjau",
    description: "Penarikan ditahan untuk pemeriksaan; tidak ada dana yang berpindah.",
    requiresReason: false,
  },
  {
    value: "REJECTED",
    label: "Tolak",
    description: "Dana cadangan dikembalikan ke saldo tersedia; alasan wajib diisi.",
    requiresReason: true,
  },
];

export interface OwnerReviewPanelProps {
  kind: OwnerPaymentKind;
  rows: OwnerPaymentRow[];
  emptyMessage: string;
}

export function OwnerReviewPanel({ kind, rows, emptyMessage }: OwnerReviewPanelProps) {
  const router = useRouter();
  const actions = kind === "deposit" ? DEPOSIT_ACTIONS : WITHDRAWAL_ACTIONS;
  const endpoint = kind === "deposit" ? "/api/owner/deposits" : "/api/owner/withdrawals";
  const noun = kind === "deposit" ? "setoran" : "penarikan";

  const [selected, setSelected] = React.useState<OwnerPaymentRow | null>(null);
  const [action, setAction] = React.useState<string>(actions[0].value);
  const [reason, setReason] = React.useState("");
  const [confirming, setConfirming] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [feedback, setFeedback] = React.useState<{ tone: "success" | "danger"; text: string } | null>(
    null,
  );

  const chosen = actions.find((option) => option.value === action) ?? actions[0];
  const reasonMissing = chosen.requiresReason && reason.trim().length < 3;

  function openDialog(row: OwnerPaymentRow) {
    setSelected(row);
    setAction(actions[0].value);
    setReason("");
    setFeedback(null);
    setConfirming(false);
  }

  function closeDialog() {
    if (pending) return;
    setSelected(null);
    setConfirming(false);
  }

  async function submit() {
    if (!selected) return;
    setPending(true);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: selected.id,
          action,
          reason: reason.trim().length > 0 ? reason.trim() : undefined,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; message?: string }
        | null;

      if (!response.ok || !payload?.ok) {
        setConfirming(false);
        setPending(false);
        setFeedback({
          tone: "danger",
          text: payload?.message ?? `Tindakan pada ${noun} gagal.`,
        });
        return;
      }

      setPending(false);
      setSelected(null);
      setConfirming(false);
      setFeedback({
        tone: "success",
        text: `Aksi "${chosen.label}" tercatat untuk @${selected.username} (${selected.reference}).`,
      });
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

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-6 text-center text-sm text-white/50">
          {emptyMessage}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full min-w-[46rem] border-collapse text-left text-sm">
            <caption className="sr-only">Antrean {noun} terbaru</caption>
            <thead>
              <tr className="bg-white/[0.04] text-[11px] uppercase tracking-[0.12em] text-white/45">
                <th scope="col" className="px-3.5 py-3 font-semibold">Anggota</th>
                <th scope="col" className="px-3.5 py-3 font-semibold">Jumlah</th>
                <th scope="col" className="px-3.5 py-3 font-semibold">Rincian</th>
                <th scope="col" className="px-3.5 py-3 font-semibold">Status</th>
                <th scope="col" className="px-3.5 py-3 font-semibold">Waktu</th>
                <th scope="col" className="px-3.5 py-3 font-semibold">Tindakan</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-white/8 align-top">
                  <td className="px-3.5 py-3 text-xs">
                    <span className="block font-medium text-white">@{row.username}</span>
                    <span className="block text-white/45">{row.userEmail}</span>
                  </td>
                  <td className="px-3.5 py-3 text-xs font-semibold text-white">
                    {formatMoney(row.amount, row.currency)}
                  </td>
                  <td className="px-3.5 py-3 text-xs text-white/70">
                    <span className="block">{row.detail}</span>
                    <span className="block text-white/40">{row.reference}</span>
                    {row.note ? <span className="block text-white/50">{row.note}</span> : null}
                  </td>
                  <td className="px-3.5 py-3">
                    <Badge
                      variant={
                        row.status === "APPROVED" || row.status === "COMPLETED"
                          ? "default"
                          : row.status === "REJECTED" || row.status === "FLAGGED"
                            ? "danger"
                            : "gold"
                      }
                    >
                      {statusLabel(row.status)}
                    </Badge>
                  </td>
                  <td className="px-3.5 py-3 text-xs text-white/50">
                    {new Date(row.createdAt).toLocaleString("id-ID")}
                  </td>
                  <td className="px-3.5 py-3">
                    <Button type="button" size="sm" variant="outline" onClick={() => openDialog(row)}>
                      Tinjau
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={Boolean(selected) && !confirming}
        onClose={closeDialog}
        title={`Tinjau ${noun}`}
        description={
          selected
            ? `@${selected.username} · ${formatMoney(selected.amount, selected.currency)} · ${selected.reference}`
            : undefined
        }
        locked={pending}
        footer={
          <>
            <Button type="button" variant="ghost" onClick={closeDialog} disabled={pending}>
              Batal
            </Button>
            <Button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={pending || reasonMissing}
            >
              Lanjut ke konfirmasi
            </Button>
          </>
        }
      >
        <fieldset className="space-y-3">
          <legend className="text-xs font-semibold uppercase tracking-[0.14em] text-white/45">
            Pilih tindakan
          </legend>
          {actions.map((option) => (
            <label
              key={option.value}
              className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm"
            >
              <input
                type="radio"
                name={`owner-${kind}-action`}
                value={option.value}
                checked={action === option.value}
                onChange={() => setAction(option.value)}
                className="mt-1"
              />
              <span>
                <span className="block font-medium text-white">{option.label}</span>
                <span className="block text-xs text-white/55">{option.description}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="space-y-1.5">
          <label
            htmlFor={`owner-${kind}-reason`}
            className="block text-xs font-semibold uppercase tracking-[0.14em] text-white/45"
          >
            Alasan {chosen.requiresReason ? "(wajib)" : "(opsional)"}
          </label>
          <Input
            id={`owner-${kind}-reason`}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={500}
            placeholder="Contoh: dana terverifikasi di rekening platform"
          />
          {reasonMissing ? (
            <p className="text-xs text-red-300">Alasan minimal 3 karakter untuk aksi ini.</p>
          ) : null}
        </div>

        <p className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-white/55">
          Tindakan ini ditulis ke jejak audit beserta alasan, alamat IP, dan waktu. Aturan ledger dan
          status dijalankan server, jadi hasilnya sama seperti dari panel administrasi.
        </p>
      </Modal>

      <ConfirmDialog
        open={Boolean(selected) && confirming}
        title={`${chosen.label} ${noun}?`}
        description={
          selected
            ? `@${selected.username} · ${formatMoney(selected.amount, selected.currency)} · ${selected.reference}`
            : ""
        }
        confirmLabel={chosen.label}
        tone={action === "REJECTED" || action === "FLAGGED" ? "danger" : "default"}
        pending={pending}
        onCancel={() => setConfirming(false)}
        onConfirm={submit}
      >
        <p className="text-sm text-white/70">{chosen.description}</p>
        {reason.trim().length > 0 ? (
          <p className="text-xs text-white/50">Alasan: {reason.trim()}</p>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
