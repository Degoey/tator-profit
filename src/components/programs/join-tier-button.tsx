"use client";

import { Loader2, LogIn, PlusCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";
import { statusLabel } from "@/lib/status-labels";

export interface JoinTierButtonProps {
  tierId: string;
  /** Selected duration row (`ProgramCycle`). 9 amounts x 3 durations = 27 combinations. */
  cycleId: string;
  cycleWeeks: number;
  tierCode: string;
  joinAmount: string;
  currency: string;
  authenticated: boolean;
}

/**
 * Records a join for the selected tier.
 * The server stores the membership as PENDING: nothing is paid on this website,
 * an administrator confirms the funds received before the cycle starts.
 */
export function JoinTierButton({
  tierId,
  cycleId,
  cycleWeeks,
  tierCode,
  joinAmount,
  currency,
  authenticated,
}: JoinTierButtonProps) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  if (!authenticated) {
    return (
      <Button asChild variant="outline" className="w-full">
        <Link href="/login?next=/programs">
          <LogIn aria-hidden />
          Masuk untuk gabung
        </Link>
      </Button>
    );
  }

  async function handleJoin() {
    setPending(true);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch("/api/programs/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tierId, cycleId }),
      });
      const payload = (await response.json()) as {
        ok: boolean;
        message?: string;
        data?: { status?: string; weeklyRewardTarget?: string };
      };

      if (!response.ok || !payload.ok) {
        setError(payload.message ?? "Gabung tidak dapat dicatat saat ini.");
        return;
      }

      setMessage(
        `${tierCode} ${formatMoney(joinAmount, currency)} · ${cycleWeeks} minggu tercatat dengan status ` +
          `${statusLabel(payload.data?.status ?? "PENDING")}. Target imbalan ` +
          `${formatMoney(payload.data?.weeklyRewardTarget ?? "0", currency)}/minggu, menunggu konfirmasi dana.`,
      );
      router.refresh();
    } catch {
      setError("Gangguan jaringan. Silakan coba lagi.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button type="button" className="w-full" onClick={handleJoin} disabled={pending}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <PlusCircle aria-hidden />}
        {pending ? "Mencatat gabung..." : "Gabung program"}
      </Button>
      {message ? (
        <p role="status" className="text-xs leading-relaxed text-[var(--color-neon)]">
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs leading-relaxed text-red-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}
