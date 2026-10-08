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
  { value: "CRYPTO", label: "Kripto (USDT TRC20)" },
  { value: "OTHER", label: "Metode lain" },
];

export const WITHDRAWAL_METHODS: PaymentOption[] = [
  { value: "BANK_TRANSFER", label: "Transfer bank" },
  { value: "EWALLET", label: "E-wallet (OVO / GoPay / DANA)" },
  { value: "CRYPTO", label: "Kripto (USDT TRC20)" },
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
