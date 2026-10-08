import { ArrowRight, Calculator, Target } from "lucide-react";
import type { Prisma } from "@prisma/client";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  cycleRewardTarget,
  weeklyRewardTarget,
  type ProgramCycleConfig,
  type ProgramTierConfig,
} from "@/lib/config/program";
import { formatMoney, formatRate } from "@/lib/money";

export interface TierSectionProps {
  tiers: ProgramTierConfig[];
  currency: string;
  weeklyRewardRate: Prisma.Decimal;
  /** Selectable durations (4 / 8 / 12 weeks); 9 amounts x 3 durations = 27 combinations. */
  cycles: ProgramCycleConfig[];
}

export function TierSection({
  tiers,
  currency,
  weeklyRewardRate,
  cycles,
}: TierSectionProps) {
  const cheapest = tiers[0]?.joinAmount;

  return (
    <section id="tiers" className="border-b border-white/10 py-20">
      <div className="mx-auto w-full max-w-6xl px-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-3">
            <Badge>Pilihan Paket</Badge>
            <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              {cheapest ? `Mulai dari ${formatMoney(cheapest, currency)}` : "Mulai dari 10 USDT"}
            </h2>
            <p className="max-w-2xl text-sm leading-relaxed text-white/65">
              Sembilan nominal gabung dikalikan tiga durasi menjadi 27 kombinasi program. Setiap
              kombinasi memakai target imbalan mingguan {formatRate(weeklyRewardRate)} dari nilai
              gabung, dengan target siklus {cycles.map((cycle) => formatRate(
                cycle.targetCycleRewardRate,
              )).join(" / ")} untuk durasi {cycles.map((cycle) => cycle.cycleWeeks).join(" / ")} minggu.
              Nominal dan durasi dikelola sebagai konfigurasi database sehingga admin dapat
              menyesuaikannya.
            </p>
          </div>
          <Button asChild variant="outline">
            <Link href="/register">
              Buat akun Anda
              <ArrowRight aria-hidden />
            </Link>
          </Button>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tiers.map((tier) => {
            const weekly = weeklyRewardTarget(tier.joinAmount, weeklyRewardRate);

            return (
              <Card key={tier.id} className="transition-colors hover:border-[var(--color-neon)]/35">
                <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
                  <CardTitle className="text-2xl">
                    {formatMoney(tier.joinAmount, tier.currency)}
                  </CardTitle>
                  <Badge variant="muted">{tier.code}</Badge>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="flex items-center gap-2 text-white/70">
                    <Target className="size-4 text-[var(--color-neon)]" aria-hidden />
                    <span>
                      Target imbalan mingguan{" "}
                      <span className="font-semibold text-white">
                        {formatMoney(weekly, currency)}
                      </span>
                    </span>
                  </div>
                  <div className="space-y-2 rounded-xl border border-white/10 bg-white/[0.02] p-3">
                    <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-white/45">
                      <Calculator className="size-3.5 text-[var(--color-gold)]" aria-hidden />
                      Pilihan durasi
                    </p>
                    {cycles.map((cycle) => (
                      <div
                        key={cycle.id}
                        className="flex items-center justify-between gap-3 text-xs text-white/70"
                      >
                        <span>
                          {cycle.cycleWeeks} minggu Â· target {formatRate(cycle.targetCycleRewardRate)}
                        </span>
                        <span className="font-semibold text-white">
                          {formatMoney(
                            cycleRewardTarget(
                              tier.joinAmount,
                              cycle.weeklyRewardRate,
                              cycle.cycleWeeks,
                            ),
                            currency,
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs leading-relaxed text-white/45">
                    Angka di atas adalah target imbalan berdasarkan ketentuan program, bukan jaminan
                    hasil. Kualifikasi dan ketentuan program berlaku.
                  </p>
                </CardContent>
                <CardFooter>
                  <Button asChild className="w-full" variant="ghost">
                    <Link href="/register">Gabung paket ini</Link>
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
}
