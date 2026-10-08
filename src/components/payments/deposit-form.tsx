"use client";

import { FileUp, Loader2, Send, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { FormField } from "@/components/auth/form-field";
import {
  DEPOSIT_METHODS,
  PAYMENT_REFERENCE_MAX,
  PROOF_ACCEPT,
  PROOF_MAX_BYTES,
  PROOF_MAX_MB,
} from "@/components/payments/options";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

export interface PendingMembershipOption {
  id: string;
  tierName: string;
  tierCode: string;
  programName: string;
  joinAmount: string;
  currency: string;
  /** Duration of the selected program combination: 4, 8 or 12 weeks. */
  cycleWeeks: number;
}

export interface DepositFormProps {
  memberships: PendingMembershipOption[];
  currency: string;
  /** True when the member has PENDING memberships, but all already have an open deposit. */
  allBlocked?: boolean;
}

interface ApiPayload {
  ok: boolean;
  code?: string;
  message?: string;
  fieldErrors?: Record<string, string>;
  data?: { id?: string; status?: string; amount?: string };
}

/**
 * Deposit submission.
 *
 * The amount is never typed by the member: it is the exact `joinAmount` of the
 * selected PENDING membership, rendered read-only and sent verbatim. The proof
 * upload is bounded client side as well as server side.
 */
export function DepositForm({ memberships, currency, allBlocked = false }: DepositFormProps) {
  const router = useRouter();
  const [membershipId, setMembershipId] = React.useState(memberships[0]?.id ?? "");
  const [method, setMethod] = React.useState(DEPOSIT_METHODS[0]?.value ?? "BANK_TRANSFER");
  const [reference, setReference] = React.useState("");
  const [proof, setProof] = React.useState<File | null>(null);
  const [fileError, setFileError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [message, setMessage] = React.useState<string | null>(null);
  const proofInputRef = React.useRef<HTMLInputElement | null>(null);

  const selected = memberships.find((item) => item.id === membershipId) ?? memberships[0];

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setFileError(null);
    if (file && file.size > PROOF_MAX_BYTES) {
      setFileError(`Ukuran bukti maksimal ${PROOF_MAX_MB} MB.`);
      setProof(null);
      event.target.value = "";
      return;
    }
    setProof(file);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;

    setPending(true);
    setError(null);
    setMessage(null);
    setFieldErrors({});

    const body = new FormData();
    body.set("userProgramId", selected.id);
    body.set("amount", selected.joinAmount);
    body.set("paymentMethod", method);
    body.set("paymentReference", reference);
    if (proof) body.set("proof", proof);

    try {
      const response = await fetch("/api/deposits", { method: "POST", body });
      const payload = (await response.json()) as ApiPayload;

      if (!response.ok || !payload.ok) {
        setError(payload.message ?? "Deposit tidak dapat dikirim saat ini.");
        setFieldErrors(payload.fieldErrors ?? {});
        return;
      }

      setMessage(
        `Deposit ${formatMoney(payload.data?.amount ?? selected.joinAmount, currency)} untuk ` +
          `${selected.tierCode} tercatat dengan status sedang ditinjau. Admin akan memverifikasi bukti transfer Anda.`,
      );
      setReference("");
      setProof(null);
      if (proofInputRef.current) proofInputRef.current.value = "";
      router.refresh();
    } catch {
      setError("Gangguan jaringan. Silakan coba lagi.");
    } finally {
      setPending(false);
    }
  }

  if (memberships.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-[var(--color-neon)]" aria-hidden />
            {allBlocked ? "Semua deposit masih berjalan" : "Belum ada keanggotaan menunggu"}
          </CardTitle>
          <CardDescription>
            {allBlocked
              ? "Setiap keanggotaan menunggu Anda sudah memiliki deposit yang sedang ditinjau. Satu keanggotaan hanya dapat memiliki satu deposit terbuka."
              : "Deposit hanya dapat dikirim untuk keanggotaan program berstatus menunggu. Gabung paket terlebih dahulu di halaman program."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/programs">Buka halaman program</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }


  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileUp className="size-4 text-[var(--color-neon)]" aria-hidden />
          Kirim bukti deposit
        </CardTitle>
        <CardDescription>
          Pilih keanggotaan, unggah bukti transfer, lalu tunggu verifikasi admin. Nilai deposit
          terkunci pada nilai gabung paket — tidak dapat diubah dari halaman ini.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {error ? (
          <Alert variant="danger" title="Deposit gagal dikirim">
            {error}
          </Alert>
        ) : null}
        {message ? (
          <Alert variant="success" title="Deposit terkirim">
            {message}
          </Alert>
        ) : null}

        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
          <fieldset className="space-y-3">
            <legend className="text-xs font-semibold uppercase tracking-[0.14em] text-white/60">
              Keanggotaan menunggu pembayaran
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {memberships.map((item) => {
                const active = item.id === membershipId;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setMembershipId(item.id)}
                    aria-pressed={active}
                    className={cn(
                      "rounded-xl border p-3.5 text-left transition-colors",
                      active
                        ? "border-[var(--color-neon)]/60 bg-[var(--color-neon)]/10"
                        : "border-white/10 bg-white/[0.02] hover:border-white/25",
                    )}
                  >
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-white">
                      {item.tierCode}
                      <Badge variant="muted">{item.programName}</Badge>
                    </p>
                    <p className="mt-1 text-xs text-white/45">{item.tierName}</p>
                    <p className="mt-1 text-xs text-white/55">
                      Durasi {item.cycleWeeks} minggu · target{" "}
                      {item.cycleWeeks === 4 ? "40%" : item.cycleWeeks === 8 ? "80%" : "120%"} per
                      siklus
                    </p>
                    <p className="mt-1.5 text-sm font-semibold text-[var(--color-gold)]">
                      {formatMoney(item.joinAmount, item.currency)}
                    </p>
                  </button>
                );
              })}
            </div>
          </fieldset>



          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label="Nilai deposit (terkunci)"
              htmlFor="deposit-amount"
              hint="Sesuai nilai gabung paket yang dipilih."
              error={fieldErrors.amount}
            >
              <Input
                id="deposit-amount"
                name="amount"
                value={selected ? formatMoney(selected.joinAmount, selected.currency) : ""}
                readOnly
                aria-readonly
                className="font-semibold text-[var(--color-gold)]"
              />
            </FormField>

            <FormField
              label="Metode pembayaran"
              htmlFor="deposit-method"
              error={fieldErrors.paymentMethod}
            >
              <select
                id="deposit-method"
                name="paymentMethod"
                value={method}
                onChange={(event) => setMethod(event.target.value)}
                className="h-11 w-full rounded-xl border border-white/12 bg-white/[0.04] px-3 text-sm text-white focus-visible:border-[var(--color-neon)]/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-neon)]/25"
              >
                {DEPOSIT_METHODS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </FormField>
          </div>

          <FormField
            label="Referensi pembayaran (opsional)"
            htmlFor="deposit-reference"
            hint="Nomor transaksi / berita acara transfer agar admin mudah mencocokkan."
            error={fieldErrors.paymentReference}
          >
            <Input
              id="deposit-reference"
              name="paymentReference"
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              maxLength={PAYMENT_REFERENCE_MAX}
              placeholder="TRX-2026-000123"
            />
          </FormField>

          <FormField
            label="Bukti transfer (wajib)"
            htmlFor="deposit-proof"
            hint={`PNG, JPG atau PDF. Maksimal ${PROOF_MAX_MB} MB. File disimpan privat.`}
            error={fileError ?? fieldErrors.proof}
          >
            <Input
              id="deposit-proof"
              name="proof"
              ref={proofInputRef}
              type="file"
              accept={PROOF_ACCEPT}
              onChange={handleFileChange}
              required
              className="h-auto py-2 file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white"
            />
          </FormField>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={pending || !selected || !proof}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}
              {pending ? "Mengirim..." : "Kirim deposit"}
            </Button>
            <Badge variant="muted">Status awal: sedang ditinjau</Badge>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
