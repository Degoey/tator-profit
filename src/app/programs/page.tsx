import { CalendarClock, Layers, Target } from "lucide-react";
import type { Metadata } from "next";

import { JoinTierButton } from "@/components/programs/join-tier-button";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth/current-user";
import { cycleRewardTarget, weeklyRewardTarget } from "@/lib/config/program";
import { formatMoney, formatRate } from "@/lib/money";
import { getActiveProgram } from "@/lib/program-config";
import { getUserPrograms } from "@/lib/services/program-service";
import { statusLabel } from "@/lib/status-labels";

export const metadata: Metadata = {
  title: "Program",
  description:
    "Sembilan nominal program Tatorprofit dalam USDT dikalikan tiga durasi (4, 8, dan 12 minggu) menjadi 27 kombinasi program dengan target imbalan mingguan dan ketentuan program yang berlaku.",
};

export const dynamic = "force-dynamic";

/** Disclaimer required on every program surface. */
const PROGRAM_DISCLAIMER =
  "Target imbalan mengikuti ketentuan program, kualifikasi, dan aturan yang berlaku.";

export default async function ProgramsPage() {
  const [user, { program, tiers, cycles, fromDatabase }] = await Promise.all([
    getCurrentUser(),
    getActiveProgram(),
  ]);

  const memberships = user ? await getUserPrograms(user.id) : [];
  const membershipByCombination = new Map(
    memberships.map((row) => [`${row.tierCode}:${row.cycleWeeks}`, row.status]),
  );
  const combinationCount = tiers.length * cycles.length;

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <main className="mx-auto w-full max-w-6xl flex-1 space-y-8 px-5 py-10">
        <section className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{program.name}</Badge>
            <Badge variant="muted">{program.currency}</Badge>
            <Badge variant="gold">Target Imbalan: {formatRate(program.weeklyRewardRate)} per minggu</Badge>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Paket program
          </h1>
          <p className="max-w-3xl text-sm leading-relaxed text-white/60">
            Setiap kombinasi memakai struktur yang sama: target imbalan{" "}
            {formatRate(program.weeklyRewardRate)} per minggu dari nilai gabung. Tersedia{" "}
            {tiers.length} nominal dan {cycles.length} durasi ({cycles
              .map((cycle) => `${cycle.cycleWeeks} minggu`)
              .join(", ")}) sehingga total {combinationCount} kombinasi program, dengan target siklus{" "}
            {cycles.map((cycle) => formatRate(cycle.targetCycleRewardRate)).join(" / ")}. Angka pada
            halaman ini dihitung dari konfigurasi database memakai aritmetika desimal.
          </p>
          <Alert variant="info" title="Cara gabung bekerja">
            Gabung tidak melakukan pembayaran di website ini. Sistem mencatat dana yang masuk
            (dikonfirmasi admin) dan menghitung target imbalan sesuai ketentuan program. Semua nilai
            disimpan sebagai desimal di PostgreSQL.
          </Alert>
          <p className="text-xs leading-relaxed text-white/45">
            {PROGRAM_DISCLAIMER} Sumber konfigurasi:{" "}
            {fromDatabase ? "database program aktif" : "konfigurasi pusat (fallback)"}.
          </p>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tiers.map((tier) => {
            const weeklyTarget = weeklyRewardTarget(tier.joinAmount, program.weeklyRewardRate);

            return (
              <Card key={tier.id} className="flex flex-col justify-between">
                <CardHeader className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle className="text-2xl">
                      {formatMoney(tier.joinAmount, tier.currency)}
                    </CardTitle>
                    <Badge variant="muted">{tier.code}</Badge>
                  </div>
                  <CardDescription className="flex flex-wrap items-center gap-2">
                    <Badge variant={program.status === "ACTIVE" ? "default" : "danger"}>
                      {statusLabel(program.status)}
                    </Badge>
                  </CardDescription>
                </CardHeader>

                <CardContent className="space-y-4">
                  <dl className="space-y-2.5 text-sm">
                    <Row label="Nilai gabung" value={formatMoney(tier.joinAmount, tier.currency)} />
                    <Row
                      label={`Target imbalan mingguan (${formatRate(program.weeklyRewardRate)})`}
                      value={formatMoney(weeklyTarget, tier.currency)}
                      accent="gold"
                    />
                  </dl>

                  <div className="space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-white/40">
                      Pilih durasi
                    </p>
                    {cycles.map((cycle) => {
                      const cycleTarget = cycleRewardTarget(
                        tier.joinAmount,
                        cycle.weeklyRewardRate,
                        cycle.cycleWeeks,
                      );
                      const membershipStatus = membershipByCombination.get(
                        `${tier.code}:${cycle.cycleWeeks}`,
                      );

                      return (
                        <div
                          key={cycle.id}
                          className="space-y-2 rounded-xl border border-white/10 bg-white/[0.02] p-3"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-sm font-semibold text-white">
                              {cycle.cycleWeeks} minggu
                            </span>
                            <Badge variant="gold">
                              Target {formatRate(cycle.targetCycleRewardRate)}
                            </Badge>
                          </div>
                          <dl className="space-y-2 text-xs">
                            <Row
                              label={`Target per minggu (${formatRate(cycle.weeklyRewardRate)})`}
                              value={formatMoney(
                                weeklyRewardTarget(tier.joinAmount, cycle.weeklyRewardRate),
                                tier.currency,
                              )}
                            />
                            <Row
                              label="Target imbalan per siklus"
                              value={formatMoney(cycleTarget, tier.currency)}
                            />
                          </dl>
                          {membershipStatus ? (
                            <Badge variant="gold">
                              Keanggotaan: {statusLabel(membershipStatus)}
                            </Badge>
                          ) : null}
                          <JoinTierButton
                            tierId={tier.id}
                            cycleId={cycle.id}
                            cycleWeeks={cycle.cycleWeeks}
                            tierCode={tier.code}
                            joinAmount={tier.joinAmount.toFixed(2)}
                            currency={tier.currency}
                            authenticated={Boolean(user)}
                          />
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </section>

        <section className="grid gap-4 sm:grid-cols-3">
          <InfoCard
            icon={Target}
            title="Target, bukan jaminan"
            body="Target imbalan dihitung dari nilai gabung dan tarif program. Pencairan mengikuti kualifikasi dan persetujuan internal."
          />
          <InfoCard
            icon={CalendarClock}
            title={`Durasi ${cycles.map((cycle) => cycle.cycleWeeks).join(" / ")} minggu`}
            body="Setiap minggu dalam siklus dievaluasi oleh mesin imbalan sebagai periode terpisah, dari Minggu 1 sampai minggu terakhir durasi yang dipilih. Durasi 4 minggu berhenti di Minggu 4, 8 minggu di Minggu 8, dan 12 minggu di Minggu 12."
          />
          <InfoCard
            icon={Layers}
            title="Buku besar permanen"
            body="Catatan finansial tidak dapat dihapus. Koreksi dilakukan sebagai transaksi penyesuaian baru dengan audit log."
          />
        </section>

      </main>

      <SiteFooter />
    </div>
  );
}

function Row({
  label,
  value,
  accent = "neon",
}: {
  label: string;
  value: string;
  accent?: "neon" | "gold";
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/8 pb-2 last:border-0 last:pb-0">
      <dt className="text-xs text-white/50">{label}</dt>
      <dd
        className={
          accent === "gold"
            ? "text-sm font-semibold text-[var(--color-gold)]"
            : "text-sm font-semibold text-white"
        }
      >
        {value}
      </dd>
    </div>
  );
}

function InfoCard({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Target;
  title: string;
  body: string;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-[var(--color-neon)]" aria-hidden />
        <p className="text-sm font-semibold text-white">{title}</p>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-white/55">{body}</p>
    </Card>
  );
}

