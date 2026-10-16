"use client";

import { DataTable, type DataTableColumn } from "@/components/payments/data-table";
import { PaymentStatusBadge, formatPaymentDate } from "@/components/payments/status-badge";
import { Alert } from "@/components/ui/alert";
import { formatMoney } from "@/lib/money";

export interface AdminMemberRow {
  id: string;
  name: string;
  username: string;
  email: string;
  phone: string;
  status: string;
  createdAt: Date | string;
  lastLoginAt: Date | string | null;
  availableAmount: string;
  pendingAmount: string;
  programFundsAmount: string;
  totalEarned: string;
  activeMemberships: number;
  pendingMemberships: number;
}

/**
 * Direktori anggota untuk petugas: hanya membaca.
 *
 * Tidak ada satu pun tindakan uang di sini — menambah saldo tetap milik pemilik
 * (`creditBalance`, rute `/api/owner/*`). Tujuannya satu: petugas dapat menjawab
 * pertanyaan anggota ("berapa saldo saya? keanggotaan saya aktif?") tanpa
 * membuka Konsol Pemilik.
 */
export function AdminMemberDirectory({ rows }: { rows: AdminMemberRow[] }) {
  const columns: DataTableColumn<AdminMemberRow>[] = [
    {
      key: "user",
      header: "Anggota",
      sortValue: (row) => row.username,
      render: (row) => (
        <div>
          <p className="font-semibold text-white">{row.name}</p>
          <p className="text-[11px] text-white/40">
            @{row.username} · {row.email}
          </p>
        </div>
      ),
    },
    {
      key: "contact",
      header: "Kontak",
      render: (row) => (
        <div>
          <p className="text-white/70">{row.phone}</p>
          <p className="text-[11px] text-white/40">
            Terakhir masuk: {row.lastLoginAt ? formatPaymentDate(row.lastLoginAt) : "belum pernah"}
          </p>
        </div>
      ),
    },
    {
      key: "balance",
      header: "Saldo imbalan",
      sortValue: (row) => Number(row.availableAmount),
      render: (row) => (
        <div>
          <p className="font-semibold text-[var(--color-gold)]">
            {formatMoney(row.availableAmount)}
          </p>
          <p className="text-[11px] text-white/40">
            menunggu {formatMoney(row.pendingAmount)}
          </p>
        </div>
      ),
    },
    {
      key: "programFunds",
      header: "Dana program",
      sortValue: (row) => Number(row.programFundsAmount),
      render: (row) => (
        <span className="text-white/70">{formatMoney(row.programFundsAmount)}</span>
      ),
    },
    {
      key: "earned",
      header: "Total diperoleh",
      sortValue: (row) => Number(row.totalEarned),
      render: (row) => <span className="text-white/70">{formatMoney(row.totalEarned)}</span>,
    },
    {
      key: "memberships",
      header: "Keanggotaan",
      sortValue: (row) => row.activeMemberships,
      render: (row) => (
        <span className="text-white/70">
          {row.activeMemberships} aktif
          {row.pendingMemberships > 0 ? ` · ${row.pendingMemberships} menunggu` : ""}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status akun",
      render: (row) => <PaymentStatusBadge status={row.status} />,
    },
    {
      key: "createdAt",
      header: "Terdaftar",
      sortValue: (row) => new Date(row.createdAt).getTime(),
      render: (row) => <span className="text-white/60">{formatPaymentDate(row.createdAt)}</span>,
    },
  ];

  return (
    <div className="space-y-4">
      <Alert variant="info" title="Hanya baca">
        Saldo ditampilkan apa adanya dari buku besar. Menambah atau mengurangi saldo USDT bukan
        tugas panel ini — tindakan itu tetap milik pemilik lewat Konsol Pemilik.
      </Alert>

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        caption="Direktori anggota beserta saldo dan keanggotaannya"
        searchPlaceholder="Cari nama, nama pengguna, surel, atau nomor telepon..."
        searchText={(row) => [row.name, row.username, row.email, row.phone, row.status].join(" ")}
        filters={{
          label: "Status akun",
          options: [
            { value: "ACTIVE", label: "Aktif" },
            { value: "SUSPENDED", label: "Ditangguhkan" },
            { value: "INACTIVE", label: "Nonaktif" },
          ],
          match: (row, value) => row.status === value,
        }}
        emptyMessage="Belum ada anggota terdaftar."
      />
    </div>
  );
}