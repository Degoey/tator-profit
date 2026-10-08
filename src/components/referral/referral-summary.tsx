import { CircleDollarSign, Hourglass, Network, Users } from "lucide-react";

import { StatCard } from "@/components/dashboard/stat-card";
import type { ReferralLevelRow, ReferralTotals } from "@/app/referral/overview";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/lib/money";

export interface ReferralSummaryProps {
  directReferrals: number;
  totalNetwork: number;
  levels: ReferralLevelRow[];
  totals: ReferralTotals;
  truncated: boolean;
}

export function ReferralSummary({
  directReferrals,
  totalNetwork,
  levels,
  totals,
  truncated,
}: ReferralSummaryProps) {
  return (
    <section className="space-y-4" aria-label="Ringkasan rujukan">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Rujukan langsung"
          value={String(directReferrals)}
          hint="Anggota pada generasi 1"
          icon={Users}
        />
        <StatCard
          label="Total jaringan"
          value={String(totalNetwork)}
          hint={truncated ? "Dibatasi 500 anggota tampilan" : "Seluruh generasi 1 sampai 5"}
          icon={Network}
          tone="muted"
        />
        <StatCard
          label="Komisi dibayar"
          value={formatMoney(totals.paid, totals.currency)}
          hint={`${totals.count} baris komisi tercatat`}
          icon={CircleDollarSign}
          tone="gold"
        />
        <StatCard
          label="Komisi menunggu"
          value={formatMoney(totals.pending, totals.currency)}
          hint={`Disetujui: ${formatMoney(totals.approved, totals.currency)}`}
          icon={Hourglass}
          tone="muted"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Ringkasan per tingkat</CardTitle>
          <CardDescription>
            Jumlah anggota berasal dari pohon jaringan; total komisi berasal dari baris komisi
            rujukan milik akun Anda.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <caption className="sr-only">
              Ringkasan anggota dan komisi rujukan untuk setiap tingkat dari satu sampai lima
            </caption>
            <thead>
              <tr className="border-b border-white/10 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-white/45">
                <th scope="col" className="py-2 pr-3">Tingkat</th>
                <th scope="col" className="py-2 pr-3">Tarif</th>
                <th scope="col" className="py-2 pr-3">Anggota</th>
                <th scope="col" className="py-2 pr-3">Baris komisi</th>
                <th scope="col" className="py-2 text-right">Total komisi</th>
              </tr>
            </thead>
            <tbody>
              {levels.map((row) => (
                <tr key={row.level} className="border-b border-white/5 last:border-b-0">
                  <th scope="row" className="py-3 pr-3 text-left font-medium text-white/80">
                    Tingkat {row.level}
                    <span className="block text-xs font-normal text-white/40">{row.label}</span>
                  </th>
                  <td className="py-3 pr-3 font-mono text-xs text-[var(--color-neon)]">{row.rate}</td>
                  <td className="py-3 pr-3 text-white/70">{row.members}</td>
                  <td className="py-3 pr-3 text-white/70">{row.commissionCount}</td>
                  <td className="py-3 text-right font-semibold text-white">
                    {formatMoney(row.commissionTotal, row.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-4 text-xs text-white/45">
            Ditolak: {formatMoney(totals.rejected, totals.currency)} · Dibatalkan:{" "}
            {formatMoney(totals.voided, totals.currency)}
          </p>
        </CardContent>
      </Card>
    </section>
  );
}
