"use client";

import { AlertTriangle, BadgeCheck, Banknote, Ban, Eye, Loader2 } from "lucide-react";
import * as React from "react";

import { DataTable, type DataTableColumn } from "@/components/payments/data-table";
import { ConfirmDialog, Modal } from "@/components/payments/modal";
import { PaymentStatusBadge, formatPaymentDate } from "@/components/payments/status-badge";
import { DetailItem, RequestAuditList, type RequestAuditEntry } from "@/components/payments/review-detail";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/money";

export interface AdminRewardRow {
  id: string;
  userName: string;
  userUsername: string;
  userEmail: string;
  programName: string;
  tierCode: string;
  /** Week number inside the cycle (1..cycle weeks). */
  period: number;
  cycleNumber: number;
  amount: string;
  currency: string;
  rate: string;
  status: string;
  scheduledFor: Date | string | null;
  approvedAt: Date | string | null;
  paidAt: Date | string | null;
  createdAt: Date | string;
  notes: string | null;
  auditHistory: RequestAuditEntry[];
}

/**
 * Aksi siklus imbalan.
 *
 * Urutan uangnya sengaja tiga langkah: `generate` mencatat, `approve` menyiapkan
 * saldo menunggu, `pay` memindahkannya ke saldo yang dapat dipakai. `reject` dan
 * `void` menghentikannya, dan keduanya wajib beralasan karena mengubah hak
 * anggota.
 */
interface RewardAction {
  value: string;
  label: string;
  tone: "default" | "danger";
  requiresReason: boolean;
  /** Status asal yang mengizinkan aksi ini, mengikuti aturan di layanan imbalan. */
  allowedFrom: string[];
  icon: typeof BadgeCheck;
  hint: string;
}

const REWARD_ACTIONS: RewardAction[] = [
  {
    value: "approve",
    label: "Setujui imbalan",
    tone: "default",
    requiresReason: false,
    allowedFrom: ["PENDING"],
    icon: BadgeCheck,
    hint: "Nilai imbalan masuk ke saldo menunggu anggota; uang belum dapat dipakai.",
  },
  {
    value: "pay",
    label: "Bayarkan ke saldo",
    tone: "default",
    requiresReason: false,
    allowedFrom: ["APPROVED"],
    icon: Banknote,
    hint: "Saldo berpindah dari menunggu ke tersedia, sehingga anggota dapat menariknya.",
  },
  {
    value: "reject",
    label: "Tolak imbalan",
    tone: "danger",
    requiresReason: true,
    allowedFrom: ["PENDING"],
    icon: AlertTriangle,
    hint: "Baris berstatus DITOLAK dan tidak lagi dapat disetujui.",
  },
  {
    value: "void",
    label: "Batalkan (VOID)",
    tone: "danger",
    requiresReason: true,
    allowedFrom: ["PENDING", "APPROVED", "PAID", "REJECTED"],
    icon: Ban,
    hint: "Membatalkan baris permanen; imbalan yang sudah dibayar dibalik sebagai entri penyesuaian.",
  },
];

interface PendingAction {
  row: AdminRewardRow;
  action: RewardAction;
}

export function AdminRewardReview({
  rows,
  allowedActions,
}: {
  rows: AdminRewardRow[];
  /** Aksi yang boleh dijalankan administrator ini; kosong berarti hanya baca. */
  allowedActions: string[];
}) {
  const [detail, setDetail] = React.useState<AdminRewardRow | null>(null);
  const [pendingAction, setPendingAction] = React.useState<PendingAction | null>(null);
  const [reason, setReason] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const canDecide = allowedActions.length > 0;

  const columns: DataTableColumn<AdminRewardRow>[] = [
    {
      key: "createdAt",
      header: "Dicatat",
      sortValue: (row) => new Date(row.createdAt).getTime(),
      render: (row) => <span className="text-white/60">{formatPaymentDate(row.createdAt)}</span>,
    },
    {
      key: "user",
      header: "Anggota",
      sortValue: (row) => row.userUsername,
      render: (row) => (
        <div>
          <p className="font-semibold text-white">{row.userName}</p>
          <p className="text-[11px] text-white/40">
            @{row.userUsername} · {row.userEmail}
          </p>
        </div>
      ),
    },
    {
      key: "period",
      header: "Periode",
      sortValue: (row) => row.period,
      render: (row) => (
        <span className="text-white/70">
          Minggu {row.period} · siklus {row.cycleNumber}
        </span>
      ),
    },
    {
      key: "amount",
      header: "Nilai imbalan",
      sortValue: (row) => Number(row.amount),
      render: (row) => (
        <div>
          <p className="font-semibold text-[var(--color-gold)]">
            {formatMoney(row.amount, row.currency)}
          </p>
          <p className="text-[11px] text-white/40">
            {row.tierCode} · tarif {row.rate}%
          </p>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <PaymentStatusBadge status={row.status} />,
    },
    {
      key: "paidAt",
      header: "Dibayar",
      sortValue: (row) => (row.paidAt ? new Date(row.paidAt).getTime() : 0),
      render: (row) => (
        <span className="text-white/60">
          {row.paidAt ? formatPaymentDate(row.paidAt) : "—"}
        </span>
      ),
    },
    {
      key: "action",
      header: "Aksi",
      headerClassName: "text-right",
      className: "text-right",
      render: (row) => (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={(event) => {
            event.stopPropagation();
            setNotice(null);
            setDetail(row);
          }}
        >
          <Eye aria-hidden />
          Tinjau
        </Button>
      ),
    },
  ];

  async function submitAction() {
    if (!pendingAction) return;
    const { row, action } = pendingAction;
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/admin/rewards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: action.value,
          rewardId: row.id,
          reason: reason.trim() || undefined,
        }),
      });
      const payload = (await response.json()) as {
        ok: boolean;
        message?: string;
        fieldErrors?: Record<string, string>;
      };

      if (!response.ok || !payload.ok) {
        setError(
          payload.message ??
            payload.fieldErrors?.reason ??
            "Aksi imbalan tidak dapat diproses.",
        );
        return;
      }

      setNotice(
        `${action.label} untuk @${row.userUsername} — imbalan Minggu ${row.period} ` +
          `(${formatMoney(row.amount, row.currency)}) tercatat.`,
      );
      setPendingAction(null);
      setDetail(null);
      setReason("");
      window.location.reload();
    } catch {
      setError("Gangguan jaringan. Silakan coba lagi.");
    } finally {
      setSubmitting(false);
    }
  }

  const availableActions = detail
    ? REWARD_ACTIONS.filter(
        (action) => allowedActions.includes(action.value) && action.allowedFrom.includes(detail.status),
      )
    : [];

  return (
    <div className="space-y-4">
      {notice ? (
        <Alert variant="success" title="Tindakan tercatat">
          {notice}
        </Alert>
      ) : null}

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        caption="Imbalan anggota: setujui, bayarkan, tolak, atau batalkan"
        searchPlaceholder="Cari anggota, paket, atau status..."
        searchText={(row) =>
          [
            row.userName,
            row.userUsername,
            row.userEmail,
            row.programName,
            row.tierCode,
            row.status,
          ].join(" ")
        }
        filters={{
          label: "Status",
          options: [
            { value: "PENDING", label: "Menunggu" },
            { value: "APPROVED", label: "Disetujui" },
            { value: "PAID", label: "Dibayar" },
            { value: "REJECTED", label: "Ditolak" },
            { value: "VOID", label: "Dibatalkan (VOID)" },
          ],
          match: (row, value) => row.status === value,
        }}
        onRowClick={(row) => {
          setNotice(null);
          setDetail(row);
        }}
        rowAriaLabel={(row) => `Tinjau imbalan @${row.userUsername} minggu ${row.period}`}
        emptyMessage="Belum ada imbalan pada filter ini."
      />

      <Modal
        open={detail !== null}
        onClose={() => {
          setDetail(null);
          setError(null);
        }}
        title="Tinjau imbalan"
        description={detail ? `Dicatat ${formatPaymentDate(detail.createdAt)}` : undefined}
        size="lg"
        footer={
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setDetail(null);
              setError(null);
            }}
          >
            Tutup
          </Button>
        }
      >
        {detail ? (
          <div className="space-y-4">
            {error ? (
              <Alert variant="danger" title="Gagal">
                {error}
              </Alert>
            ) : null}

            <dl className="grid gap-3 sm:grid-cols-2">
              <DetailItem label="Anggota" value={`${detail.userName} (@${detail.userUsername})`} />
              <DetailItem label="Surel" value={detail.userEmail} />
              <DetailItem
                label="Paket"
                value={`${detail.tierCode} · ${detail.programName}`}
              />
              <DetailItem
                label="Nilai imbalan"
                value={formatMoney(detail.amount, detail.currency)}
                accent
              />
              <DetailItem
                label="Periode"
                value={`Minggu ${detail.period} · siklus ${detail.cycleNumber}`}
              />
              <DetailItem label="Tarif kontrak" value={`${detail.rate}%`} />
              <DetailItem label="Status" value={<PaymentStatusBadge status={detail.status} />} />
              <DetailItem
                label="Jadwal"
                value={detail.scheduledFor ? formatPaymentDate(detail.scheduledFor) : "—"}
              />
              <DetailItem
                label="Disetujui pada"
                value={detail.approvedAt ? formatPaymentDate(detail.approvedAt) : "Belum"}
              />
              <DetailItem
                label="Dibayar pada"
                value={detail.paidAt ? formatPaymentDate(detail.paidAt) : "Belum"}
              />
            </dl>

            {detail.notes ? (
              <Alert variant="info" title="Catatan imbalan">
                {detail.notes}
              </Alert>
            ) : null}

            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">
                Riwayat imbalan ini
              </p>
              <RequestAuditList entries={detail.auditHistory} />
            </div>

            <div className="space-y-3 border-t border-white/10 pt-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/55">
                Tindakan imbalan
              </p>
              {!canDecide ? (
                <Alert variant="warning" title="Hanya baca">
                  Peran administrator Anda tidak memiliki izin mengelola imbalan
                  (<code>manageFinance</code>). Hubungi pemilik untuk mendapatkan peran FINANCE
                  atau SUPER_ADMIN.
                </Alert>
              ) : availableActions.length === 0 ? (
                <Alert variant="info" title="Tidak ada tindakan untuk status ini">
                  Imbalan berstatus {detail.status} sudah final; riwayatnya tetap tersimpan dan tidak
                  dapat dihapus.
                </Alert>
              ) : (
                <div className="space-y-2">
                  {availableActions.map((action) => (
                    <div key={action.value} className="flex flex-wrap items-center gap-3">
                      <Button
                        type="button"
                        variant={action.tone === "danger" ? "outline" : "default"}
                        size="sm"
                        onClick={() => {
                          setError(null);
                          setReason("");
                          setPendingAction({ row: detail, action });
                        }}
                      >
                        <action.icon aria-hidden />
                        {action.label}
                      </Button>
                      <span className="text-xs text-white/45">{action.hint}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={pendingAction !== null}
        title={pendingAction?.action.label ?? "Konfirmasi tindakan"}
        description={
          pendingAction
            ? `Imbalan Minggu ${pendingAction.row.period} sebesar ${formatMoney(
                pendingAction.row.amount,
                pendingAction.row.currency,
              )} untuk @${pendingAction.row.userUsername}. Tindakan ini tercatat permanen di jejak audit.`
            : ""
        }
        confirmLabel="Konfirmasi"
        tone={pendingAction?.action.tone ?? "default"}
        pending={submitting}
        onCancel={() => {
          if (submitting) return;
          setPendingAction(null);
          setReason("");
          setError(null);
        }}
        onConfirm={() => {
          if (pendingAction?.action.requiresReason && reason.trim().length < 3) {
            setError("Alasan wajib diisi (minimal 3 karakter) untuk tindakan ini.");
            return;
          }
          void submitAction();
        }}
      >
        {error ? (
          <Alert variant="danger" title="Periksa kembali">
            {error}
          </Alert>
        ) : null}

        <div className="space-y-2">
          <label
            htmlFor="reward-action-reason"
            className="text-xs font-semibold uppercase tracking-[0.14em] text-white/60"
          >
            {pendingAction?.action.requiresReason ? "Alasan (wajib)" : "Catatan (opsional)"}
          </label>
          <Input
            id="reward-action-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={200}
            placeholder={
              pendingAction?.action.requiresReason
                ? "Contoh: keanggotaan ditangguhkan karena pembayaran belum terverifikasi."
                : "Catatan tambahan untuk jejak audit."
            }
            disabled={submitting}
          />
          <p className="text-xs text-white/40">
            Anggota menerima notifikasi pada setiap perubahan yang memindahkan uang (bayar, tolak,
            batal).
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs text-white/50">
          {submitting ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
          <Badge variant="muted">Audit</Badge>
          <span>Setiap tindakan dicatat dengan aktor, waktu, dan snapshot sebelum/sesudah.</span>
        </div>
      </ConfirmDialog>

      {canDecide ? null : (
        <Alert variant="warning" title="Peran Anda hanya membaca">
          Baris imbalan dapat dibaca seluruh peran admin, tetapi menyetujui, membayarkan, menolak,
          atau membatalkannya memerlukan <code>manageFinance</code> (SUPER_ADMIN/FINANCE).
        </Alert>
      )}
    </div>
  );
}