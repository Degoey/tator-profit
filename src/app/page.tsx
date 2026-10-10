import { ArrowRight, BadgeCheck, CircleDollarSign, Layers, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";

import { DepositSection } from "@/components/landing/deposit-section";
import { ReferralSection } from "@/components/landing/referral-section";
import { TierSection } from "@/components/landing/tier-section";
import { WithdrawalSection } from "@/components/landing/withdrawal-section";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { WhatsAppCustomerServiceButton } from "@/components/support/whatsapp-cs-button";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PROGRAM_TIER_AMOUNTS } from "@/lib/config/program";
import { getCustomerServiceConfig } from "@/lib/config/support";
import { formatMoney, formatRate, toDecimal } from "@/lib/money";
import { getActiveProgram } from "@/lib/program-config";
import { previewReferralCommissions } from "@/lib/services/program-service";

export const dynamic = "force-dynamic";

function ConfigRow({
  label,
  value,
  accent = "neon",
}: {
  label: string;
  value: string;
  accent?: "neon" | "gold";
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-white/8 pb-2.5 last:border-0 last:pb-0">
      <span className="font-mono text-xs text-white/55">{label}</span>
      <span
        className={
          accent === "gold"
            ? "text-sm font-semibold text-[var(--color-gold)]"
            : "text-sm font-semibold text-[var(--color-neon)]"
        }
      >
        {value}
      </span>
    </div>
  );
}

export default async function LandingPage() {
  const { program, tiers, cycles, fromDatabase } = await getActiveProgram();

  const lowestTier = tiers.reduce(
    (lowest, tier) => (tier.joinAmount.lessThan(lowest) ? tier.joinAmount : lowest),
    toDecimal(PROGRAM_TIER_AMOUNTS[0]),
  );

  const referralBase =
    tiers.find((tier) => tier.joinAmount.equals(100))?.joinAmount ?? tiers[0]?.joinAmount ?? null;
  const referralRows = referralBase ? previewReferralCommissions(referralBase) : [];

  // Customer service runs on WhatsApp only: the landing page links out to the chat and
  // never renders a ticket form, a message box or a conversation history.
  const customerService = getCustomerServiceConfig({ topic: "Bantuan umum" });

  const highlights = [
    {
      icon: CircleDollarSign,
      label: `${tiers.length} nominal × ${cycles.length} durasi`,
      value: `${tiers.length * cycles.length} kombinasi program`,
    },
    { icon: Layers, label: "Target imbalan mingguan", value: formatRate(program.weeklyRewardRate) },
    {
      icon: BadgeCheck,
      label: "Durasi program",
      value: cycles
        .map((cycle) => `${cycle.cycleWeeks} minggu · ${formatRate(cycle.targetCycleRewardRate)}`)
        .join(" | "),
    },
  ];

  return (
    <div className="min-h-screen">
      <SiteHeader />

      <main>
        <section className="relative overflow-hidden border-b border-white/10">
          <div className="pointer-events-none absolute inset-0 grid-lines opacity-40" aria-hidden />
          <div className="relative mx-auto grid w-full max-w-6xl gap-12 px-5 py-20 lg:grid-cols-[1.1fr_0.9fr] lg:py-28">
            <div className="space-y-7">
              <Badge variant="gold">
                <Sparkles className="size-3.5" aria-hidden />
                Platform Program Imbalan · USDT
              </Badge>

              <div className="space-y-5">
                <h1 className="text-4xl font-semibold leading-[1.05] tracking-tight text-white sm:text-5xl lg:text-6xl">
                  Jangan cuma melihat orang lain untung. Mulai bangun{" "}
                  <span className="text-neon">program imbalan</span> yang{" "}
                  <span className="text-gold">menghasilkan hari ini</span>
                </h1>
                <p className="max-w-xl text-base leading-relaxed text-white/70">
                  Tatorprofit menyimpan setiap akun, profil, program, dan catatan imbalan di database
                  yang dapat diaudit. Pilih paket gabung sesuai kemampuan Anda — mulai dari{" "}
                  <span className="font-semibold text-white">
                    {formatMoney(lowestTier, program.currency)}
                  </span>
                  .
                </p>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <Button asChild size="lg">
                  <Link href="/register">
                    Mulai dari {formatMoney(lowestTier, program.currency)}
                    <ArrowRight aria-hidden />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <Link href="/login">Saya sudah punya akun</Link>
                </Button>
                <WhatsAppCustomerServiceButton
                  href={customerService.link}
                  location="beranda"
                  fallback={customerService.fallback}
                  size="lg"
                  variant="ghost"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                {highlights.map((item) => (
                  <div
                    key={item.label}
                    className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
                  >
                    <item.icon className="size-4 text-[var(--color-neon)]" aria-hidden />
                    <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/50">
                      {item.label}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-white">{item.value}</p>
                  </div>
                ))}
              </div>
            </div>

            <Card className="card-glow h-fit">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck className="size-5 text-[var(--color-neon)]" aria-hidden />
                  Konfigurasi program
                </CardTitle>
                <CardDescription>
                  Nilai di bawah dibaca dari konfigurasi program di database
                  {fromDatabase ? "" : " (mode fallback konfigurasi terpusat)"}.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <ConfigRow label="mata uang" value={program.currency} />
                <ConfigRow label="tarif imbalan mingguan" value={formatRate(program.weeklyRewardRate)} />
                <ConfigRow
                  label="durasi program"
                  value={cycles.map((cycle) => `${cycle.cycleWeeks} minggu`).join(" / ")}
                />
                <ConfigRow
                  label="target imbalan per siklus"
                  value={cycles.map((cycle) => formatRate(cycle.targetCycleRewardRate)).join(" / ")}
                  accent="gold"
                />
                <ConfigRow label="nominal gabung" value={`${tiers.length} nominal`} />
                <ConfigRow
                  label="kombinasi program"
                  value={`${tiers.length * cycles.length} kombinasi`}
                  accent="gold"
                />
                <Alert variant="warning" title="Ketentuan program" className="mt-4">
                  {program.rewardTerms}
                </Alert>
              </CardContent>
            </Card>
          </div>
        </section>

        <TierSection
          tiers={tiers}
          currency={program.currency}
          weeklyRewardRate={program.weeklyRewardRate}
          cycles={cycles}
        />

        <section id="program" className="border-b border-white/10 py-20">
          <div className="mx-auto w-full max-w-6xl px-5">
            <div className="space-y-3">
              <Badge>Ketentuan Program</Badge>
              <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                Bagaimana program imbalan bekerja
              </h2>
              <p className="max-w-3xl text-sm leading-relaxed text-white/65">
                Tatorprofit adalah platform pencatatan program imbalan. Setiap langkah disimpan
                sebagai data nyata di database — akun, profil, keanggotaan program, target imbalan,
                dan audit log.
              </p>
            </div>

            <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  step: "01",
                  title: "Buat akun",
                  body: "Registrasi menyimpan nama, nama pengguna, surel, nomor telepon, dan hash kata sandi (bcrypt) ke database. Tidak ada akun demo.",
                },
                {
                  step: "02",
                  title: "Pilih paket gabung",
                  body: "Keanggotaan tercatat sebagai menunggu konfirmasi dana karena belum ada gateway pembayaran. Tidak ada dana yang berpindah otomatis.",
                },
                {
                  step: "03",
                  title: "Target imbalan terjadwal",
                  body: `Sistem membuat target imbalan mingguan (${formatRate(program.weeklyRewardRate)}) untuk setiap durasi yang dipilih: ${cycles
                    .map((cycle) => `${cycle.cycleWeeks} minggu (${formatRate(cycle.targetCycleRewardRate)})`)
                    .join(", ")}.`,
                },
                {
                  step: "04",
                  title: "Transparan & teraudit",
                  body: "Saldo, transaksi, notifikasi, peristiwa keamanan, dan audit log tersimpan permanen dan dapat ditinjau.",
                },
              ].map((item) => (
                <div
                  key={item.step}
                  className="rounded-2xl border border-white/10 bg-white/[0.03] p-5"
                >
                  <span className="font-mono text-xs text-[var(--color-gold)]">{item.step}</span>
                  <h3 className="mt-3 text-base font-semibold text-white">{item.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-white/60">{item.body}</p>
                </div>
              ))}
            </div>

            <Alert variant="warning" title="Disclaimer hasil" className="mt-8 max-w-3xl">
              Imbalan adalah target program yang bergantung pada kualifikasi, ketentuan, dan
              kepatuhan program. Imbalan bukan jaminan keuntungan, bukan produk investasi, dan tidak
              ada garansi hasil finansial apa pun.
            </Alert>
          </div>
        </section>

        <DepositSection />

        <WithdrawalSection />

        <ReferralSection
          rows={referralRows}
          baseAmount={referralBase ? formatMoney(referralBase, program.currency) : "-"}
        />
      </main>

      <SiteFooter />
    </div>
  );
}
