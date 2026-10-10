/**
 * Options shared by the deposit and withdrawal forms.
 * Values are stable English codes; the labels are Indonesian display strings.
 */
export interface PaymentOption {
  value: string;
  label: string;
}

export const DEPOSIT_METHODS: PaymentOption[] = [
  { value: "BANK_TRANSFER", label: "Transfer bank" },
  { value: "EWALLET", label: "E-wallet (OVO / GoPay / DANA)" },
  // Deposit USDT memakai dompet BEP-20 (BNB Smart Chain), bukan TRC20.
  { value: "CRYPTO", label: "Kripto (USDT BEP-20)" },
  { value: "OTHER", label: "Metode lain" },
];

export const WITHDRAWAL_METHODS: PaymentOption[] = [
  { value: "BANK_TRANSFER", label: "Transfer bank" },
  { value: "EWALLET", label: "E-wallet (OVO / GoPay / DANA)" },
  // Pencairan USDT memakai jaringan yang sama dengan deposit: dompet BEP-20
  // (BNB Smart Chain), bukan TRC20. Nilai `CRYPTO` tidak berubah agar riwayat
  // penarikan dan kontrak API tetap kompatibel.
  { value: "CRYPTO", label: "Kripto (USDT BEP-20)" },
  { value: "OTHER", label: "Metode lain" },
];

/** Upload constraints mirrored from the server side proof validation. */
export const PROOF_ACCEPT = "image/png,image/jpeg,application/pdf";
export const PROOF_MAX_BYTES = 5 * 1024 * 1024;
export const PROOF_MAX_MB = PROOF_MAX_BYTES / (1024 * 1024);

export const PAYMENT_REFERENCE_MAX = 200;
export const DESTINATION_MAX = 300;
export const NOTES_MAX = 500;

export function optionLabel(options: PaymentOption[], value: string): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

/**
 * Copy for the "Tujuan penarikan" field of the withdrawal form.
 *
 * A crypto payout lands on the same network as the deposit wallet, so the field
 * must ask for a BEP-20 address (`0x…`, BNB Smart Chain) and warn against a
 * TRON `T…` address: a transfer on the wrong network strands the funds. Bank and
 * e-wallet withdrawals keep the original account wording.
 */
export function withdrawalDestinationGuidance(method: string): {
  hint: string;
  placeholder: string;
} {
  if (method === "CRYPTO") {
    return {
      hint: "Alamat dompet BEP-20 (BNB Smart Chain) atas nama Anda sendiri, diawali 0x. Jangan pakai alamat TRC20/TRON.",
      placeholder: "0x… · alamat dompet BEP-20 (BNB Smart Chain) atas nama Anda",
    };
  }

  return {
    hint: "Nomor rekening atau alamat e-wallet atas nama Anda sendiri.",
    placeholder: "Bank BCA · 1234567890 · Nama Pemilik",
  };
}
