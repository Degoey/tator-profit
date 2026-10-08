import { Prisma, type TransactionStatus, type TransactionType } from "@prisma/client";

/**
 * Central referral configuration.
 *
 * depth  = 5
 * level 1 = 10%   level 2 = 2%   level 3 = 1%   level 4 = 1%   level 5 = 1%
 *
 * Commission percentages are applied to the *source* program value recorded on the
 * referral commission row and are always computed with `Prisma.Decimal`.
 */

export const REFERRAL_DEPTH = 5;

/**
 * The single, explicitly configured event that may create referral commissions.
 *
 * Registration never pays: only the posted ledger entry that records the
 * confirmed program funds (`PROGRAM_JOIN` in the `PROGRAM_FUNDS` bucket) of an
 * ACTIVE, funds confirmed membership of an ACTIVE program qualifies. Everything
 * else — the join request (bucket NONE, membership PENDING), rewards, payouts,
 * adjustments — is ignored by the engine.
 */
export interface ReferralEligibleEventConfig {
  /** Ledger transaction types that can trigger commissions. */
  transactionTypes: readonly TransactionType[];
  /** Only entries in this status qualify (posted = committed to the ledger). */
  requiredStatus: TransactionStatus;
  /** Ledger bucket the entry must move. */
  requiredBucket: string;
  /** The entry must belong to a program membership. */
  requiresMembership: boolean;
  /** The membership must be ACTIVE and its funds confirmed. */
  requiresConfirmedFunds: boolean;
  /** The program behind the membership must be ACTIVE. */
  requiresActiveProgram: boolean;
}

export const REFERRAL_ELIGIBLE_EVENT: ReferralEligibleEventConfig = {
  transactionTypes: ["PROGRAM_JOIN"],
  requiredStatus: "POSTED",
  requiredBucket: "PROGRAM_FUNDS",
  requiresMembership: true,
  requiresConfirmedFunds: true,
  requiresActiveProgram: true,
};

/** Commission statuses in their lifecycle order. */
export const REFERRAL_COMMISSION_STATUSES = [
  "PENDING",
  "APPROVED",
  "PAID",
  "REJECTED",
  "VOID",
] as const;

export interface ReferralLevelRate {
  level: number;
  rate: Prisma.Decimal;
  label: string;
}

export const REFERRAL_LEVEL_RATES: readonly ReferralLevelRate[] = [
  { level: 1, rate: new Prisma.Decimal("0.1000"), label: "Rujukan langsung" },
  { level: 2, rate: new Prisma.Decimal("0.0200"), label: "Tingkat 2" },
  { level: 3, rate: new Prisma.Decimal("0.0100"), label: "Tingkat 3" },
  { level: 4, rate: new Prisma.Decimal("0.0100"), label: "Tingkat 4" },
  { level: 5, rate: new Prisma.Decimal("0.0100"), label: "Tingkat 5" },
] as const;

export function referralRateForLevel(level: number): Prisma.Decimal | null {
  const entry = REFERRAL_LEVEL_RATES.find((item) => item.level === level);
  return entry ? entry.rate : null;
}

export function isValidReferralLevel(level: number): boolean {
  return Number.isInteger(level) && level >= 1 && level <= REFERRAL_DEPTH;
}

/** `baseAmount * rate`, rounded to 2 decimals using decimal arithmetic. */
export function calculateCommission(
  baseAmount: Prisma.Decimal,
  level: number,
): Prisma.Decimal | null {
  const rate = referralRateForLevel(level);
  if (!rate) return null;
  return baseAmount.times(rate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/** Normalizes user supplied referral codes for lookup. */
export function normalizeReferralCode(code: string): string {
  return code.trim().toUpperCase();
}

export const REFERRAL_CODE_PATTERN = /^[A-Z0-9-]{4,32}$/;
