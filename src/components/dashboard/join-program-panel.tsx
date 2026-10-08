"use client";

import { Loader2, PlusCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";

import { FormField } from "@/components/auth/form-field";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatMoney, formatRate, multiplyByRate } from "@/lib/money";
import { cn } from "@/lib/utils";

export interface JoinTierOption {
  id: string;
  code: string;
  name: string;
  joinAmount: string;
  currency: string;
}

export interface JoinCycleOption {
  id: string;
  cycleWeeks: number;
  /** Weekly rate snapshot of this duration, e.g. "0.1000". */
  weeklyRewardRate: string;
  /** `weeklyRewardRate * cycleWeeks`, e.g. "0.4000" for 4 weeks. */
  targetCycleRewardRate: string;
}

export interface JoinProgramPanelProps {
  tiers: JoinTierOption[];
  /** Selectable durations: 9 amounts x 3 durations = 27 combinations. */
  cycles: JoinCycleOption[];
  defaultReferralCode?: string;
}

export function JoinProgramPanel({
  tiers,
  cycles,
  defaultReferralCode = "",
}: JoinProgramPanelProps) {
  const router = useRouter();
  const [selectedTierId, setSelectedTierId] = React.useState(tiers[0]?.id ?? "");
  const [selectedCycleId, setSelectedCycleId] = React.useState(cycles[0]?.id ?? "");
  const [referralCode, setReferralCode] = React.useState(defaultReferralCode);
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  const selectedTier = tiers.find((tier) => tier.id === selectedTierId) ?? tiers[0];
  const selectedCycle = cycles.find((cycle) => cycle.id === selectedCycleId) ?? cycles[0];
  const weeklyTarget = selectedTier && selectedCycle
    ? multiplyByRate(selectedTier.joinAmount, selectedCycle.weeklyRewardRate)
    : "0";
  const cycleTarget = selectedCycle
    ? multiplyByRate(weeklyTarget, String(selectedCycle.cycleWeeks))
    : "0";

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTierId || !selectedCycleId) return;

    setPending(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch("/api/programs/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tierId: selectedTierId, cycleId: selectedCycleId, referralCode }),
      });

      const payload = (await response.json()) as {
        ok: boolean;
        message?: string;
        data?: { joinAmount: string; weeklyRewardTarget: string; cycleRewardTarget: string; cycleWeeks?: number };
      };

      if (!response.ok || !payload.ok) {
        setError(payload.message ?? "Gabung tidak dapat dicatat saat ini.");
        return;
      }

      setMessage(
        `Gabung ${formatMoney(payload.data?.joinAmount ?? "0")} untuk durasi ` +
          `${payload.data?.cycleWeeks ?? selectedCycle?.cycleWeeks ?? 4} minggu tercatat dengan status menunggu ` +
          `konfirmasi dana. Target imbalan ${formatMoney(payload.data?.weeklyRewardTarget ?? "0")}/minggu (belum dikreditkan).`,
      );
      router.refresh();
    } catch {
      setError("Gangguan jaringan. Silakan coba lagi.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card id="join">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PlusCircle className="size-4 text-[var(--color-neon)]" aria-hidden />
          Gabung paket program
        </CardTitle>
        <CardDescription>
          Pilih nominal gabung dan durasi program (4, 8, atau 12 minggu) dalam USDT. Tanpa gateway
          pembayaran, gabung dicatat sebagai menunggu konfirmasi dan periode imbalan baru dihitung
          setelah admin mengonfirmasi dana masuk — target, bukan jaminan hasil.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {error ? (
          <Alert variant="danger" title="Gabung gagal">
            {error}
          </Alert>
        ) : null}
        {message ? (
          <Alert variant="success" title="Gabung tercatat">
            {message}
          </Alert>
        ) : null}

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {tiers.map((tier) => {
            const active = tier.id === selectedTierId;
            return (
              <button
                key={tier.id}
                type="button"
                onClick={() => setSelectedTierId(tier.id)}
                aria-pressed={active}
                className={cn(
                  "rounded-xl border p-3.5 text-left transition-colors",
                  active
                    ? "border-[var(--color-neon)]/60 bg-[var(--color-neon)]/10"
                    : "border-white/10 bg-white/[0.02] hover:border-white/25",
                )}
              >
                <p className="text-sm font-semibold text-white">
                  {formatMoney(tier.joinAmount, tier.currency)}
                </p>
                <p className="mt-0.5 text-xs text-white/45">{tier.name}</p>
              </button>
            );
          })}
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-white/40">
            Pilih durasi program
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            {cycles.map((cycle) => {
              const active = cycle.id === selectedCycleId;
              return (
                <button
                  key={cycle.id}
                  type="button"
                  onClick={() => setSelectedCycleId(cycle.id)}
                  aria-pressed={active}
                  className={cn(
                    "rounded-xl border p-3 text-left transition-colors",
                    active
                      ? "border-[var(--color-gold)]/60 bg-[var(--color-gold)]/10"
                      : "border-white/10 bg-white/[0.02] hover:border-white/25",
                  )}
                >
                  <p className="text-sm font-semibold text-white">{cycle.cycleWeeks} minggu</p>
                  <p className="mt-0.5 text-xs text-white/45">
                    Target {formatRate(cycle.targetCycleRewardRate)} per siklus
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid gap-4 rounded-xl border border-white/10 bg-white/[0.02] p-4 sm:grid-cols-3">
          <Summary
            label="Nilai gabung"
            value={
              selectedTier ? formatMoney(selectedTier.joinAmount, selectedTier.currency) : "-"
            }
          />
          <Summary
            label={`Target mingguan (${
              selectedCycle ? formatRate(selectedCycle.weeklyRewardRate) : "-"
            })`}
            value={formatMoney(weeklyTarget)}
          />
          <Summary
            label={`Target siklus (${selectedCycle?.cycleWeeks ?? "-"} minggu)`}
            value={formatMoney(cycleTarget)}
            hint={
              selectedCycle
                ? `Target ${formatRate(selectedCycle.targetCycleRewardRate)} per siklus`
                : undefined
            }
          />
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <FormField
            label="Kode rujukan (opsional)"
            htmlFor="join-referral"
            hint="Kosongkan jika tidak menggunakan rujukan."
          >
            <Input
              id="join-referral"
              name="referralCode"
              placeholder="TATORPROFIT-ABC"
              value={referralCode}
              onChange={(event) => setReferralCode(event.target.value.toUpperCase())}
            />
          </FormField>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={pending || !selectedTierId || !selectedCycleId}>
              {pending ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <PlusCircle aria-hidden />
              )}
              {pending ? "Mencatat..." : "Catat gabung"}
            </Button>
            <Badge variant="muted">Status: menunggu konfirmasi</Badge>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function Summary({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/40">{label}</p>
      <p className="mt-1 text-base font-semibold text-white">{value}</p>
      {hint ? <p className="text-xs text-white/40">{hint}</p> : null}
    </div>
  );
}
