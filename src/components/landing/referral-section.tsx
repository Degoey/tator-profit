import { Network, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { REFERRAL_DEPTH, REFERRAL_LEVEL_RATES } from "@/lib/config/referral";
import { formatMoney, formatRate } from "@/lib/money";

export interface ReferralSectionProps {
  rows: { level: number; rate: string; amount: string }[];
  baseAmount: string;
}

export function ReferralSection({ rows, baseAmount }: ReferralSectionProps) {
  return (
    <section id="referral" className="py-20">
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-5 lg:grid-cols-[0.95fr_1.05fr]">
        <div className="space-y-4">
          <Badge variant="gold">
            <Network className="size-3.5" aria-hidden />
            Struktur Rujukan
          </Badge>
          <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            {REFERRAL_DEPTH} tingkat rujukan, satu konfigurasi terpusat.
          </h2>
          <p className="text-sm leading-relaxed text-white/65">
            Hubungan rujukan dicatat satu kali saat pendaftaran dan tidak diubah di luar proses
            admin yang teraudit. Komisi rujukan dihitung dengan desimal (bukan floating point) dan
            disimpan sebagai catatan transaksi terpisah dari imbalan program.
          </p>

          <ul className="space-y-2.5">
            {REFERRAL_LEVEL_RATES.map((level) => (
              <li
                key={level.level}
                className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm"
              >
                <span className="flex items-center gap-2 text-white/75">
                  <Users className="size-4 text-[var(--color-neon)]" aria-hidden />
                  Tingkat {level.level}
                  <span className="text-xs text-white/40">({level.label})</span>
                </span>
                <span className="font-semibold text-[var(--color-gold)]">
                  {formatRate(level.rate)}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <Card className="card-glow">
          <CardHeader>
            <CardTitle>Ilustrasi komisi rujukan</CardTitle>
            <CardDescription>
              Contoh perhitungan berbasis nilai program {baseAmount} (USDT). Angka ilustratif,
              bukan proyeksi hasil.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-3 gap-3 border-b border-white/10 pb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/45">
              <span>Tingkat</span>
              <span>Tarif</span>
              <span className="text-right">Komisi</span>
            </div>
            {rows.map((row) => (
              <div key={row.level} className="grid grid-cols-3 gap-3 text-sm">
                <span className="text-white/70">Tingkat {row.level}</span>
                <span className="font-mono text-xs text-white/55">{formatRate(row.rate)}</span>
                <span className="text-right font-semibold text-[var(--color-neon)]">
                  {formatMoney(row.amount, "USDT")}
                </span>
              </div>
            ))}
            <p className="pt-3 text-xs leading-relaxed text-white/45">
              Komisi rujukan hanya tercatat ketika peristiwa sumbernya valid dan tersimpan di
              database. Tidak ada jaminan pendapatan dari struktur rujukan.
            </p>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
