import { Prisma } from "@prisma/client";

/**
 * Money / percentage helpers.
 *
 * Every monetary and rate value in Tatorprofit is stored and computed with
 * `Prisma.Decimal` (PostgreSQL `numeric`). JavaScript floating point numbers are
 * never used for money math — values are converted to `Decimal` first. All
 * amounts are denominated in USDT.
 */

export type DecimalInput = string | number | Prisma.Decimal;

export const MONEY_SCALE = 2;
export const RATE_SCALE = 4;

/**
 * Tatorprofit displays every amount in USDT with Indonesian number formatting
 * (`1.000,00 USDT`). `Intl` currency style cannot be used because "USDT" is not
 * an ISO 4217 code (exactly three letters) and would throw `RangeError`.
 */
export const DISPLAY_CURRENCY = "USDT";
export const DISPLAY_LOCALE = "id-ID";

/**
 * Unit codes that were *renamed* to USDT when the platform moved off its
 * pre-USDT label. The ledger is append-only at database level, so historical
 * rows keep their original `currency` string and are never rewritten; they are
 * still presented in the platform currency because the change was a rename of
 * the unit, not a conversion.
 *
 * Lookup is case-insensitive and the platform currency is canonicalised to
 * `USDT`. Unknown codes are returned unchanged so no value is ever silently
 * relabelled.
 */
const CURRENCY_DISPLAY_CODES: Readonly<Record<string, string>> = {
  USD: DISPLAY_CURRENCY,
  USDT: DISPLAY_CURRENCY,
};

/** Maps a stored currency code to the code shown to users. */
export function displayCurrency(currency?: string | null): string {
  if (!currency) return DISPLAY_CURRENCY;
  return CURRENCY_DISPLAY_CODES[currency.toUpperCase()] ?? currency;
}

/**
 * Display-only alias for the pre-USDT unit inside free text — for example a
 * historical ledger description that embeds the old tier code (`USD-100`).
 * Those strings are part of the append-only ledger and are never rewritten in
 * the database, so the legacy token is normalised only when shown to users.
 * A real `USDT` token is left untouched.
 */
export function displayLegacyCurrencyText(text: string): string {
  return text.replace(/USD(?!T)/g, DISPLAY_CURRENCY);
}

/** Converts any supported input into a `Prisma.Decimal`. */
export function toDecimal(value: DecimalInput): Prisma.Decimal {
  if (value instanceof Prisma.Decimal) return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new RangeError("Tidak dapat mengubah nilai non-finite menjadi Decimal");
    }
    // `toString()` keeps the shortest exact representation of the JS number.
    return new Prisma.Decimal(value.toString());
  }
  return new Prisma.Decimal(value);
}

/** Rounds a money value to 2 decimal places (half up). */
export function roundMoney(value: DecimalInput): Prisma.Decimal {
  return toDecimal(value).toDecimalPlaces(MONEY_SCALE, Prisma.Decimal.ROUND_HALF_UP);
}

/** Rounds a percentage/rate value to 4 decimal places (half up). */
export function roundRate(value: DecimalInput): Prisma.Decimal {
  return toDecimal(value).toDecimalPlaces(RATE_SCALE, Prisma.Decimal.ROUND_HALF_UP);
}

/** `amount * rate`, rounded to 2 decimals. Used for reward targets and commissions. */
export function multiplyByRate(amount: DecimalInput, rate: DecimalInput): Prisma.Decimal {
  return roundMoney(toDecimal(amount).times(toDecimal(rate)));
}

/** Sum of money values, rounded to 2 decimals. */
export function sumMoney(values: DecimalInput[]): Prisma.Decimal {
  return values.reduce<Prisma.Decimal>((total, value) => total.plus(toDecimal(value)), new Prisma.Decimal(0));
}

export function isNegative(value: DecimalInput): boolean {
  return toDecimal(value).isNegative();
}

export function isZero(value: DecimalInput): boolean {
  return toDecimal(value).isZero();
}

export function moneyEquals(a: DecimalInput, b: DecimalInput): boolean {
  return toDecimal(a).equals(toDecimal(b));
}

/** Serializes a decimal for JSON transport without losing precision. */
export function decimalToString(value: DecimalInput): string {
  return roundMoney(value).toFixed(MONEY_SCALE);
}

export function rateToString(value: DecimalInput): string {
  return roundRate(value).toFixed(RATE_SCALE);
}

/**
 * Formats a decimal as a display string, e.g. `1.000,00 USDT`.
 * The currency code is always rendered as a suffix so no `$` ever appears.
 * A stored legacy code (pre-USDT) is normalised by `displayCurrency`, so the UI
 * never shows a currency the platform no longer uses.
 */
export function formatMoney(
  value: DecimalInput,
  currency = DISPLAY_CURRENCY,
  locale = DISPLAY_LOCALE,
): string {
  const amount = new Intl.NumberFormat(locale, {
    minimumFractionDigits: MONEY_SCALE,
    maximumFractionDigits: MONEY_SCALE,
  }).format(toDecimal(value).toNumber());
  return `${amount} ${displayCurrency(currency)}`;
}

/** Formats a rate (0.1) as a percentage string (`10%`). */
export function formatRate(rate: DecimalInput, locale = DISPLAY_LOCALE): string {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    minimumFractionDigits: 0,
    maximumFractionDigits: RATE_SCALE - 2,
  }).format(toDecimal(rate).toNumber());
}

export const MAX_MONEY = new Prisma.Decimal("9999999999999999.99");
