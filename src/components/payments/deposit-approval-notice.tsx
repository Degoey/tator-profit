"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DISPLAY_CURRENCY, displayCurrency, formatMoney, toDecimal } from "@/lib/money";

export interface DepositApprovalNoticeProps {
  /** Unread notification that announced the approval. */
  notificationId: string;
  /** Formatted amount from the notification metadata, or `null` for older rows. */
  amount: string | null;
  currency: string | null;
}

/**
 * Success banner for the deposit an administrator has just approved.
 *
 * It is shown while the announcement notification is still unread, so the member
 * sees the outcome on the page the notification links to. Dismissing it marks
 * that single notification as read through `PATCH /api/notifications` — the same
 * endpoint the inbox uses, scoped to the session user — and the banner is gone on
 * the next load because the row is no longer unread.
 */
export function DepositApprovalNotice({ notificationId, amount, currency }: DepositApprovalNoticeProps) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [dismissed, setDismissed] = React.useState(false);

  const amountText =
    amount === null
      ? null
      : formatMoney(toDecimal(amount), displayCurrency(currency ?? DISPLAY_CURRENCY));

  async function dismiss() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: notificationId }),
      });
      const payload = (await response.json()) as { ok: boolean; message?: string };
      if (!response.ok || !payload.ok) {
        setError(payload.message ?? "Pemberitahuan tidak dapat ditandai terbaca saat ini.");
        return;
      }
      setDismissed(true);
      router.refresh();
    } catch {
      setError("Gangguan jaringan. Silakan coba lagi.");
    } finally {
      setPending(false);
    }
  }

  if (dismissed) return null;

  return (
    <div className="space-y-2">
      <Alert variant="success" title="Deposit terakhir disetujui">
        <div className="space-y-2">
          <p>
            {amountText ? (
              <>
                Deposit sebesar <strong>{amountText}</strong> sudah dikonfirmasi admin dan tercatat
                di saldo deposit Anda.
              </>
            ) : (
              <>Deposit terakhir Anda sudah dikonfirmasi admin dan tercatat di saldo deposit Anda.</>
            )}{" "}
            Keanggotaan terkait diaktifkan dan target imbalannya mulai dievaluasi sesuai ketentuan
            program.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline">
              <a href="#riwayat-deposit">Lihat riwayat deposit</a>
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => void dismiss()}
            >
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Tandai sudah dibaca
            </Button>
          </div>
          {error ? <p className="text-xs text-red-200">{error}</p> : null}
        </div>
      </Alert>
    </div>
  );
}
