"use client";

import { BadgeCheck, Loader2, Search, ShieldAlert, Wallet } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";

import { FormField } from "@/components/auth/form-field";
import { DataTable, type DataTableColumn } from "@/components/payments/data-table";
import { ConfirmDialog } from "@/components/payments/modal";
import { formatPaymentDate } from "@/components/payments/status-badge";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/money";

export interface AdminCreditRow {
  id: string;
  reference: string;
  amount: string;
  currency: string;
  reason: string;
  actorUsername: string | null;
  targetName: string;
  targetUsername: string;
  balanceBefore: string;
  balanceAfter: string;
  creditedAt: Date | string;
}

export interface CreditAccount {
  id: string;
  name: string;
  username: string;
  email: string;
  status: string;
  availableAmount: string;
  currency: string;
}

interface CreditResult {
  id: string;
  amount: string;
  currency: string;
  reference: string;
  balanceBefore: string;
  balanceAfter: string;
  idempotent: boolean;
}

interface ApiPayload {
  ok: boolean;
  code?: string;
  message?: string;
  fieldErrors?: Record<string, string>;
  data?: CreditResult & { account?: CreditAccount };
}

function suggestedReference(): string {
  const now = new Date();
  const stamp = `${now.getFullYear()}${`${now.getMonth() + 1}`.padStart(2, "0")}${`${now.getDate()}`.padStart(2, "0")}`;
  const suffix = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `ADM-${stamp}-${suffix}`;
}

/**
 * Explicit administrator balance credit (Tahap 3).
 *
 * The account is resolved to a User ID before anything can be submitted, the
 * amount, reason and reference are mandatory, and every submission passes through
 * a confirmation dialog that shows the actor, the recipient and the balance
 * before the credit. A role without the `creditBalance` capability sees a
 * read-only notice instead of the form.
 */
export function AdminCreditForm({
  canCredit,
  adminUsername,
  currency,
  rows,
}: {
  canCredit: boolean;
  adminUsername: string;
  currency: string;
  rows: AdminCreditRow[];
}) {
  const router = useRouter();
  const [search, setSearch] = React.useState("");
  const [account, setAccount] = React.useState<CreditAccount | null>(null);
  const [amount, setAmount] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [reference, setReference] = React.useState("");
  const [lookupPending, setLookupPending] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [result, setResult] = React.useState<CreditResult | null>(null);

  async function lookupAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const identifier = search.trim();
    if (!identifier) {
      setError("Masukkan nama pengguna, surel, atau User ID penerima.");
      return;
    }

    setLookupPending(true);
    setError(null);
    setFieldErrors({});
    setResult(null);

    try {
      const response = await fetch(`/api/admin/credits?account=${encodeURIComponent(identifier)}`, {
        headers: { Accept: "application/json" },
      });
      const payload = (await response.json()) as ApiPayload;
      if (!response.ok || !payload.ok || !payload.data?.account) {
        setAccount(null);
        setError(payload.message ?? "Akun penerima tidak ditemukan.");
        return;
      }
      setAccount(payload.data.account);
      // Referensi disarankan saat akun ditemukan; admin tetap dapat mengubahnya.
      setReference((current) => current || suggestedReference());
    } catch {
      setAccount(null);
      setError("Gangguan jaringan saat mencari akun.");
    } finally {
      setLookupPending(false);
    }
  }

  async function submitCredit() {
    if (!account) return;

    setSubmitting(true);
    setError(null);
    setFieldErrors({});

    try {
      const response = await fetch("/api/admin/credits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: account.id,
          amount: amount.trim(),
          reason: reason.trim(),
          reference: reference.trim(),
        }),
      });
      const payload = (await response.json()) as ApiPayload;

      if (!response.ok || !payload.ok || !payload.data) {
        setError(payload.message ?? "Kredit saldo tidak dapat diproses.");
        setFieldErrors(payload.fieldErrors ?? {});
        setConfirming(false);
        return;
      }

      setResult(payload.data);
      setConfirming(false);
      setAccount(null);
      setSearch("");
      setAmount("");
      setReason("");
      setReference(suggestedReference());
      router.refresh();
    } catch {
      setError("Gangguan jaringan. Silakan coba lagi.");
      setConfirming(false);
    } finally {
      setSubmitting(false);
    }
  }

  const columns: DataTableColumn<AdminCreditRow>[] = [
    {
      key: "creditedAt",
      header: "Waktu",
      sortValue: (row) => new Date(row.creditedAt).getTime(),
      render: (row) => <span className="text-white/60">{formatPaymentDate(row.creditedAt)}</span>,
    },
    {
      key: "actor",
      header: "Admin pelaksana",
      sortValue: (row) => row.actorUsername ?? "",
      render: (row) => (
        <span className="text-white/75">{row.actorUsername ? `@${row.actorUsername}` : "Sistem"}</span>
      ),
    },
    {
      key: "target",
      header: "Penerima",
      sortValue: (row) => row.targetUsername,
      render: (row) => (
        <div>
          <p className="font-semibold text-white">{row.targetName}</p>
          <p className="text-[11px] text-white/40">@{row.targetUsername}</p>
        </div>
      ),
    },
    {
      key: "amount",
      header: "Jumlah",
      sortValue: (row) => Number(row.amount),
      render: (row) => (
        <span className="font-semibold text-[var(--color-gold)]">
          {formatMoney(row.amount, row.currency)}
        </span>
      ),
    },
    {
      key: "balance",
      header: "Saldo sebelum → sesudah",
      render: (row) => (
        <span className="font-mono text-[11px] text-white/60">
          {formatMoney(row.balanceBefore, row.currency)} → {formatMoney(row.balanceAfter, row.currency)}
        </span>
      ),
    },
    {
      key: "reference",
      header: "Referensi",
      render: (row) => (
        <div>
          <p className="font-mono text-[11px] text-[var(--color-neon)]">{row.reference}</p>
          <p className="text-[11px] text-white/45">{row.reason}</p>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {result ? (
        <Alert
          variant="success"
          title={result.idempotent ? "Kredit sudah pernah diproses" : "Kredit tercatat"}
        >
          {formatMoney(result.amount, result.currency)} untuk referensi {result.reference}. Saldo
          tersedia: {formatMoney(result.balanceBefore, result.currency)} →{" "}
          {formatMoney(result.balanceAfter, result.currency)}.
          {result.idempotent ? " Tidak ada kredit kedua yang dibuat." : ""}
        </Alert>
      ) : null}

      {error ? (
        <Alert variant="danger" title="Gagal">
          {error}
        </Alert>
      ) : null}

      {canCredit ? (
        <form
          onSubmit={lookupAccount}
          className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.02] p-4"
        >
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[16rem] flex-1">
              <FormField
                label="Akun penerima"
                htmlFor="credit-account"
                hint="Cari dengan nama pengguna, surel, atau User ID. Hasil pencarian menampilkan User ID dan saldo sebelum."
              >
                <Input
                  id="credit-account"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="demo_member"
                  autoComplete="off"
                />
              </FormField>
            </div>
            <Button type="submit" variant="outline" disabled={lookupPending}>
              {lookupPending ? <Loader2 className="animate-spin" aria-hidden /> : <Search aria-hidden />}
              {lookupPending ? "Mencari..." : "Cari akun"}
            </Button>
          </div>

          {account ? (
            <dl className="grid gap-3 rounded-xl border border-[var(--color-neon)]/25 bg-[var(--color-neon)]/[0.06] p-3 sm:grid-cols-2 lg:grid-cols-4">
              <CreditField label="Akun penerima" value={`${account.name} (@${account.username})`} />
              <CreditField label="User ID" value={account.id} mono />
              <CreditField label="Surel" value={account.email} />
              <CreditField
                label="Saldo sebelum"
                value={formatMoney(account.availableAmount, account.currency)}
              />
            </dl>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-3">
            <FormField
              label={`Jumlah (${currency})`}
              htmlFor="credit-amount"
              hint="Maksimal dua desimal, wajib lebih besar dari nol."
              error={fieldErrors.amount}
            >
              <Input
                id="credit-amount"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="100.00"
                autoComplete="off"
              />
            </FormField>

            <FormField
              label="Mata uang"
              htmlFor="credit-currency"
              hint="Semua nominal platform memakai USDT."
            >
              <Input id="credit-currency" value={currency} readOnly aria-readonly />
            </FormField>

            <FormField
              label="Nomor referensi"
              htmlFor="credit-reference"
              hint="Kunci idempotensi: referensi yang sama tidak dikreditkan dua kali."
              error={fieldErrors.reference}
            >
              <div className="flex items-center gap-2">
                <Input
                  id="credit-reference"
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
                  autoComplete="off"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-11 shrink-0"
                  onClick={() => setReference(suggestedReference())}
                >
                  Buat otomatis
                </Button>
              </div>
            </FormField>
          </div>

          <FormField
            label="Alasan kredit"
            htmlFor="credit-reason"
            hint="Tercatat permanen pada ledger dan jejak audit."
            error={fieldErrors.reason}
          >
            <Input
              id="credit-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Saldo awal sesuai keputusan tim keuangan"
              maxLength={200}
            />
          </FormField>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              disabled={!account || submitting}
              onClick={() => {
                setError(null);
                setConfirming(true);
              }}
            >
              <Wallet aria-hidden />
              Kredit saldo
            </Button>
            <Badge variant="muted">Admin pelaksana: @{adminUsername}</Badge>
            {account ? null : <Badge variant="gold">Cari akun penerima terlebih dahulu</Badge>}
          </div>
        </form>
      ) : (
        <Alert variant="warning" title="Tidak berwenang">
          Peran Anda tidak boleh mengubah saldo. Kredit saldo hanya dapat dilakukan oleh SUPER_ADMIN
          atau FINANCE.
        </Alert>
      )}

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        caption="Riwayat kredit saldo administrator"
        searchPlaceholder="Cari penerima, referensi, atau alasan..."
        searchText={(row) =>
          [row.targetName, row.targetUsername, row.reference, row.reason, row.actorUsername ?? ""].join(" ")
        }
        emptyMessage="Belum ada kredit saldo administrator."
      />

      <ConfirmDialog
        open={confirming}
        title="Konfirmasi kredit saldo"
        description="Periksa kembali data berikut. Kredit yang tercatat tidak dapat dihapus, hanya dapat dikoreksi dengan penyesuaian baru."
        confirmLabel="Kredit sekarang"
        pending={submitting}
        onCancel={() => setConfirming(false)}
        onConfirm={submitCredit}
      >
        {account ? (
          <dl className="grid gap-3 sm:grid-cols-2">
            <CreditField label="Akun penerima" value={`${account.name} (@${account.username})`} />
            <CreditField label="User ID" value={account.id} mono />
            <CreditField label="Jumlah" value={formatMoney(amount || "0", currency)} />
            <CreditField label="Mata uang" value={currency} />
            <CreditField
              label="Saldo sebelum"
              value={formatMoney(account.availableAmount, account.currency)}
            />
            <CreditField label="Admin pelaksana" value={`@${adminUsername}`} />
            <CreditField label="Nomor referensi" value={reference} mono />
            <CreditField label="Alasan" value={reason} />
          </dl>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}

function CreditField({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">{label}</p>
      <p className={mono ? "mt-1 break-all font-mono text-xs text-white" : "mt-1 text-sm text-white"}>
        {value}
      </p>
    </div>
  );
}

/** Permission badge for the administrator credit capability. */
export function CreditPermissionNote({ allowed }: { allowed: boolean }) {
  return allowed ? (
    <Badge variant="default">
      <BadgeCheck className="size-3.5" aria-hidden />
      Dapat memberi kredit saldo
    </Badge>
  ) : (
    <Badge variant="muted">
      <ShieldAlert className="size-3.5" aria-hidden />
      Kredit saldo hanya baca
    </Badge>
  );
}

