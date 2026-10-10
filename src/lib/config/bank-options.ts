/**
 * Central "Bank/E-Wallet" catalogue for the sign-up form.
 *
 * The stored value is a stable, uppercase code (never the display label), so the
 * database stays language-neutral and a label can be reworded without a data
 * migration. The labels are the Indonesian brand names members expect to see in
 * the dropdown. The list is grouped (BUMN / Swasta / E-Wallet) and rendered with
 * native `<optgroup>` elements.
 *
 * `BANK_VALUES` is a literal tuple so it can drive the Zod enum in
 * `src/lib/validation.ts` while staying the single source of truth for both the
 * server and the form.
 */
export const BANK_VALUES = [
  "MANDIRI",
  "BRI",
  "BNI",
  "BTN",
  "BSI",
  "BCA",
  "DANA",
  "GOPAY",
  "SHOPEEPAY",
  "OVO",
  "LINKAJA",
] as const;

export type BankValue = (typeof BANK_VALUES)[number];

export interface BankOption {
  value: BankValue;
  label: string;
}

export interface BankOptionGroup {
  label: string;
  options: BankOption[];
}

/** Grouped options rendered as `<optgroup>` in the sign-up dropdown. */
export const BANK_OPTION_GROUPS: BankOptionGroup[] = [
  {
    label: "Bank BUMN",
    options: [
      { value: "MANDIRI", label: "Bank Mandiri" },
      { value: "BRI", label: "BRI" },
      { value: "BNI", label: "BNI" },
      { value: "BTN", label: "BTN" },
      { value: "BSI", label: "BSI" },
    ],
  },
  {
    label: "Bank Swasta",
    options: [{ value: "BCA", label: "BCA" }],
  },
  {
    label: "E-Wallet",
    options: [
      { value: "DANA", label: "DANA" },
      { value: "GOPAY", label: "GoPay" },
      { value: "SHOPEEPAY", label: "ShopeePay" },
      { value: "OVO", label: "OVO" },
      { value: "LINKAJA", label: "LinkAja" },
    ],
  },
];

/** Flattened list of every selectable option, in display order. */
export const BANK_OPTIONS: BankOption[] = BANK_OPTION_GROUPS.flatMap((group) => group.options);

/** Human-readable label for a stored code, falling back to the raw value. */
export function bankLabel(value: string | null | undefined): string {
  if (!value) return "";
  return BANK_OPTIONS.find((option) => option.value === value)?.label ?? value;
}
