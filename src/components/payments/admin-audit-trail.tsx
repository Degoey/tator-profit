"use client";

import { History } from "lucide-react";
import * as React from "react";

import { DataTable, type DataTableColumn } from "@/components/payments/data-table";
import { Modal } from "@/components/payments/modal";
import { formatPaymentDate } from "@/components/payments/status-badge";
import { Button } from "@/components/ui/button";

export interface AuditTrailRow {
  id: string;
  createdAt: Date | string;
  actorName: string | null;
  actorUsername: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  before: unknown;
  after: unknown;
}

const ACTION_GROUPS = [
  { value: "deposit.", label: "Deposit" },
  { value: "withdrawal.", label: "Penarikan" },
  { value: "program.", label: "Program" },
  { value: "reward.", label: "Imbalan" },
  { value: "admin.", label: "Administrasi" },
];

function snapshot(value: unknown): string {
  if (value === null || value === undefined) return "—";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** Read-only audit trail over the immutable AuditLog table. */
export function AdminAuditTrail({ rows }: { rows: AuditTrailRow[] }) {
  const [detail, setDetail] = React.useState<AuditTrailRow | null>(null);

  const columns: DataTableColumn<AuditTrailRow>[] = [
    {
      key: "createdAt",
      header: "Waktu",
      sortValue: (row) => new Date(row.createdAt).getTime(),
      render: (row) => <span className="text-white/60">{formatPaymentDate(row.createdAt)}</span>,
    },
    {
      key: "actor",
      header: "Aktor",
      sortValue: (row) => row.actorUsername ?? "",
      render: (row) => (
        <span className="text-white/75">{row.actorUsername ? `@${row.actorUsername}` : "Sistem"}</span>
      ),
    },
    {
      key: "action",
      header: "Aksi",
      sortValue: (row) => row.action,
      render: (row) => (
        <span className="font-mono text-[11px] text-[var(--color-neon)]">{row.action}</span>
      ),
    },
    {
      key: "entity",
      header: "Entitas",
      render: (row) => (
        <div>
          <p className="text-white/75">{row.entityType}</p>
          <p className="font-mono text-[10px] text-white/35">{row.entityId ?? "—"}</p>
        </div>
      ),
    },
    {
      key: "ip",
      header: "IP",
      render: (row) => (
        <span className="font-mono text-[11px] text-white/50">{row.ipAddress ?? "—"}</span>
      ),
    },
    {
      key: "detail",
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
          Lihat
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        caption="Jejak audit tindakan administratif"
        searchPlaceholder="Cari aktor, aksi, atau entitas..."
        searchText={(row) =>
          [row.actorUsername ?? "sistem", row.action, row.entityType, row.entityId ?? ""].join(" ")
        }
        filters={{
          label: "Kategori",
          allLabel: "Semua kategori",
          options: ACTION_GROUPS,
          match: (row, value) => row.action.startsWith(value),
        }}
        onRowClick={setDetail}
        rowAriaLabel={(row) => `Lihat detail audit ${row.action}`}
        emptyMessage="Belum ada catatan audit."
      />

      <Modal
        open={detail !== null}
        onClose={() => setDetail(null)}
        title="Detail jejak audit"
        description={
          detail ? `${detail.action} · ${formatPaymentDate(detail.createdAt)}` : undefined
        }
        size="lg"
        footer={
          <Button type="button" variant="ghost" onClick={() => setDetail(null)}>
            Tutup
          </Button>
        }
      >
        {detail ? (
          <div className="space-y-3 text-sm">
            <p className="flex items-center gap-2 text-xs text-white/50">
              <History className="size-3.5" aria-hidden />
              Catatan audit bersifat hanya-tambah: tidak dapat diubah atau dihapus.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Aktor"
                value={detail.actorUsername ? `@${detail.actorUsername}` : "Sistem"}
              />
              <Field label="Aksi" value={detail.action} mono />
              <Field label="Entitas" value={detail.entityType} />
              <Field label="ID entitas" value={detail.entityId ?? "—"} mono />
              <Field label="Alamat IP" value={detail.ipAddress ?? "—"} mono />
              <Field label="Perangkat" value={detail.userAgent ?? "—"} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Snapshot label="Sebelum" value={detail.before} />
              <Snapshot label="Sesudah" value={detail.after} />
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">{label}</p>
      <p className={mono ? "mt-1 break-all font-mono text-xs text-white" : "mt-1 text-sm text-white"}>
        {value}
      </p>
    </div>
  );
}

function Snapshot({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">{label}</p>
      <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-white/70">
        {snapshot(value)}
      </pre>
    </div>
  );
}
