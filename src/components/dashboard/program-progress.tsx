import { CalendarClock, Layers, Target } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney, formatRate } from "@/lib/money";
import type { ProgramProgressView } from "@/lib/services/reward-service";
import { statusLabel } from "@/lib/status-labels";

const membershipVariant: Record<string, "default" | "gold" | "muted" | "danger"> = {
  ACTIVE: "default",
  PENDING: "gold",
  COMPLETED: "muted",
  CANCELLED: "danger",
  SUSPENDED: "gold",
};

const rewardVariant: Record<string, "default" | "gold" | "muted" | "danger"> = {
  PENDING: "gold",
  APPROVED: "default",
  PAID: "muted",
  REJECTED: "danger",
  VOID: "danger",
  NOT_RECORDED: "muted",
};

/** Stable, timezone independent formatting for server rendered dates. */
export function formatDashboardDate(value: Date | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeZone: "UTC" }).format(value);
}

/** Week 1..N progress of every membership, straight from the database. */
export function ProgramProgress({ programs }: { programs: ProgramProgressView[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarClock className="size-4 text-[var(--color-neon)]" aria-hidden />
          Progres program
        </CardTitle>
        <CardDescription>
          Tanggal mulai, minggu saat ini, tanggal imbalan berikutnya, imbalan saat ini, target
          imbalan, dan progres siklus. Semua nilai dihitung oleh server memakai desimal.
        </CardDescription>
      </CardHeader>

      <CardContent>
        {programs.length === 0 ? (
          <p className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-6 text-center text-sm text-white/50">
            Belum ada program. Pilih paket di halaman Program untuk mencatat keanggotaan pertama.
          </p>
        ) : (
          <ul className="space-y-4">
            {programs.map((membership) => (
              <li
                key={membership.userProgramId}
                className="rounded-xl border border-white/10 bg-white/[0.02] p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-white">{membership.tierName}</p>
                    <p className="text-xs text-white/45">
                      {membership.tierCode} · gabung{" "}
                      {formatMoney(membership.joinAmount, membership.currency)} · siklus{" "}
                      {membership.cycleNumber} · tarif {formatRate(membership.weeklyRewardRate)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={membershipVariant[membership.status] ?? "muted"}>
                      {statusLabel(membership.status)}
                    </Badge>
                    <Badge variant={membership.eligibility.eligible ? "default" : "muted"}>
                      {membership.eligibility.eligible ? "Memenuhi syarat" : "Menunggu kualifikasi"}
                    </Badge>
                  </div>
                </div>

                <dl className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  <Field label="Tanggal mulai" value={formatDashboardDate(membership.startDate)} />
                  <Field
                    label="Minggu saat ini"
                    value={membership.currentWeek > 0 ? `Minggu ${membership.currentWeek}` : "—"}
                  />
                  <Field
                    label="Tanggal imbalan berikutnya"
                    value={formatDashboardDate(membership.nextRewardDate)}
                  />
                  <Field
                    label="Imbalan saat ini"
                    value={
                      membership.currentReward
                        ? `${formatMoney(membership.currentReward.amount, membership.currency)} (${statusLabel(membership.currentReward.status)})`
                        : "—"
                    }
                  />
                  <Field
                    label="Target imbalan / minggu"
                    value={formatMoney(membership.weeklyTarget, membership.currency)}
                  />
                  <Field
                    label="Target imbalan / siklus"
                    value={formatMoney(membership.cycleTarget, membership.currency)}
                  />
                </dl>

                <div className="mt-4 space-y-2">
                  <div className="flex items-center justify-between text-xs text-white/45">
                    <span>
                      Progres siklus: {membership.weeksCompleted}/{membership.cycleWeeks} minggu
                      selesai
                    </span>
                    <span>{membership.percentComplete}%</span>
                  </div>
                  <div
                    className="h-2 w-full overflow-hidden rounded-full bg-white/10"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={membership.cycleWeeks}
                    aria-valuenow={membership.weeksCompleted}
                    aria-label={`Progres siklus ${membership.tierCode}`}
                  >
                    <div
                      className="h-full rounded-full bg-[var(--color-neon)] transition-all"
                      style={{ width: `${membership.percentComplete}%` }}
                    />
                  </div>
                </div>

                <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {membership.periods.map((period) => (
                    <li
                      key={period.period}
                      className="rounded-lg border border-white/10 bg-white/[0.03] p-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-white">
                          Minggu {period.period}
                        </span>
                        <Badge variant={rewardVariant[period.status] ?? "muted"}>
                          {statusLabel(period.status)}
                        </Badge>
                      </div>
                      <p className="mt-1.5 text-xs text-white/60">
                        {formatMoney(period.amount, membership.currency)}
                      </p>
                      <p className="text-[11px] text-white/40">
                        {formatDashboardDate(period.scheduledFor)}
                      </p>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-4 flex items-center gap-2 text-xs text-white/45">
          <Layers className="size-3.5" aria-hidden />
          Periode imbalan dicatat oleh mesin imbalan sebagai menunggu, lalu disetujui, dan baru
          dibayar ke saldo tersedia setelah aksi eksplisit admin.
        </p>
      </CardContent>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-white/40">
        <Target className="size-3 text-[var(--color-neon)]" aria-hidden />
        {label}
      </dt>
      <dd className="text-sm font-semibold text-white">{value}</dd>
    </div>
  );
}

