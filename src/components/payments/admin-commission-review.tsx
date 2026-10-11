"use client";

import { AlertTriangle, Ban, CheckCircle2, Coins, Loader2 } from "lucide-react";
import * as React from "react";

import { DataTable, type DataTableColumn } from "@/components/payments/data-table";
import { ConfirmDialog, Modal } from "@/components/payments/modal";
import { DetailItem, RequestAuditList, type RequestAuditEntry } from "@/components/payments/review-detail";
import { formatPaymentDate } from "@/components/payments/status-badge";
import {
  referralCommissionStatusLabel,
  referralCommissionStatusTone,
} from "@/components/referral/commission-status";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  COMMISSION_ACTION_LABELS,
  commissionActionRequiresReason,
  commissionActionsForStatus,
  type CommissionAction,
} from "@/lib/commission-actions";
import { formatMoney, formatRate } from "@/lib/money";

export interface AdminCommissionRow {
  id: string;
  level: number;
  status: string;
  /** Rate as stored on the row (frozen at creation time), 4 decimals. */
  rate: string;
  baseAmount: string;
  commissionAmount: string;
  currency: string;
  sourceReference: string;
  beneficiaryName: string;
  beneficiaryUsername: string;
  sourceUsername: string;
  createdAt: Date | string;
  approvedAt: Date | string | null;
  paidAt: Date | string | null;
  /** Ledger reference that credited the balance when the commission was paid. */
  payoutReference: string | null;
  /** Audit entries for this one commission, newest first. */
  auditHistory: RequestAuditEntry[];
}

const ACTION_ICONS: Record<CommissionAction, typeof CheckCircle2> = {
  APPROVE: CheckCircle2,
  PAY: Coins,
  REJECT: AlertTriangle,
  VOID: Ban,
};

interface PendingReview {
  row: AdminCommissionRow;
  action: CommissionAction;
}

/** Terminal states never offer another action; the service rejects them anyway. */
function rowActions(row: AdminCommissionRow, canManage: boolean): CommissionAction[] {
  return canManage ? commissionActionsForStatus(row.status) : [];
}

/**
 * Administrator worklist for referral commissions: list, approve, pay, reject or
 * void. Payment credits the member's spendable in-app balance, so the
 * confirmation is deliberately explicit and every action requires a second
 * click. The dialog only offers the transitions that the row's current status
 * allows; the server re-checks the state machine and the administrator's
 * capability inside the transaction.
 */
export function AdminCommissionReview({
  rows,
  canManage,
}: {
  rows: AdminCommissionRow[];
  /** `manageFinance` capability; false renders the queue read-only. */
  canManage: boolean;
}) {
  const [detail, setDetail] = React.useState<AdminCommissionRow | null>(null);
  const [pendingReview, setPendingReview] = React.useState<PendingReview | null>(null);
  const [reason, setReason] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  async function submitReview() {
    if (!pendingReview) return;
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/admin/commissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commissionId: pendingReview.row.id,
          action: pendingReview.action,
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
            "Aksi komisi tidak dapat diproses.",
        );
        return;
      }

      setNotice(
        `${COMMISSION_ACTION_LABELS[pendingReview.action]}: komisi tingkat ` +
          `${pendingReview.row.level} untuk @${pendingReview.row.beneficiaryUsername} ` +
          `(${formatMoney(pendingReview.row.commissionAmount, pendingReview.row.currency)}).`,
      );
      setPendingReview(null);
      setDetail(null);
      setReason("");
      // The server rendered queue carries the fresh status, so reload it instead
      // of guessing the new state in the browser.
      window.location.reload();
    } catch {
      setError("Gangguan jaringan. Silakan coba lagi.");
    } finally {
      setSubmitting(false);
    }
  }

  const columns: DataTableColumn<AdminCommissionRow>[] = [
    {
      key: "createdAt",
      header: "Diajukan",
      sortValue: (row) => new Date(row.createdAt).getTime(),
      render: (row) => <span className="text-white/60">{formatPaymentDate(row.createdAt)}</span>,
    },
    {
      key: "beneficiary",
      header: "Penerima",
      sortValue: (row) => row.beneficiaryUsername,
      render: (row) => (
        <div>
          <p className="font-semibold text-white">{row.beneficiaryName}</p>
          <p className="text-[11px] text-white/40">@{row.beneficiaryUsername}</p>
        </div>
      ),
    },
    {
      key: "level",
      header: "Tingkat",
      sortValue: (row) => row.level,
      render: (row) => (
        <div>
          <p className="text-white/80">Tingkat {row.level}</p>
          <p className="font-mono text-[11px] text-[var(--color-neon)]">{formatRate(row.rate)}</p>
        </div>
      ),
    },
    {
      key: "amount",
      header: "Nilai komisi",
      sortValue: (row) => Number(row.commissionAmount),
      render: (row) => (
        <div>
          <p className="font-semibold text-[var(--color-gold)]">
            {formatMoney(row.commissionAmount, row.currency)}
          </p>
          <p className="text-[11px] text-white/40">
            Dasar {formatMoney(row.baseAmount, row.currency)}
          </p>
        </div>
      ),
    },
    {
      key: "source",
      header: "Sumber",
      sortValue: (row) => row.sourceUsername,
      render: (row) => (
        <div>
          <p className="text-white/80">@{row.sourceUsername}</p>
          <p className="max-w-[220px] truncate font-mono text-[11px] text-white/35">
            {row.sourceReference}
          </p>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      sortValue: (row) => row.status,
      render: (row) => (
        <div className="space-y-1">
          <Badge variant={referralCommissionStatusTone(row.status)}>
            {referralCommissionStatusLabel(row.status)}
          </Badge>
          {row.payoutReference ? (
            <p className="max-w-[200px] truncate font-mono text-[10px] text-white/35">
              {row.payoutReference}
            </p>
          ) : null}
        </div>
      ),
    },
  ];


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
        caption="Daftar komisi rujukan untuk diselesaikan"
        searchPlaceholder="Cari penerima, sumber, atau referensi..."
        searchText={(row) =>
          [
            row.beneficiaryName,
            row.beneficiaryUsername,
            row.sourceUsername,
            row.sourceReference,
            row.status,
          ].join(" ")
        }
        filters={{
          label: "Status",
          options: [
            { value: "PENDING", label: referralCommissionStatusLabel("PENDING") },
            { value: "APPROVED", label: referralCommissionStatusLabel("APPROVED") },
            { value: "PAID", label: referralCommissionStatusLabel("PAID") },
            { value: "REJECTED", label: referralCommissionStatusLabel("REJECTED") },
            { value: "VOID", label: referralCommissionStatusLabel("VOID") },
          ],
          match: (row, value) => row.status === value,
        }}
        onRowClick={setDetail}
        rowAriaLabel={(row) => `Tinjau komisi tingkat ${row.level} untuk @${row.beneficiaryUsername}`}
        emptyMessage="Tidak ada komisi rujukan pada filter ini."
      />

      <Modal
        open={detail !== null}
        onClose={() => {
          setDetail(null);
          setError(null);
        }}
        title="Tinjau komisi rujukan"
        description={detail ? `Tercatat ${formatPaymentDate(detail.createdAt)}` : undefined}
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
              <DetailItem
                label="Penerima"
                value={`${detail.beneficiaryName} (@${detail.beneficiaryUsername})`}
              />
              <DetailItem label="Status" value={referralCommissionStatusLabel(detail.status)} />
              <DetailItem
                label="Nilai komisi"
                value={formatMoney(detail.commissionAmount, detail.currency)}
                accent
              />
              <DetailItem
                label="Dasar perhitungan"
                value={`${formatMoney(detail.baseAmount, detail.currency)} x ${formatRate(detail.rate)}`}
              />
              <DetailItem label="Tingkat jaringan" value={`Tingkat ${detail.level}`} />
              <DetailItem label="Sumber" value={`@${detail.sourceUsername}`} />
              <DetailItem label="Referensi sumber" value={detail.sourceReference} />
              <DetailItem label="Disetujui" value={formatPaymentDate(detail.approvedAt)} />
              <DetailItem label="Dibayar" value={formatPaymentDate(detail.paidAt)} />
              <DetailItem label="Referensi pembayaran" value={detail.payoutReference ?? "-"} />
            </dl>

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/45">
                Riwayat audit komisi ini
              </p>
              <RequestAuditList entries={detail.auditHistory} />
            </div>

            <div className="space-y-3 border-t border-white/10 pt-4">
              {rowActions(detail, canManage).length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {rowActions(detail, canManage).map((action) => {
                    const Icon = ACTION_ICONS[action];
                    return (
                      <Button
                        key={action}
                        type="button"
                        variant={commissionActionRequiresReason(action) ? "outline" : "default"}
                        size="sm"
                        onClick={() => {
                          setError(null);
                          setReason("");
                          setPendingReview({ row: detail, action });
                        }}
                      >
                        <Icon aria-hidden />
                        {COMMISSION_ACTION_LABELS[action]}
                      </Button>
                    );
                  })}
                </div>
              ) : canManage ? (
                <Alert variant="warning" title="Komisi sudah final">
                  Komisi berstatus {referralCommissionStatusLabel(detail.status)} tidak dapat diubah
                  lagi. Status akhir bersifat permanen.
                </Alert>
              ) : (
                <Alert variant="warning" title="Hanya baca">
                  Peran administrator Anda tidak memiliki izin menyelesaikan komisi rujukan. Hubungi
                  SUPER_ADMIN untuk mendapatkan akses FINANCE.
                </Alert>
              )}
            </div>
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={pendingReview !== null}
        title={pendingReview ? COMMISSION_ACTION_LABELS[pendingReview.action] : "Konfirmasi tindakan"}
        description={
          pendingReview
            ? `Komisi tingkat ${pendingReview.row.level} sebesar ` +
              `${formatMoney(pendingReview.row.commissionAmount, pendingReview.row.currency)} ` +
              `untuk @${pendingReview.row.beneficiaryUsername}.` +
              (pendingReview.action === "PAY"
                ? " Saldo tersedia anggota bertambah dan tindakan ini tercatat permanen pada jejak audit."
                : " Tindakan ini tercatat permanen pada jejak audit.")
            : ""
        }
        confirmLabel="Konfirmasi"
        tone={
          pendingReview && commissionActionRequiresReason(pendingReview.action)
            ? "danger"
            : "default"
        }
        pending={submitting}
        onCancel={() => {
          if (submitting) return;
          setPendingReview(null);
          setReason("");
          setError(null);
        }}
        onConfirm={() => {
          if (
            pendingReview &&
            commissionActionRequiresReason(pendingReview.action) &&
            reason.trim().length < 3
          ) {
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
            htmlFor="commission-review-reason"
            className="text-xs font-semibold uppercase tracking-[0.14em] text-white/60"
          >
            {pendingReview && commissionActionRequiresReason(pendingReview.action)
              ? "Alasan (wajib)"
              : "Catatan (opsional)"}
          </label>
          <Input
            id="commission-review-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={500}
            placeholder={
              pendingReview && commissionActionRequiresReason(pendingReview.action)
                ? "Contoh: transaksi sumber ternyata dibatalkan."
                : "Catatan tambahan untuk jejak audit."
            }
            disabled={submitting}
          />
          <p className="text-xs text-white/40">
            {pendingReview && commissionActionRequiresReason(pendingReview.action)
              ? "Alasan disimpan pada jejak audit dan dikirim ke anggota melalui notifikasi."
              : "Catatan opsional yang tersimpan pada jejak audit."}
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs text-white/50">
          {submitting ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
          <Badge variant="muted">Audit</Badge>
          <span>Setiap tindakan komisi dicatat dengan aktor dan waktu.</span>
        </div>
      </ConfirmDialog>
    </div>
  );
}
