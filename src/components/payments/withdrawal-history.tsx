"use client";

import { Download, Info } from "lucide-react";
import * as React from "react";

import { DataTable, type DataTableColumn } from "@/components/payments/data-table";
import { Modal } from "@/components/payments/modal";
import { WITHDRAWAL_METHODS, optionLabel } from "@/components/payments/options";
import { PaymentStatusBadge, formatPaymentDate } from "@/components/payments/status-badge";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";

export interface WithdrawalHistoryRow {
  id: string;
  /** Gross amount requested. */
  amount: string;
  /** Platform fee (10% of the gross). */
  fee: string;
  /** Gross minus fee — the amount actually paid out. */
  netAmount: string;
  currency: string;
  method: string;
  destination: string;
  notes: string | null;
  status: string;
  rejectionReason: string | null;
  reviewNote: string | null;
  /** Transfer proof attached by an administrator when the payout was completed. */
  proofFileName: string | null;
  proofMimeType: string | null;
  proofSize: number | null;
  createdAt: Date | string;
  reviewedAt: Date | string | null;
  processedAt: Date | string | null;
  completedAt: Date | string | null;
}

const OPEN_STATUSES = ["PENDING", "UNDER_REVIEW", "APPROVED", "PROCESSING"];

export function WithdrawalHistory({ rows }: { rows: WithdrawalHistoryRow[] }) {
  const [detail, setDetail] = React.useState<WithdrawalHistoryRow | null>(null);
  const hasOpenRequest = rows.some((row) => OPEN_STATUSES.includes(row.status));

  const columns: DataTableColumn<WithdrawalHistoryRow>[] = [
    {
      key: "createdAt",
      header: "Tanggal",
      sortValue: (row) => new Date(row.createdAt).getTime(),
      render: (row) => <span className="text-white/60">{formatPaymentDate(row.createdAt)}</span>,
    },
    {
      key: "amount",
      header: "Nilai",
      sortValue: (row) => Number(row.amount),
      render: (row) => (
        <div className="space-y-0.5">
          <span className="block font-semibold text-[var(--color-neon)]">
            {formatMoney(row.amount, row.currency)}
          </span>
          <span className="block text-[11px] text-white/45">
            Biaya {formatMoney(row.fee, row.currency)} · diterima{" "}
            {formatMoney(row.netAmount, row.currency)}
          </span>
        </div>
      ),
    },
    {
      key: "method",
      header: "Metode",
      render: (row) => (
        <span className="text-white/60">{optionLabel(WITHDRAWAL_METHODS, row.method)}</span>
      ),
    },
    {
      key: "destination",
      header: "Tujuan",
      render: (row) => <span className="text-white/60">{row.destination}</span>,
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
          Detail
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {hasOpenRequest ? (
        <Alert variant="info" title="Ada penarikan yang masih berjalan">
          <span className="flex items-start gap-2">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            Sistem hanya mengizinkan satu permintaan penarikan terbuka per akun. Tunggu permintaan
            saat ini selesai atau ditolak sebelum mengajukan yang baru.
          </span>
        </Alert>
      ) : null}

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        caption="Riwayat penarikan Anda"
        searchPlaceholder="Cari tujuan, catatan, atau status..."
        searchText={(row) => [row.destination, row.notes ?? "", row.status, row.method].join(" ")}
        filters={{
          label: "Status",
          options: [
            { value: "PENDING", label: "Menunggu" },
            { value: "UNDER_REVIEW", label: "Sedang ditinjau" },
            { value: "APPROVED", label: "Disetujui" },
            { value: "PROCESSING", label: "Sedang diproses" },
            { value: "COMPLETED", label: "Selesai" },
            { value: "REJECTED", label: "Ditolak" },
          ],
          match: (row, value) => row.status === value,
        }}
        onRowClick={setDetail}
        rowAriaLabel={(row) => `Buka detail penarikan ${row.id}`}
        emptyMessage="Belum ada permintaan penarikan."
      />

      <Modal
        open={detail !== null}
        onClose={() => setDetail(null)}
        title="Detail penarikan"
        description={detail ? `Diajukan ${formatPaymentDate(detail.createdAt)}` : undefined}
        footer={
          <>
            {detail?.proofFileName ? (
              <Button asChild variant="outline">
                <a
                  href={`/api/withdrawals/${detail.id}/proof`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Download aria-hidden />
                  Lihat bukti transfer
                </a>
              </Button>
            ) : null}
            <Button type="button" variant="ghost" onClick={() => setDetail(null)}>
              Tutup
            </Button>
          </>
        }
      >
        {detail ? (
          <dl className="space-y-3 text-sm">
            <DetailRow
              label="Nilai penarikan"
              value={formatMoney(detail.amount, detail.currency)}
              accent
            />
            <DetailRow
              label="Biaya penarikan (10%)"
              value={formatMoney(detail.fee, detail.currency)}
            />
            <DetailRow
              label="Nominal bersih diterima"
              value={formatMoney(detail.netAmount, detail.currency)}
            />
            <DetailRow label="Metode" value={optionLabel(WITHDRAWAL_METHODS, detail.method)} />
            <DetailRow label="Tujuan" value={detail.destination} />
            <DetailRow label="Status" value={<PaymentStatusBadge status={detail.status} />} />
            <DetailRow
              label="Ditinjau pada"
              value={detail.reviewedAt ? formatPaymentDate(detail.reviewedAt) : "Belum ditinjau"}
            />
            <DetailRow
              label="Diproses pada"
              value={detail.processedAt ? formatPaymentDate(detail.processedAt) : "—"}
            />
            <DetailRow
              label="Selesai pada"
              value={detail.completedAt ? formatPaymentDate(detail.completedAt) : "—"}
            />
            {detail.notes ? <DetailRow label="Catatan Anda" value={detail.notes} /> : null}
            {detail.rejectionReason ? (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-red-200">
                  Alasan penolakan
                </p>
                <p className="mt-1 text-sm text-red-100">{detail.rejectionReason}</p>
              </div>
            ) : null}
            {detail.reviewNote ? (
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">
                  Catatan admin
                </p>
                <p className="mt-1 text-sm text-white/75">{detail.reviewNote}</p>
              </div>
            ) : null}
            {detail.proofFileName ? (
              <div className="rounded-xl border border-[var(--color-neon)]/25 bg-[var(--color-neon)]/[0.06] p-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-neon)]">
                  Bukti transfer dari admin
                </p>
                <p className="mt-1 text-sm text-white/75">
                  {detail.proofFileName}
                  {detail.proofSize ? ` · ${(detail.proofSize / 1024).toFixed(0)} KB` : ""}
                </p>
                <p className="mt-1 text-xs text-white/45">
                  Berkas disimpan privat dan hanya dapat dibuka oleh Anda dan admin berizin.
                </p>
              </div>
            ) : null}
          </dl>
        ) : null}
      </Modal>
    </div>
  );
}

function DetailRow({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/8 pb-2 last:border-0">
      <dt className="text-xs text-white/50">{label}</dt>
      <dd
        className={
          accent
            ? "text-sm font-semibold text-[var(--color-neon)]"
            : "text-sm font-semibold text-white"
        }
      >
        {value}
      </dd>
    </div>
  );
}
