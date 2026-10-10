"use client";

import { Loader2, UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

import { FormField } from "@/components/auth/form-field";
import { NoPrefillInput } from "@/components/auth/no-prefill-input";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BANK_OPTION_GROUPS } from "@/lib/config/bank-options";

interface FormState {
  name: string;
  username: string;
  email: string;
  phone: string;
  bankAccountNumber: string;
  bank: string;
  password: string;
  confirmPassword: string;
  referralCode: string;
}

export function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [form, setForm] = React.useState<FormState>({
    name: "",
    username: "",
    email: "",
    phone: "",
    bankAccountNumber: "",
    bank: "",
    password: "",
    confirmPassword: "",
    referralCode: searchParams.get("ref")?.toUpperCase() ?? "",
  });
  const [acceptTerms, setAcceptTerms] = React.useState(false);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((previous) => ({ ...previous, [key]: value }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // Bank/E-Wallet wajib dipilih. The form is `noValidate`, so the browser does
    // not block the submit for us; the server re-checks this same rule.
    if (!form.bank) {
      setFieldErrors({ bank: "Silakan pilih Bank/E-Wallet" });
      setFormError(null);
      return;
    }

    setPending(true);
    setFieldErrors({});
    setFormError(null);

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, acceptTerms }),
      });

      const payload = (await response.json()) as {
        ok: boolean;
        message?: string;
        fieldErrors?: Record<string, string>;
      };

      if (!response.ok || !payload.ok) {
        setFieldErrors(payload.fieldErrors ?? {});
        setFormError(payload.message ?? "Pendaftaran gagal. Periksa kembali data Anda.");
        return;
      }

      router.push("/dashboard?welcome=1");
      router.refresh();
    } catch {
      setFormError("Gangguan jaringan. Silakan coba lagi.");
    } finally {
      setPending(false);
    }
  }

  return (
    // The personal fields use `NoPrefillInput` because `autoComplete="off"` is
    // ignored by Chrome/Edge, which would leave the visitor's saved name sitting
    // in "Nama lengkap" before they type anything. The account has to be created
    // with data the user actually typed; the server validates it all again anyway
    // (`registerSchema`).
    <form onSubmit={handleSubmit} className="space-y-5" autoComplete="off" noValidate>
      {formError ? (
        <Alert variant="danger" title="Pendaftaran gagal">
          {formError}
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Nama lengkap" error={fieldErrors.name} htmlFor="name">
          <NoPrefillInput
            id="name"
            name="name"
            autoComplete="off"
            placeholder="Nama lengkap Anda"
            value={form.name}
            onChange={(event) => update("name", event.target.value)}
            aria-invalid={Boolean(fieldErrors.name)}
            required
          />
        </FormField>

        <FormField label="Nama pengguna" error={fieldErrors.username} htmlFor="username">
          <NoPrefillInput
            id="username"
            name="username"
            autoComplete="off"
            placeholder="nama_pengguna"
            value={form.username}
            onChange={(event) => update("username", event.target.value.toLowerCase())}
            aria-invalid={Boolean(fieldErrors.username)}
            required
          />
        </FormField>

        <FormField label="Surel" error={fieldErrors.email} htmlFor="email">
          <NoPrefillInput
            id="email"
            name="email"
            type="email"
            autoComplete="off"
            placeholder="anda@contoh.com"
            value={form.email}
            onChange={(event) => update("email", event.target.value)}
            aria-invalid={Boolean(fieldErrors.email)}
            required
          />
        </FormField>

        <FormField label="Nomor telepon" error={fieldErrors.phone} htmlFor="phone">
          <NoPrefillInput
            id="phone"
            name="phone"
            autoComplete="off"
            placeholder="+628123456789"
            value={form.phone}
            onChange={(event) => update("phone", event.target.value)}
            aria-invalid={Boolean(fieldErrors.phone)}
            required
          />
        </FormField>

        <FormField
          label="Bank/E-Wallet"
          error={fieldErrors.bank}
          htmlFor="bank"
          hint="Pilih bank atau e-wallet yang Anda gunakan untuk pembayaran."
        >
          {/* Native select (like the payment forms) so the grouping renders as
              real <optgroup> rows on every browser. The value is a stable code;
              the server re-validates it against `BANK_VALUES`. */}
          <select
            id="bank"
            name="bank"
            value={form.bank}
            onChange={(event) => update("bank", event.target.value)}
            aria-invalid={Boolean(fieldErrors.bank)}
            required
            className="h-11 w-full rounded-xl border border-white/12 bg-white/[0.04] px-3 text-sm text-white focus-visible:border-[var(--color-neon)]/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-neon)]/25 aria-[invalid=true]:border-red-500/70"
          >
            <option value="" disabled>
              Pilih Bank/E-Wallet
            </option>
            {BANK_OPTION_GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label} className="bg-[#04070a]">
                {group.options.map((option) => (
                  <option key={option.value} value={option.value} className="bg-[#04070a]">
                    {option.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </FormField>

        <FormField
          label="Nomor rekening"
          error={fieldErrors.bankAccountNumber}
          htmlFor="bankAccountNumber"
          hint="Nomor rekening aktif atas nama Anda untuk kebutuhan pembayaran."
        >
          <NoPrefillInput
            id="bankAccountNumber"
            name="bankAccountNumber"
            inputMode="numeric"
            autoComplete="off"
            placeholder="Contoh: 1234567890"
            value={form.bankAccountNumber}
            onChange={(event) => update("bankAccountNumber", event.target.value.replace(/\D/g, ""))}
            aria-invalid={Boolean(fieldErrors.bankAccountNumber)}
            required
          />
        </FormField>

        <FormField label="Kata sandi" error={fieldErrors.password} htmlFor="password">
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            placeholder="Min. 8 karakter, huruf & angka"
            value={form.password}
            onChange={(event) => update("password", event.target.value)}
            aria-invalid={Boolean(fieldErrors.password)}
            required
          />
        </FormField>

        <FormField
          label="Konfirmasi kata sandi"
          error={fieldErrors.confirmPassword}
          htmlFor="confirmPassword"
        >
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            placeholder="Ulangi kata sandi Anda"
            value={form.confirmPassword}
            onChange={(event) => update("confirmPassword", event.target.value)}
            aria-invalid={Boolean(fieldErrors.confirmPassword)}
            required
          />
        </FormField>
      </div>

      <FormField
        label="Kode referral (opsional)"
        error={fieldErrors.referralCode}
        htmlFor="referralCode"
        hint="Jika mendaftar dengan kode referral, hubungan referral dicatat permanen di database."
      >
        <Input
          id="referralCode"
          name="referralCode"
          placeholder="TATORPROFIT-ABC"
          value={form.referralCode}
          onChange={(event) => update("referralCode", event.target.value.toUpperCase())}
          aria-invalid={Boolean(fieldErrors.referralCode)}
        />
      </FormField>

      <label className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3.5 text-sm text-white/70">
        <input
          type="checkbox"
          name="acceptTerms"
          checked={acceptTerms}
          onChange={(event) => setAcceptTerms(event.target.checked)}
          className="mt-0.5 size-4 rounded border-white/25 bg-transparent accent-[var(--color-neon)]"
        />
        <span>
          Saya memahami bahwa reward mengikuti ketentuan program dan bukan jaminan hasil, serta
          menyetujui penyimpanan data akun saya di database Tatorprofit.
        </span>
      </label>
      {fieldErrors.acceptTerms ? (
        <p className="text-xs font-medium text-red-300">{fieldErrors.acceptTerms}</p>
      ) : null}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <UserPlus aria-hidden />}
        {pending ? "Membuat akun..." : "Buat akun"}
      </Button>

      <p className="text-center text-sm text-white/55">
        Sudah punya akun?{" "}
        <Link href="/login" className="font-semibold text-[var(--color-neon)] hover:underline">
          Masuk di sini
        </Link>
      </p>
    </form>
  );
}
