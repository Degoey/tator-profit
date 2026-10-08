import { Prisma, type ProgramStatus } from "@prisma/client";

/**
 * Central program configuration (Bagian 5).
 *
 * These constants are the single source of truth for:
 *  - the seed / admin-configurable database rows (`Program`, `ProgramTier`, `ProgramCycle`)
 *  - runtime fallbacks when the database is unreachable
 *
 * The whole platform is denominated in **USDT**. Nine join amounts x three
 * durations (4 / 8 / 12 weeks) are the 27 selectable program combinations; they
 * are generated from `PROGRAM_TIER_AMOUNTS` x `PROGRAM_CYCLE_WEEKS` instead of
 * being written out one by one.
 *
 * Every monetary and percentage value is a `Prisma.Decimal` (PostgreSQL numeric):
 * JavaScript floating point is never used for money or reward math.
 */

/** Tatorprofit only ever prices in USDT. */
export const PROGRAM_CURRENCY = "USDT";

export const DEFAULT_PROGRAM_CODE = "TATORPROFIT-REWARD";
export const DEFAULT_PROGRAM_NAME = "Program Target Imbalan Tatorprofit";

/** 10% target reward per week. */
export const DEFAULT_WEEKLY_REWARD_RATE = new Prisma.Decimal("0.1000");
/** Default (and shortest) cycle: 4 weeks. */
export const DEFAULT_CYCLE_WEEKS = 4;
/** 40% target reward for the default 4-week cycle. */
export const DEFAULT_MAX_CYCLE_REWARD_RATE = new Prisma.Decimal("0.4000");

export const PROGRAM_REWARD_TERMS =
  "Target imbalan mengikuti ketentuan program (target 10% per minggu, durasi 4, 8, atau 12 minggu, " +
  "target siklus 40%, 80%, atau 120%). Target imbalan bukan jaminan hasil: pencairan mengikuti " +
  "kualifikasi, status keanggotaan, dan aturan program yang berlaku.";

/** The nine join amounts of the Tatorprofit reward program (USDT). */
export const PROGRAM_TIER_AMOUNTS = [
  "10",
  "25",
  "50",
  "100",
  "500",
  "1000",
  "3000",
  "5000",
  "10000",
] as const;

export type ProgramTierAmount = (typeof PROGRAM_TIER_AMOUNTS)[number];

/** The three selectable program durations, in weeks. */
export const PROGRAM_CYCLE_WEEKS = [4, 8, 12] as const;

export type ProgramCycleWeeks = (typeof PROGRAM_CYCLE_WEEKS)[number];

export interface ProgramTierDefinition {
  code: string;
  name: string;
  joinAmount: Prisma.Decimal;
  sortOrder: number;
}

function tierCode(amount: string): string {
  return `${PROGRAM_CURRENCY}-${amount}`;
}

/** Tier rows seeded into the database; admin can change amounts later. */
export const PROGRAM_TIER_DEFINITIONS: readonly ProgramTierDefinition[] =
  PROGRAM_TIER_AMOUNTS.map((amount, index) => ({
    code: tierCode(amount),
    name: `Paket ${PROGRAM_CURRENCY} ${new Prisma.Decimal(amount).toFixed(0)}`,
    joinAmount: new Prisma.Decimal(amount).toDecimalPlaces(2),
    sortOrder: index + 1,
  }));

/**
 * `targetCycleRewardRate = weeklyRewardRate * cycleWeeks`, rounded to 4 decimals
 * with decimal arithmetic (10% x 4 = 40%, x 8 = 80%, x 12 = 120%).
 */
export function cycleRewardRate(
  weeklyRewardRate: Prisma.Decimal,
  cycleWeeks: number,
): Prisma.Decimal {
  if (!Number.isInteger(cycleWeeks) || cycleWeeks < 1) {
    throw new RangeError("Durasi siklus harus berupa jumlah minggu bulat minimal 1.");
  }
  return weeklyRewardRate
    .times(cycleWeeks)
    .toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
}

export interface ProgramCycleDefinition {
  cycleWeeks: number;
  weeklyRewardRate: Prisma.Decimal;
  targetCycleRewardRate: Prisma.Decimal;
}

/** Cycle rows seeded into the database (4, 8, 12 weeks). */
export const PROGRAM_CYCLE_DEFINITIONS: readonly ProgramCycleDefinition[] =
  PROGRAM_CYCLE_WEEKS.map((cycleWeeks) => ({
    cycleWeeks,
    weeklyRewardRate: DEFAULT_WEEKLY_REWARD_RATE,
    targetCycleRewardRate: cycleRewardRate(DEFAULT_WEEKLY_REWARD_RATE, cycleWeeks),
  }));

/** 9 join amounts x 3 durations = 27 program combinations. */
export const PROGRAM_COMBINATION_COUNT =
  PROGRAM_TIER_AMOUNTS.length * PROGRAM_CYCLE_WEEKS.length;

export interface ProgramCycleConfig {
  id: string;
  cycleWeeks: number;
  weeklyRewardRate: Prisma.Decimal;
  /** Snapshot of `weeklyRewardRate * cycleWeeks` stored in the database. */
  targetCycleRewardRate: Prisma.Decimal;
}

export interface ProgramConfig {
  code: string;
  name: string;
  currency: string;
  weeklyRewardRate: Prisma.Decimal;
  cycleWeeks: number;
  maxCycleRewardRate: Prisma.Decimal;
  rewardTerms: string;
  /** ACTIVE / INACTIVE / ARCHIVED, mirrored from the database row. */
  status: ProgramStatus;
  /** Selectable durations of this program (4 / 8 / 12 weeks). */
  cycles: ProgramCycleConfig[];
}

function fallbackCycles(): ProgramCycleConfig[] {
  return PROGRAM_CYCLE_DEFINITIONS.map((cycle) => ({
    id: `fallback:cycle:${cycle.cycleWeeks}`,
    cycleWeeks: cycle.cycleWeeks,
    weeklyRewardRate: cycle.weeklyRewardRate,
    targetCycleRewardRate: cycle.targetCycleRewardRate,
  }));
}

export const FALLBACK_PROGRAM_CONFIG: ProgramConfig = {
  code: DEFAULT_PROGRAM_CODE,
  name: DEFAULT_PROGRAM_NAME,
  currency: PROGRAM_CURRENCY,
  weeklyRewardRate: DEFAULT_WEEKLY_REWARD_RATE,
  cycleWeeks: DEFAULT_CYCLE_WEEKS,
  maxCycleRewardRate: DEFAULT_MAX_CYCLE_REWARD_RATE,
  rewardTerms: PROGRAM_REWARD_TERMS,
  status: "ACTIVE",
  cycles: fallbackCycles(),
};

export interface ProgramTierConfig {
  id: string;
  code: string;
  name: string;
  joinAmount: Prisma.Decimal;
  currency: string;
  sortOrder: number;
}

/**
 * Weekly reward target for a join amount: `joinAmount * weeklyRewardRate`.
 * Returns an exact decimal rounded to 2 places — never a float.
 */
export function weeklyRewardTarget(
  joinAmount: Prisma.Decimal,
  weeklyRewardRate: Prisma.Decimal,
): Prisma.Decimal {
  return joinAmount.times(weeklyRewardRate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/** Total reward target for one cycle: weekly target * cycleWeeks. */
export function cycleRewardTarget(
  joinAmount: Prisma.Decimal,
  weeklyRewardRate: Prisma.Decimal,
  cycleWeeks: number,
): Prisma.Decimal {
  return weeklyRewardTarget(joinAmount, weeklyRewardRate).times(cycleWeeks).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}
