import { Coins, Gift, Hourglass, Target } from "lucide-react";
import type { Metadata } from "next";

import { PaymentKpis, PaymentShell } from "@/components/payments/payment-shell";
import { formatPaymentDate } from "@/components/payments/status-badge";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/current-user";
import { formatMoney, formatRate } from "@/lib/money";
import { getProgramProgress, getRewardOverview, listRewards } from "@/lib/services/reward-service";
import { statusLabel } from "@/lib/status-labels";

export const metadata: Metadata = {
  title: "Imbalan",
  description:
    "Daftar target imbalan mingguan akun Tatorprofit Anda: periode, tarif, nilai dalam USDT, status persetujuan, dan tautan ke buku besar.",
};

export const dynamic = "force-dynamic";

const STATUS_VARIANTS: Record<string, "default" | "gold" | "muted" | "danger"> = {
  PENDING: "gold",
  APPROVED: "default",
  PAID: "default",
  REJECTED: "danger",
  VOID: "muted",
};

export default async function RewardsPage() {
  const user = await requireUser("/rewards");

  const [overview, rewards, progress] = await Promise.all([
    getRewardOverview(user.id),
    listRewards(user.id, { take: 60 }),
    getProgramProgress(user.id),
  ]);

  const activeMemberships = progress.filter((row) => row.status === "ACTIVE").length;

  return (
    <PaymentShell
      active="/rewards"
      isAdmin={user.role === "ADMIN"}
      title="Imbalan program"
      description="Setiap baris imbalan dihitung di server memakai aritmetika desimal dari nilai gabung dan tarif yang tersimpan pada keanggotaan Anda. Imbalan hanya masuk saldo setelah disetujui dan dibayar oleh admin."
    >
      <PaymentKpis
        items={[
          {
            label: "Menunggu persetujuan",
            value: formatMoney(overview.totals.pending, user.balance.currency),
            hint: `${overview.counts.PENDING} periode tercatat`,
            tone: "gold",
          },
          {
            label: "Disetujui",
            value: formatMoney(overview.totals.approved, user.balance.currency),
            hint: `${overview.counts.APPROVED} periode menunggu pembayaran`,
          },
          {
            label: "Sudah dibayar",
            value: formatMoney(overview.totals.paid, user.balance.currency),
            hint: `${overview.counts.PAID} periode masuk saldo tersedia`,
          },
          {
            label: "Program aktif",
            value: String(activeMemberships),
            hint: `dari ${progress.length} keanggotaan`,
          },
        ]}
      />

      <Alert variant="info" title="Ketentuan imbalan">
        Target imbalan adalah ketentuan program, bukan jaminan hasil. Nilai pada halaman ini
        dihitung dari tarif yang tersimpan saat Anda bergabung, sehingga perubahan konfigurasi
        setelahnya tidak mengubah perhitungan periode lama.
      </Alert>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gift className="size-4 text-[var(--color-neon)]" aria-hidden />
            Riwayat imbalan
          </CardTitle>
          <CardDescription>
            60 baris terbaru milik akun @{user.username}. Periode yang sama tidak pernah tercatat dua
            kali karena setiap imbalan memiliki kunci unik per keanggotaan, siklus, dan periode.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rewards.length === 0 ? (
            <p className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-6 text-center text-sm text-white/60">
              Belum ada imbalan tercatat. Imbalan dibuat setelah setoran Anda disetujui admin dan
              periode minggu pertama berjalan.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[44rem] border-collapse text-left text-sm">
                <caption className="sr-only">
                  Riwayat imbalan pengguna, periode terbaru lebih dulu
                </caption>
                <thead>
                  <tr className="text-[11px] uppercase tracking-[0.12em] text-white/50">
                    <th scope="col" className="border-b border-white/10 pb-2 pr-3 font-semibold">
                      Periode
                    </th>
                    <th scope="col" className="border-b border-white/10 pb-2 pr-3 font-semibold">
                      Paket
                    </th>
                    <th scope="col" className="border-b border-white/10 pb-2 pr-3 font-semibold">
                      Tarif
                    </th>
                    <th scope="col" className="border-b border-white/10 pb-2 pr-3 font-semibold">
                      Nilai target
                    </th>
                    <th scope="col" className="border-b border-white/10 pb-2 pr-3 font-semibold">
                      Status
                    </th>
                    <th scope="col" className="border-b border-white/10 pb-2 font-semibold">
                      Jadwal / dibayar
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rewards.map((reward) => (
                    <tr key={reward.id} className="align-top">
                      <td className="border-b border-white/8 py-3 pr-3 text-xs text-white">
                        Siklus {reward.cycleNumber} · minggu {reward.period}
                      </td>
                      <td className="border-b border-white/8 py-3 pr-3 font-mono text-[11px] text-white/60">
                        {reward.tierCode}
                      </td>
                      <td className="border-b border-white/8 py-3 pr-3 text-xs text-white/70">
                        {formatRate(reward.rate)}
                      </td>
                      <td className="border-b border-white/8 py-3 pr-3 text-xs font-semibold text-[var(--color-neon)]">
                        {formatMoney(reward.amount, user.balance.currency)}
                      </td>
                      <td className="border-b border-white/8 py-3 pr-3">
                        <Badge variant={STATUS_VARIANTS[reward.status] ?? "muted"}>
                          {statusLabel(reward.status)}
                        </Badge>
                      </td>
                      <td className="border-b border-white/8 py-3 text-xs text-white/60">
                        {formatPaymentDate(reward.paidAt ?? reward.scheduledFor ?? reward.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Hourglass className="size-4 text-[var(--color-gold)]" aria-hidden />
            Progres periode per keanggotaan
          </CardTitle>
          <CardDescription>
            Minggu yang sudah berjalan dan status setiap periode pada keanggotaan Anda.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {progress.length === 0 ? (
            <p className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-6 text-center text-sm text-white/60">
              Belum ada keanggotaan program. Pilih paket pada halaman Program untuk mulai.
            </p>
          ) : (
            progress.map((membership) => (
              <div
                key={membership.userProgramId}
                className="rounded-xl border border-white/10 bg-white/[0.03] p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="muted">{membership.tierCode}</Badge>
                    <span className="text-sm text-white">{membership.tierName}</span>
                  </div>
                  <Badge variant={membership.status === "ACTIVE" ? "default" : "gold"}>
                    {statusLabel(membership.status)}
                  </Badge>
                </div>
                <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-3">
                  <div>
                    <dt className="flex items-center gap-1.5 text-white/60">
                      <Coins className="size-3.5" aria-hidden />
                      Nilai gabung
                    </dt>
                    <dd className="mt-1 text-white/85">
                      {formatMoney(membership.joinAmount, membership.currency)}
                    </dd>
                  </div>
                  <div>
                    <dt className="flex items-center gap-1.5 text-white/60">
                      <Target className="size-3.5" aria-hidden />
                      Target mingguan
                    </dt>
                    <dd className="mt-1 text-white/85">
                      {formatRate(membership.weeklyRewardRate)} · {membership.cycleWeeks} minggu
                    </dd>
                  </div>
                  <div>
                    <dt className="text-white/60">Minggu berjalan</dt>
                    <dd className="mt-1 text-white/85">
                      {membership.weeksCompleted} dari {membership.cycleWeeks}
                    </dd>
                  </div>
                </dl>
                {membership.periods.length > 0 ? (
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {membership.periods.map((period) => (
                      <li
                        key={period.period}
                        className="rounded-lg border border-white/10 bg-white/[0.02] px-2.5 py-1.5 text-[11px] text-white/70"
                      >
                        Minggu {period.period}: {statusLabel(period.status)} ·{" "}
                        {formatMoney(period.amount, membership.currency)}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </PaymentShell>
  );
}
