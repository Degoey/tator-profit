import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CircleDollarSign,
  Coins,
  Hourglass,
  Layers,
  ShieldCheck,
  TrendingUp,
  Users,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { LogoutButton } from "@/components/auth/logout-button";
import { JoinProgramPanel } from "@/components/dashboard/join-program-panel";
import { NetworkTree } from "@/components/dashboard/network-tree";
import { ProgramProgress } from "@/components/dashboard/program-progress";
import { RebateRates } from "@/components/dashboard/rebate-rates";
import { ReferralPanel } from "@/components/dashboard/referral-panel";
import { StatCard } from "@/components/dashboard/stat-card";
import { TransactionHistory } from "@/components/dashboard/transaction-history";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { WhatsAppCustomerServiceButton } from "@/components/support/whatsapp-cs-button";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/current-user";
import { getCustomerServiceConfig } from "@/lib/config/support";
import { formatMoney, formatRate } from "@/lib/money";
import { getActiveProgram } from "@/lib/program-config";
import { getRebateRates } from "@/lib/rebate-config";
import { getBalance, listTransactions } from "@/lib/services/ledger-service";
import { getProgramProgress, getRewardOverview } from "@/lib/services/reward-service";
import {
  getReferralCommissionSummary,
  getReferralNetwork,
} from "@/lib/services/referral-service";
import { statusLabel } from "@/lib/status-labels";

export const metadata: Metadata = {
  title: "Dasbor",
  description: "Ringkasan saldo, program, imbalan, dan rujukan Tatorprofit Anda.",
};

export const dynamic = "force-dynamic";

interface DashboardSearchParams {
  welcome?: string;
  error?: string;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<DashboardSearchParams>;
}) {
  const params = await searchParams;
  const user = await requireUser("/dashboard");

  const { program, tiers, cycles } = await getActiveProgram();
  const [balance, progress, rewards, transactions, network, referralCommissions, rebateRates] =
    await Promise.all([
      getBalance(user.id),
      getProgramProgress(user.id),
      getRewardOverview(user.id),
      listTransactions(user.id, 10),
      getReferralNetwork({ id: user.id, username: user.username }),
      getReferralCommissionSummary(user.id),
      // The single rebate configuration shared with the admin screen and the engine.
      getRebateRates(),
    ]);

  const referral = { directReferrals: network.counts[0] ?? 0, totalNetwork: network.total };

  // WhatsApp is the only customer service channel: the dashboard links to the chat and
  // stores no ticket, message or conversation history of its own.
  const customerService = getCustomerServiceConfig({
    topic: "Bantuan umum",
    username: user.username,
  });
  const referralLevels = rebateRates.map((entry) => ({
    level: entry.generation,
    rate: entry.displayRate,
  }));
  const rebateRows = rebateRates.map((entry) => ({
    generation: entry.generation,
    rate: entry.displayRate,
  }));

  const totalBalance = balance.availableAmount.plus(balance.pendingAmount);
  const activePrograms = progress.filter((item) => item.status === "ACTIVE").length;
  const transactionRows = transactions.map((row) => ({
    id: row.id,
    type: row.type,
    status: row.status,
    bucket: row.bucket,
    amount: row.amount.toFixed(2),
    currency: row.currency,
    balanceAfter: row.balanceAfter.toFixed(2),
    reference: row.reference,
    description: row.description,
    postedAt: row.postedAt,
    createdAt: row.createdAt,
  }));

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <main className="mx-auto w-full max-w-6xl flex-1 space-y-6 px-5 py-10">
        <section className="card-glow rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge>Akun aktif</Badge>
                <Badge variant="muted">@{user.username}</Badge>
                {user.referredBy ? (
                  <Badge variant="gold">
                    Rujukan dari @{user.referredBy.username} (tingkat {user.referredBy.level})
                  </Badge>
                ) : null}
              </div>
              <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                Halo, {user.name}
              </h1>
              <p className="max-w-2xl text-sm leading-relaxed text-white/60">
                {program.name} · target imbalan {formatRate(program.weeklyRewardRate)}/minggu, durasi{" "}
                {cycles.map((cycle) => `${cycle.cycleWeeks} minggu (${formatRate(cycle.targetCycleRewardRate)})`).join(", ")}.
                Saldo di bawah dihitung dari buku besar database, bukan angka contoh.
              </p>
            </div>
            <LogoutButton />
          </div>

          {params.welcome ? (
            <Alert variant="success" title="Akun berhasil dibuat" className="mt-5">
              Profil, kode rujukan, dan saldo awal Anda sudah tersimpan di database. Anda dapat
              masuk kembali kapan saja dengan nama pengguna atau surel yang sama.
            </Alert>
          ) : null}
          {params.error === "forbidden" ? (
            <Alert variant="danger" title="Akses ditolak" className="mt-5">
              Halaman tersebut hanya untuk admin.
            </Alert>
          ) : null}

        </section>
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Total saldo"
            value={formatMoney(totalBalance, balance.currency)}
            hint="Tersedia + imbalan menunggu persetujuan"
            icon={CircleDollarSign}
          />
          <StatCard
            label="Program aktif"
            value={String(activePrograms)}
            hint={`${progress.length} keanggotaan tercatat`}
            icon={Layers}
            tone="muted"
          />
          <StatCard
            label="Imbalan saat ini"
            value={formatMoney(rewards.currentReward?.amount ?? 0, balance.currency)}
            hint={
              rewards.currentReward
                ? `Minggu ${rewards.currentReward.period} · ${statusLabel(rewards.currentReward.status)}`
                : "Belum ada periode imbalan tercatat"
            }
            icon={TrendingUp}
            tone="gold"
          />
          <StatCard
            label="Imbalan berikutnya"
            value={formatMoney(rewards.nextReward?.amount ?? 0, balance.currency)}
            hint={
              rewards.nextReward
                ? `${statusLabel(rewards.nextReward.status)} · Minggu ${rewards.nextReward.period}`
                : "Menunggu imbalan berikutnya"
            }
            icon={Hourglass}
            tone="gold"
          />
        </section>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard
            label="Saldo tersedia"
            value={formatMoney(balance.availableAmount, balance.currency)}
            hint="Imbalan yang sudah dibayar"
            icon={CircleDollarSign}
          />
          <StatCard
            label="Menunggu persetujuan"
            value={formatMoney(balance.pendingAmount, balance.currency)}
            hint="Imbalan menunggu + sudah disetujui"
            icon={Hourglass}
            tone="gold"
          />
          <StatCard
            label="Dana program"
            value={formatMoney(balance.programFundsAmount, balance.currency)}
            hint="Dana program tercatat (di luar saldo imbalan)"
            icon={Coins}
            tone="muted"
          />
          <StatCard
            label="Saldo ditahan"
            value={formatMoney(balance.reservedAmount, balance.currency)}
            hint="Diklaim penarikan yang belum selesai"
            icon={ArrowUpFromLine}
            tone="gold"
          />
          <StatCard
            label="Imbalan rujukan"
            value={formatMoney(referralCommissions.byStatus.PAID.total, referralCommissions.currency)}
            hint={`Menunggu ${formatMoney(referralCommissions.byStatus.PENDING.total, referralCommissions.currency)} · disetujui ${formatMoney(referralCommissions.byStatus.APPROVED.total, referralCommissions.currency)}`}
            icon={Users}
            tone="gold"
          />
          <StatCard
            label="Total diperoleh"
            value={formatMoney(balance.totalEarned, balance.currency)}
            hint={`Pembalikan tercatat: ${formatMoney(balance.totalReversed, balance.currency)}`}
            icon={Users}
          />
        </section>

        <section className="flex flex-wrap gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <Button asChild variant="gold" size="sm">
            <Link href="/deposit">
              <ArrowDownToLine aria-hidden />
              Setor dana manual
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/withdrawal">
              <ArrowUpFromLine aria-hidden />
              Penarikan dana
            </Link>
          </Button>
          {user.role === "ADMIN" ? (
            <Button asChild variant="ghost" size="sm">
              <Link href="/admin">
                <ShieldCheck aria-hidden />
                Panel admin
              </Link>
            </Button>
          ) : null}
          <WhatsAppCustomerServiceButton
            href={customerService.link}
            location="dasbor"
            fallback={customerService.fallback}
            size="sm"
            variant="ghost"
          />
          <p className="w-full text-xs leading-relaxed text-white/45 sm:w-auto sm:flex-1">
            Setoran dan penarikan diproses manual oleh admin: tidak ada payment gateway atau
            transfer otomatis. Penarikan dikenakan biaya 10% dari nominal yang diajukan;
            Anda menerima 90%. Dana ditahan saat pengajuan dan dikembalikan jika ditolak.
          </p>
        </section>

        <RebateRates rows={rebateRows} />

        <ProgramProgress programs={progress} />

        <TransactionHistory transactions={transactionRows} />

        <section className="grid gap-6 lg:grid-cols-2">
          <JoinProgramPanel
            tiers={tiers.map((tier) => ({
              id: tier.id,
              code: tier.code,
              name: tier.name,
              joinAmount: tier.joinAmount.toFixed(2),
              currency: tier.currency,
            }))}
            cycles={cycles.map((cycle) => ({
              id: cycle.id,
              cycleWeeks: cycle.cycleWeeks,
              weeklyRewardRate: cycle.weeklyRewardRate.toFixed(4),
              targetCycleRewardRate: cycle.targetCycleRewardRate.toFixed(4),
            }))}
          />

          <ReferralPanel
            referralCode={user.referralCode}
            directReferrals={referral.directReferrals}
            totalNetwork={referral.totalNetwork}
            levels={referralLevels}
          />
        </section>

        <NetworkTree network={network} levels={referralLevels} />

        <Alert variant="info" title="Catatan penting">
          {program.rewardTerms} Pembayaran gabung dilakukan di luar website ini: sistem mencatat
          dana yang masuk setelah dikonfirmasi admin, lalu menghitung target imbalan sesuai
          ketentuan program.
        </Alert>
      </main>

      <SiteFooter />
    </div>
  );
}

