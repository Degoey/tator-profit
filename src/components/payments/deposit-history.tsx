"use client";

import { Download, FileText } from "lucide-react";
import * as React from "react";

import { DataTable, type DataTableColumn } from "@/components/payments/data-table";
import { Modal } from "@/components/payments/modal";
import { DEPOSIT_METHODS, optionLabel } from "@/components/payments/options";
import { PaymentStatusBadge, formatPaymentDate } from "@/components/payments/status-badge";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";

export interface DepositHistoryRow {
  id: string;
  amount: string;
  currency: string;
  paymentMethod: string;
  paymentReference: string;
  status: string;
  rejectionReason: string | null;
  reviewNote: string | null;
  flaggedReason: string | null;
  tierCode: string | null;
  programName: string | null;
  hasProof: boolean;
  createdAt: Date | string;
  reviewedAt: Date | string | null;
}

export function DepositHistory({ rows }: { rows: DepositHistoryRow[] }) {
  const [detail, setDetail] = React.useState<DepositHistoryRow | null>(null);

  const columns: DataTableColumn<DepositHistoryRow>[] = [
    {
      key: "createdAt",
      header: "Tanggal",
      sortValue: (row) => new Date(row.createdAt).getTime(),
      render: (row) => <span className="text-white/60">{formatPaymentDate(row.createdAt)}</span>,
    },
    {
      key: "membership",
      header: "Keanggotaan",
      render: (row) => (
        <div>
          <p className="font-semibold text-white">{row.tierCode ?? "—"}</p>
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
      key: "method",
      header: "Metode",
      render: (row) => (
        <span className="text-white/60">{optionLabel(DEPOSIT_METHODS, row.paymentMethod)}</span>
      ),
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
    <>
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        caption="Riwayat deposit Anda"
        searchPlaceholder="Cari referensi atau status deposit..."
        searchText={(row) =>
          [row.paymentReference, row.status, row.tierCode ?? "", row.programName ?? ""].join(" ")
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
        rowAriaLabel={(row) => `Buka detail deposit ${row.tierCode ?? row.id}`}
        emptyMessage="Belum ada deposit. Kirim bukti transfer pertama Anda di formulir di atas."
      />

      <Modal
        open={detail !== null}
        onClose={() => setDetail(null)}
        title="Detail deposit"
        description={detail ? `Diajukan ${formatPaymentDate(detail.createdAt)}` : undefined}
        footer={
          <>
            {detail?.hasProof ? (
              <Button asChild variant="outline">
                <a
                  href={`/api/deposits/${detail.id}/proof`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Download aria-hidden />
                  Lihat bukti
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
            <DetailRow label="Nilai deposit" value={formatMoney(detail.amount, detail.currency)} accent />
            <DetailRow label="Keanggotaan" value={detail.tierCode ?? "—"} />
            <DetailRow label="Program" value={detail.programName ?? "—"} />
            <DetailRow
              label="Metode pembayaran"
              value={optionLabel(DEPOSIT_METHODS, detail.paymentMethod)}
            />
            <DetailRow label="Referensi" value={detail.paymentReference || "—"} />
            <DetailRow label="Status" value={<PaymentStatusBadge status={detail.status} />} />
            <DetailRow
              label="Ditinjau pada"
              value={detail.reviewedAt ? formatPaymentDate(detail.reviewedAt) : "Belum ditinjau"}
            />
            {detail.rejectionReason ? (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-red-200">
                  Alasan penolakan
                </p>
                <p className="mt-1 text-sm text-red-100">{detail.rejectionReason}</p>
              </div>
            ) : null}
            {detail.flaggedReason ? (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-red-200">
                  Alasan ditandai
                </p>
                <p className="mt-1 text-sm text-red-100">{detail.flaggedReason}</p>
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
            <p className="flex items-center gap-2 text-xs text-white/45">
              <FileText className="size-3.5" aria-hidden />
              {detail.hasProof
                ? "Bukti transfer tersimpan privat dan hanya dapat diakses oleh Anda atau admin."
                : "Tidak ada bukti transfer terlampir."}
            </p>
          </dl>
        ) : null}
      </Modal>
    </>
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
          accent ? "text-sm font-semibold text-[var(--color-gold)]" : "text-sm font-semibold text-white"
        }
      >
        {value}
      </dd>
    </div>
  );
}

