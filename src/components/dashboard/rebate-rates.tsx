import { Percent } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export interface RebateRateRow {
  /** Network generation (1..5). */
  generation: number;
  /** Display percentage, e.g. `10%`. */
  rate: string;
}

export interface RebateRatesProps {
  rows: RebateRateRow[];
}

/**
 * "Persentase Komisi Rabat" — the five-generation rebate table shown on the
 * member dashboard. It renders the single shared configuration, so the member,
 * the admin screen and the calculation engine always display the same numbers.
 *
 * The layout is a two-column table that stays readable on phones and desktops.
 */
export function RebateRates({ rows }: RebateRatesProps) {
  return (
    <Card id="komisi-rabat" data-section="persentase-komisi-rabat">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Percent className="size-4 text-[var(--color-neon)]" aria-hidden />
          Persentase Komisi Rabat
        </CardTitle>
        <CardDescription>
          Komisi rabat dibayarkan hingga lima generasi jaringan. Besaran persentase mengikuti
          konfigurasi resmi Tatorprofit dan dihitung dari nilai transaksi program yang memenuhi
          syarat.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="overflow-hidden rounded-xl border border-white/10">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">Persentase komisi rabat per generasi jaringan</caption>
            <thead>
              <tr className="bg-white/[0.04] text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-white/50">
                <th scope="col" className="px-4 py-3">
                  Generasi jaringan
                </th>
                <th scope="col" className="px-4 py-3 text-right">
                  Persentase rabat
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.generation}
                  className="border-t border-white/10 bg-white/[0.02]"
                >
                  <th scope="row" className="px-4 py-3 text-left font-medium text-white/80">
                    Generasi {row.generation}
                  </th>
                  <td className="px-4 py-3 text-right font-semibold text-[var(--color-neon)]">
                    {row.rate}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-xs leading-relaxed text-white/55">
          Persentase tersebut merupakan ketentuan rabat berdasarkan generasi jaringan dan bukan
          jaminan nominal penghasilan. Jumlah rabat yang diterima bergantung pada aktivitas
          transaksi program yang sah di jaringan Anda.
        </p>
      </CardContent>
    </Card>
  );
}
