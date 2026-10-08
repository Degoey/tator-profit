"use client";

import { AlertTriangle, CheckCircle2, Eye, Flag, Loader2, RotateCcw } from "lucide-react";
import * as React from "react";

import { DataTable, type DataTableColumn } from "@/components/payments/data-table";
import { ConfirmDialog, Modal } from "@/components/payments/modal";
import { DEPOSIT_METHODS, optionLabel } from "@/components/payments/options";
import { PaymentStatusBadge, formatPaymentDate } from "@/components/payments/status-badge";
import { DetailItem, RequestAuditList, type RequestAuditEntry } from "@/components/payments/review-detail";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/money";

export interface AdminDepositRow {
  id: string;
  amount: string;
  currency: string;
  paymentMethod: string;
  paymentReference: string;
  status: string;
  rejectionReason: string | null;
  reviewNote: string | null;
  flaggedReason: string | null;
  proofFileName: string;
  proofMimeType: string;
  proofSize: number;
  userName: string;
  userUsername: string;
  userEmail: string;
  tierCode: string | null;
  programName: string | null;
  membershipStatus: string | null;
  createdAt: Date | string;
  reviewedAt: Date | string | null;
  /** Audit entries for this single request, newest first. */
  auditHistory: RequestAuditEntry[];
}

interface ReviewAction {
  value: string;
  label: string;
  tone: "default" | "danger";
  requiresReason: boolean;
  icon: typeof CheckCircle2;
}

const DEPOSIT_REVIEW_ACTIONS: ReviewAction[] = [
  { value: "UNDER_REVIEW", label: "Tandai sedang ditinjau", tone: "default", requiresReason: false, icon: RotateCcw },
  { value: "APPROVED", label: "Setujui deposit", tone: "default", requiresReason: false, icon: CheckCircle2 },
  { value: "REJECTED", label: "Tolak deposit", tone: "danger", requiresReason: true, icon: AlertTriangle },
  { value: "FLAGGED", label: "Tandai deposit", tone: "danger", requiresReason: true, icon: Flag },
];

interface PendingReview {
  row: AdminDepositRow;
  action: ReviewAction;
}

export function AdminDepositReview({
  rows,
  allowedActions,
}: {
  rows: AdminDepositRow[];
  /** Review actions the signed-in administrator may perform; empty = read only. */
  allowedActions: string[];
}) {
  const [detail, setDetail] = React.useState<AdminDepositRow | null>(null);
  const [pendingReview, setPendingReview] = React.useState<PendingReview | null>(null);
  const [reason, setReason] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);


  const columns: DataTableColumn<AdminDepositRow>[] = [
    {
      key: "createdAt",
      header: "Diajukan",
      sortValue: (row) => new Date(row.createdAt).getTime(),
      render: (row) => <span className="text-white/60">{formatPaymentDate(row.createdAt)}</span>,
    },
    {
      key: "user",
      header: "Pengguna",
      sortValue: (row) => row.userUsername,
      render: (row) => (
        <div>
          <p className="font-semibold text-white">{row.userName}</p>
          <p className="text-[11px] text-white/40">@{row.userUsername} · {row.userEmail}</p>
        </div>
      ),
    },
    {
      key: "membership",
      header: "Keanggotaan",
      render: (row) => (
        <div>
          <p className="text-white">{row.tierCode ?? "—"}</p>
          <p className="text-[11px] text-white/40">{row.programName ?? "—"}</p>
        </div>
      ),
    },
    {
      key: "amount",
      header: "Nilai",
      sortValue: (row) => Number(row.amount),
      render: (row) => (
        <span className="font-semibold text-[var(--color-gold)]">
          {formatMoney(row.amount, row.currency)}
        </span>
      ),
    },
    {
      key: "reference",
      header: "Referensi",
      render: (row) => <span className="text-white/55">{row.paymentReference || "—"}</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <PaymentStatusBadge status={row.status} />,
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
            setDetail(row);
          }}
        >
          <Eye aria-hidden />
          Tinjau
        </Button>
      ),
    },
  ];

  async function submitReview() {
    if (!pendingReview) return;
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/admin/deposits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: pendingReview.row.id,
          action: pendingReview.action.value,
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
            "Aksi tinjauan deposit tidak dapat diproses.",
        );
        return;
      }

      setNotice(
        `Deposit ${formatMoney(pendingReview.row.amount, pendingReview.row.currency)} dari ` +
          `@${pendingReview.row.userUsername} → ${pendingReview.action.label}.`,
      );
      setPendingReview(null);
      setDetail(null);
      setReason("");
      window.location.reload();
    } catch {
      setError("Gangguan jaringan. Silakan coba lagi.");
    } finally {
      setSubmitting(false);
    }
  }


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
        caption="Daftar permintaan deposit untuk ditinjau"
        searchPlaceholder="Cari pengguna, referensi, atau keanggotaan..."
        searchText={(row) =>
          [
            row.userName,
            row.userUsername,
            row.userEmail,
            row.paymentReference,
            row.tierCode ?? "",
            row.status,
          ].join(" ")
        }
        filters={{
          label: "Status",
          options: [
            { value: "PENDING", label: "Menunggu" },
            { value: "UNDER_REVIEW", label: "Sedang ditinjau" },
            { value: "APPROVED", label: "Disetujui" },
            { value: "REJECTED", label: "Ditolak" },
            { value: "FLAGGED", label: "Ditandai" },
          ],
          match: (row, value) => row.status === value,
        }}
        onRowClick={setDetail}
        rowAriaLabel={(row) => `Tinjau deposit dari @${row.userUsername}`}
        emptyMessage="Tidak ada permintaan deposit pada filter ini."
      />

      <Modal
        open={detail !== null}
        onClose={() => {
          setDetail(null);
          setError(null);
        }}
        title="Tinjau deposit"
        description={detail ? `Diajukan ${formatPaymentDate(detail.createdAt)}` : undefined}
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
              <DetailItem label="Pengguna" value={`${detail.userName} (@${detail.userUsername})`} />
              <DetailItem label="Surel" value={detail.userEmail} />
              <DetailItem
                label="Nilai deposit"
                value={formatMoney(detail.amount, detail.currency)}
                accent
              />
              <DetailItem
                label="Keanggotaan"
                value={`${detail.tierCode ?? "—"} · ${detail.programName ?? "—"}`}
              />
              <DetailItem label="Status keanggotaan" value={detail.membershipStatus ?? "—"} />
              <DetailItem
                label="Metode pembayaran"
                value={optionLabel(DEPOSIT_METHODS, detail.paymentMethod)}
              />
              <DetailItem label="Referensi" value={detail.paymentReference || "—"} />
              <DetailItem
                label="Status deposit"
                value={<PaymentStatusBadge status={detail.status} />}
              />
            </dl>

            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">
                Bukti transfer
              </p>
              <p className="mt-1 text-sm text-white/75">
                {detail.proofFileName} · {(detail.proofSize / 1024).toFixed(0)} KB ·{" "}
                {detail.proofMimeType}
              </p>
              <Button asChild variant="outline" size="sm" className="mt-3">
                <a
                  href={`/api/deposits/${detail.id}/proof`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Eye aria-hidden />
                  Buka bukti (privat)
                </a>
              </Button>
            </div>

            {detail.rejectionReason ? (
              <Alert variant="danger" title="Alasan penolakan">
                {detail.rejectionReason}
              </Alert>
            ) : null}
            {detail.flaggedReason ? (
              <Alert variant="danger" title="Alasan ditandai">
                {detail.flaggedReason}
              </Alert>
            ) : null}
            {detail.reviewNote ? (
              <Alert variant="info" title="Catatan tinjauan">
                {detail.reviewNote}
              </Alert>
            ) : null}

            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">
                Riwayat permintaan ini
              </p>
              <RequestAuditList entries={detail.auditHistory} />
            </div>

            <div className="space-y-3 border-t border-white/10 pt-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/55">
                Tindakan tinjauan
              </p>
              {allowedActions.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {DEPOSIT_REVIEW_ACTIONS.filter((action) =>
                    allowedActions.includes(action.value),
                  ).map((action) => (
                    <Button
                      key={action.value}
                      type="button"
                      variant={action.tone === "danger" ? "outline" : "default"}
                      size="sm"
                      onClick={() => {
                        setError(null);

                        setReason("");
                        setPendingReview({ row: detail, action });
                      }}
                    >
                      <action.icon aria-hidden />
                      {action.label}
                    </Button>
                  ))}
                </div>
              ) : (
                <Alert variant="warning" title="Hanya baca">
                  Peran administrator Anda tidak memiliki izin meninjau deposit. Hubungi
                  SUPER_ADMIN untuk mendapatkan akses FINANCE atau Kepatuhan.
                </Alert>
              )}
            </div>
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={pendingReview !== null}
        title={pendingReview?.action.label ?? "Konfirmasi tindakan"}
        description={
          pendingReview
            ? `Deposit ${formatMoney(pendingReview.row.amount, pendingReview.row.currency)} dari @${pendingReview.row.userUsername}. Tindakan ini tercatat permanen pada jejak audit.`
            : ""
        }
        confirmLabel="Konfirmasi"
        tone={pendingReview?.action.tone ?? "default"}
        pending={submitting}
        onCancel={() => {
          if (submitting) return;
          setPendingReview(null);
          setReason("");
          setError(null);
        }}
        onConfirm={() => {
          if (pendingReview?.action.requiresReason && reason.trim().length < 3) {
            setError("Alasan wajib diisi (minimal 3 karakter) untuk tindakan ini.");
            return;
          }
          void submitReview();
        }}
      >
        {error ? (
          <Alert variant="danger" title="Periksa kembali">
            {error}
          </Alert>
        ) : null}

        <div className="space-y-2">
          <label
            htmlFor="deposit-review-reason"
            className="text-xs font-semibold uppercase tracking-[0.14em] text-white/60"
          >
            {pendingReview?.action.requiresReason ? "Alasan (wajib)" : "Catatan (opsional)"}
          </label>
          <Input
            id="deposit-review-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={500}
            placeholder={
              pendingReview?.action.requiresReason
                ? "Contoh: bukti transfer tidak sesuai dengan nilai keanggotaan."
                : "Catatan tambahan untuk jejak audit."
            }
            disabled={submitting}
          />
          <p className="text-xs text-white/40">
            {pendingReview?.action.requiresReason
              ? "Alasan disimpan pada catatan penolakan/penandaan dan dapat dilihat pengguna."
              : "Catatan opsional yang tersimpan pada riwayat tinjauan."}
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs text-white/50">
          {submitting ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
          <Badge variant="muted">Audit</Badge>
          <span>Setiap tindakan tinjauan dicatat dengan aktor dan waktu.</span>
        </div>
      </ConfirmDialog>
    </div>
  );
}

