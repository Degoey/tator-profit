import { Receipt } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { displayLegacyCurrencyText, formatMoney } from "@/lib/money";
import { formatDashboardDate } from "@/components/dashboard/program-progress";
import { statusLabel } from "@/lib/status-labels";

export interface TransactionHistoryRow {
  id: string;
  type: string;
  status: string;
  bucket: string;
  amount: string;
  currency: string;
  balanceAfter: string;
  reference: string;
  description: string | null;
  postedAt: Date | null;
  createdAt: Date;
}

const typeLabels: Record<string, string> = {
  PROGRAM_JOIN: "Gabung program",
  REWARD: "Imbalan",
  REFERRAL_REWARD: "Imbalan rujukan",
  WITHDRAWAL: "Penarikan",
  ADJUSTMENT: "Penyesuaian",
};

const bucketLabels: Record<string, string> = {
  AVAILABLE: "Saldo tersedia",
  PENDING: "Menunggu persetujuan",
  PROGRAM_FUNDS: "Dana program",
  NONE: "Tanpa efek saldo",
};

/**
 * Append-only ledger history. Entries are never edited or deleted; corrections
 * appear as additional ADJUSTMENT rows.
 */
export function TransactionHistory({ transactions }: { transactions: TransactionHistoryRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Receipt className="size-4 text-[var(--color-neon)]" aria-hidden />
          Riwayat transaksi
        </CardTitle>
        <CardDescription>
          Buku besar hanya bisa ditambah: baris tidak pernah dihapus, koreksi dicatat sebagai baris
          penyesuaian baru.
        </CardDescription>
      </CardHeader>

      <CardContent>
        {transactions.length === 0 ? (
          <p className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-6 text-center text-sm text-white/50">
            Belum ada transaksi. Saldo awal Anda 0,00 USDT dan akan bertambah setelah ada dana
            dikonfirmasi atau imbalan dibayar.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[42rem] border-collapse text-left text-sm">
              <caption className="sr-only">
                Riwayat transaksi buku besar pengguna, terbaru lebih dulu
              </caption>
              <thead>
                <tr className="text-[11px] uppercase tracking-[0.12em] text-white/40">
                  <th scope="col" className="border-b border-white/10 pb-2 pr-3 font-semibold">
                    Tanggal
                  </th>
                  <th scope="col" className="border-b border-white/10 pb-2 pr-3 font-semibold">
                    Tipe
                  </th>
                  <th scope="col" className="border-b border-white/10 pb-2 pr-3 font-semibold">
                    Efek saldo
                  </th>
                  <th scope="col" className="border-b border-white/10 pb-2 pr-3 font-semibold">
                    Pos saldo
                  </th>
                  <th scope="col" className="border-b border-white/10 pb-2 pr-3 font-semibold">
                    Status
                  </th>
                  <th scope="col" className="border-b border-white/10 pb-2 font-semibold">
                    Keterangan
                  </th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((row) => {
                  const negative = row.amount.startsWith("-");
                  const display = negative
                    ? formatMoney(row.amount, row.currency)
                    : `+${formatMoney(row.amount, row.currency)}`;
                  return (
                    <tr key={row.id} className="align-top">
                      <td className="border-b border-white/8 py-3 pr-3 text-xs text-white/55">
                        {formatDashboardDate(row.postedAt ?? row.createdAt)}
                      </td>
                      <td className="border-b border-white/8 py-3 pr-3 text-xs text-white">
                        {typeLabels[row.type] ?? row.type}
                      </td>
                      <td
                        className={
                          negative
                            ? "border-b border-white/8 py-3 pr-3 text-xs font-semibold text-red-300"
                            : "border-b border-white/8 py-3 pr-3 text-xs font-semibold text-[var(--color-neon)]"
                        }
                      >
                        {display}
                      </td>
                      <td className="border-b border-white/8 py-3 pr-3 text-xs text-white/55">
                        {bucketLabels[row.bucket] ?? row.bucket}
                        <span className="mt-0.5 block text-[11px] text-white/35">
                          saldo: {formatMoney(row.balanceAfter, row.currency)}
                        </span>
                      </td>
                      <td className="border-b border-white/8 py-3 pr-3">
                        <Badge variant={row.status === "POSTED" ? "default" : "gold"}>
                          {statusLabel(row.status)}
                        </Badge>
                      </td>
                      <td className="border-b border-white/8 py-3 text-xs text-white/55">
                        {row.description ? displayLegacyCurrencyText(row.description) : "—"}
                        <span className="mt-0.5 block font-mono text-[11px] text-white/30">
                          {row.reference}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
