"use client";

import { ArrowUpFromLine, Info, Loader2, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";

import { FormField } from "@/components/auth/form-field";
import { WITHDRAWAL_METHODS, DESTINATION_MAX, NOTES_MAX } from "@/components/payments/options";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatMoney, toDecimal } from "@/lib/money";

export interface WithdrawalFormProps {
  availableAmount: string;
  currency: string;
}

interface ApiPayload {
  ok: boolean;
  code?: string;
  message?: string;
  fieldErrors?: Record<string, string>;
  data?: { id?: string; status?: string; amount?: string };
}

const AMOUNT_PATTERN = /^(0|[1-9]\d{0,15})(\.\d{1,2})?$/;

/**
 * Withdrawal request.
 *
 * The amount is validated against the member's available balance before the
 * request leaves the browser; the server re-validates and reserves the funds.
 */
export function WithdrawalForm({ availableAmount, currency }: WithdrawalFormProps) {
  const router = useRouter();
  const [amount, setAmount] = React.useState("");
  const [method, setMethod] = React.useState(WITHDRAWAL_METHODS[0]?.value ?? "BANK_TRANSFER");
  const [destination, setDestination] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [message, setMessage] = React.useState<string | null>(null);

  const available = toDecimal(availableAmount);
  const exceedsBalance = amount.length > 0 && AMOUNT_PATTERN.test(amount) && toDecimal(amount).greaterThan(available);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setFieldErrors({});

    if (!AMOUNT_PATTERN.test(amount) || toDecimal(amount).lessThanOrEqualTo(0)) {
      setFieldErrors({ amount: "Masukkan nilai penarikan yang valid (maksimal 2 desimal)." });
      return;
    }
    if (exceedsBalance) {
      setFieldErrors({ amount: `Nilai melebihi saldo tersedia ${formatMoney(availableAmount, currency)}.` });
      return;
    }

    void submitRequest();
  }

  async function submitRequest() {
    setPending(true);
    try {
      const response = await fetch("/api/withdrawals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, method, destination, notes }),
      });
      const payload = (await response.json()) as ApiPayload;

      if (!response.ok || !payload.ok) {
        setError(payload.message ?? "Permintaan penarikan tidak dapat dikirim saat ini.");
        setFieldErrors(payload.fieldErrors ?? {});
        return;
      }

      setMessage(
        `Permintaan penarikan ${formatMoney(payload.data?.amount ?? amount, currency)} tercatat ` +
          "dengan status sedang ditinjau. Dana ditahan dari saldo tersedia sampai admin menyelesaikan proses.",
      );
      setAmount("");
      setDestination("");
      setNotes("");
      router.refresh();
    } catch {
      setError("Gangguan jaringan. Silakan coba lagi.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ArrowUpFromLine className="size-4 text-[var(--color-gold)]" aria-hidden />
          Ajukan penarikan
        </CardTitle>
        <CardDescription>
          Penarikan diproses manual oleh admin. Setelah diajukan, dana ditahan dari saldo tersedia
          dan tidak dapat dipakai untuk permintaan lain sampai statusnya selesai atau ditolak.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {error ? (
          <Alert variant="danger" title="Penarikan gagal diajukan">
            {error}
          </Alert>
        ) : null}
        {message ? (
          <Alert variant="success" title="Permintaan tercatat">
            {message}
          </Alert>
        ) : null}

        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">
            Saldo tersedia
          </p>
          <p className="mt-1 text-2xl font-semibold text-[var(--color-neon)]">
            {formatMoney(availableAmount, currency)}
          </p>
          <button
            type="button"
            onClick={() => setAmount(available.toFixed(2))}
            className="mt-2 text-xs font-semibold text-[var(--color-neon)] underline-offset-4 hover:underline"
            disabled={available.lessThanOrEqualTo(0)}
          >
            Gunakan seluruh saldo
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label="Nilai penarikan"
              htmlFor="withdrawal-amount"
              hint={`Maksimal ${formatMoney(availableAmount, currency)}.`}
              error={fieldErrors.amount}
            >
              <Input
                id="withdrawal-amount"
                name="amount"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value.trim())}
                aria-invalid={Boolean(fieldErrors.amount) || exceedsBalance}
                placeholder="100.00"
                required
              />
            </FormField>

            <FormField label="Metode penarikan" htmlFor="withdrawal-method" error={fieldErrors.method}>
              <select
                id="withdrawal-method"
                name="method"
                value={method}
                onChange={(event) => setMethod(event.target.value)}
                className="h-11 w-full rounded-xl border border-white/12 bg-white/[0.04] px-3 text-sm text-white focus-visible:border-[var(--color-neon)]/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-neon)]/25"
              >
                {WITHDRAWAL_METHODS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </FormField>
          </div>

          <FormField
            label="Tujuan penarikan"
            htmlFor="withdrawal-destination"
            hint="Nomor rekening atau alamat e-wallet atas nama Anda sendiri."
            error={fieldErrors.destination}
          >
            <Input
              id="withdrawal-destination"
              name="destination"
              value={destination}
              onChange={(event) => setDestination(event.target.value)}
              maxLength={DESTINATION_MAX}
              placeholder="Bank BCA · 1234567890 · Nama Pemilik"
              required
            />
          </FormField>

          <FormField
            label="Catatan (opsional)"
            htmlFor="withdrawal-notes"
            hint="Informasi tambahan untuk admin."
            error={fieldErrors.notes}
          >
            <textarea
              id="withdrawal-notes"
              name="notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              maxLength={NOTES_MAX}
              rows={3}
              className="w-full rounded-xl border border-white/12 bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder:text-white/35 focus-visible:border-[var(--color-neon)]/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-neon)]/25"
              placeholder="Catatan untuk admin (opsional)"
            />
          </FormField>

          <Alert variant="info" title="Perlu diketahui">
            <span className="flex items-start gap-2">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              Permintaan penarikan tidak otomatis disetujui. Status berubah menjadi disetujui,
              sedang diproses, lalu selesai setelah admin menyelesaikan transfer.
            </span>
          </Alert>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={pending || available.lessThanOrEqualTo(0)}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}
              {pending ? "Mengirim..." : "Ajukan penarikan"}
            </Button>
            <Badge variant="muted">Status awal: sedang ditinjau</Badge>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
