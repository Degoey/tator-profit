import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ReferralCommissionRow } from "@/app/referral/overview";
import { referralCommissionStatusTone } from "@/components/referral/commission-status";
import { formatMoney, formatRate } from "@/lib/money";

export interface ReferralCommissionTableProps {
  commissions: ReferralCommissionRow[];
}

const dateFormatter = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "medium",
  timeZone: "UTC",
});

export function ReferralCommissionTable({ commissions }: ReferralCommissionTableProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Tabel komisi rujukan</CardTitle>
        <CardDescription>
          Hingga 200 baris komisi terbaru. Setiap baris terikat pada satu transaksi program yang
          tercatat di buku besar; komisi baru masuk saldo setelah dibayar oleh administrator.
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {commissions.length ? (
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <caption className="sr-only">Daftar komisi rujukan terbaru milik akun Anda</caption>
            <thead>
              <tr className="border-b border-white/10 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-white/45">
                <th scope="col" className="py-2 pr-3">Tanggal</th>
                <th scope="col" className="py-2 pr-3">Sumber</th>
                <th scope="col" className="py-2 pr-3">Tingkat</th>
                <th scope="col" className="py-2 pr-3">Tarif</th>
                <th scope="col" className="py-2 pr-3">Status</th>
                <th scope="col" className="py-2 text-right">Jumlah</th>
              </tr>
            </thead>
            <tbody>
              {commissions.map((row) => (
                <tr key={row.id} className="border-b border-white/5 last:border-b-0">
                  <td className="py-3 pr-3 text-white/60">
                    <time dateTime={row.createdAt.toISOString()}>
                      {dateFormatter.format(row.createdAt)}
                    </time>
                  </td>
                  <td className="py-3 pr-3 font-medium text-white">@{row.sourceUsername}</td>
                  <td className="py-3 pr-3 text-white/70">Tingkat {row.level}</td>
                  <td className="py-3 pr-3 font-mono text-xs text-[var(--color-neon)]">
                    {formatRate(row.rate)}
                  </td>
                  <td className="py-3 pr-3">
                    <Badge variant={referralCommissionStatusTone(row.status)}>
                      {row.statusLabel}
                    </Badge>
                  </td>
                  <td className="py-3 text-right font-semibold text-white">
                    {formatMoney(row.amount, row.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p role="status" className="text-sm text-white/60">
            Belum ada komisi rujukan tercatat. Komisi muncul setelah anggota jaringan Anda
            menyelesaikan peristiwa program yang memenuhi syarat.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
