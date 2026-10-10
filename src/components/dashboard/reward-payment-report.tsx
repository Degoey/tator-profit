import { ReceiptText } from "lucide-react";
import Link from "next/link";

import { formatPaymentDate } from "@/components/payments/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney, formatRate } from "@/lib/money";

export interface RewardPaymentRow {
  id: string;
  /** Week number of the reward inside its cycle. */
  period: number;
  cycleNumber: number;
  tierCode: string;
  /** Configured weekly rate of the membership, e.g. `20%`. */
  rate: string;
  amount: string;
  currency: string;
  status: string;
  statusLabel: string;
  /** Timestamp of the payout; `null` while the reward is not paid yet. */
  paidAt: Date | null;
}

const STATUS_VARIANTS: Record<string, "default" | "gold" | "muted" | "danger"> = {
  PENDING: "gold",
  APPROVED: "default",
  PAID: "default",
  REJECTED: "danger",
  VOID: "muted",
};

/**
 * "Laporan Pembayaran Profit" — the reward periods of the signed-in member with
 * the rate that produced them, the amount, its lifecycle status and the payout
 * date.
 *
 * Everything is read from the `Reward` rows of the member, so the report can
 * never show a payout the database does not contain. A period that has not been
 * paid yet shows a dash instead of a date, which is the difference between
 * "tercatat" and "dibayar".
 */
export function RewardPaymentReport({ rows }: { rows: RewardPaymentRow[] }) {
  return (
    <Card id="laporan-pembayaran-profit" data-section="laporan-pembayaran-profit">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ReceiptText className="size-4 text-[var(--color-neon)]" aria-hidden />
          Laporan Pembayaran Profit
        </CardTitle>
        <CardDescription>
          Periode imbalan terbaru beserta tarif, nominal, status, dan tanggal pembayarannya.
          Nominal berasal dari catatan imbalan program, bukan angka contoh.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {rows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-6 text-center text-sm text-white/60">
            Belum ada periode imbalan tercatat. Target imbalan dibuat setelah keanggotaan program
            Anda diaktifkan admin, dan pembayarannya dicatat pada laporan ini.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">
                Laporan pembayaran profit per periode imbalan
              </caption>
              <thead>
                <tr className="bg-white/[0.04] text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-white/50">
                  <th scope="col" className="px-4 py-3">
                    Periode
                  </th>
                  <th scope="col" className="px-4 py-3 text-right">
                    Tarif
                  </th>
                  <th scope="col" className="px-4 py-3 text-right">
                    Nominal
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Dibayar
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-white/10 bg-white/[0.02]">
                    <th scope="row" className="px-4 py-3 text-left font-medium text-white/80">
                      Minggu {row.period}
                      <span className="ml-2 font-mono text-[11px] text-white/45">
                        siklus {row.cycleNumber} · {row.tierCode}
                      </span>
                    </th>
                    <td className="px-4 py-3 text-right font-mono text-xs text-white/55">
                      {formatRate(row.rate)}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-[var(--color-neon)]">
                      {formatMoney(row.amount, row.currency)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={STATUS_VARIANTS[row.status] ?? "muted"}>
                        {row.statusLabel}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-xs text-white/60">
                      {row.paidAt ? formatPaymentDate(row.paidAt) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-xs leading-relaxed text-white/55">
          Hanya imbalan berstatus dibayar yang menambah saldo tersedia Anda. Periode yang masih
          menunggu persetujuan atau belum dibayar belum menjadi saldo yang dapat ditarik.
        </p>

        <Button asChild variant="outline" size="sm">
          <Link href="/rewards">Buka halaman imbalan</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
