import { Prisma, type UserProgramStatus } from "@prisma/client";

/**
 * Pure reward math — no database access, no side effects.
 *
 * `calculateWeeklyReward()` turns a program amount + weekly rate + eligibility +
 * membership status into a reward *target*. A target is never a balance credit:
 * only an approved reward that is explicitly paid moves the balance.
 */

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface WeeklyRewardInput {
  /** Program amount of the membership (the join amount). */
  amount: Prisma.Decimal;
  /** Weekly rate, e.g. 0.1000 for 10%. */
  weeklyRate: Prisma.Decimal;
  /** Eligibility result from the program rules (funds confirmed, account active...). */
  eligibility: boolean;
  /** Membership status; only ACTIVE memberships accrue rewards. */
  programStatus: UserProgramStatus;
}

export interface WeeklyRewardResult {
  /** `amount * weeklyRate`, rounded to 2 decimals with decimal arithmetic. */
  target: Prisma.Decimal;
  eligible: boolean;
  reason: string;
}

export function calculateWeeklyReward(input: WeeklyRewardInput): WeeklyRewardResult {
  const { amount, weeklyRate, eligibility, programStatus } = input;

  if (!amount.isFinite() || amount.lte(0)) {
    throw new RangeError("Nilai program harus lebih besar dari nol.");
  }
  if (amount.decimalPlaces() > 2) {
    throw new RangeError("Nilai program maksimal dua desimal.");
  }
  if (!weeklyRate.isFinite() || weeklyRate.lt(0) || weeklyRate.gt(1)) {
    throw new RangeError("Rate mingguan harus bernilai antara 0 dan 1.");
  }

  const target = amount.times(weeklyRate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

  if (!eligibility) {
    return { target, eligible: false, reason: "Persyaratan kualifikasi program belum terpenuhi." };
  }
  if (programStatus !== "ACTIVE") {
    return {
      target,
      eligible: false,
      reason: `Keanggotaan berstatus ${programStatus}; reward hanya bertambah pada keanggotaan ACTIVE.`,
    };
  }
  return { target, eligible: true, reason: "Memenuhi syarat untuk periode saat ini." };
}

/** Due date of a reward period (Week 1..N) counted from the cycle start. */
export function rewardDateFor(start: Date, period: number, cycleWeeks: number): Date {
  if (!Number.isInteger(period) || period < 1 || period > cycleWeeks) {
    throw new RangeError(`Periode reward harus antara 1 dan ${cycleWeeks}.`);
  }
  return new Date(start.getTime() + period * WEEK_MS);
}

export interface CycleProgress {
  cycleWeeks: number;
  /** 0 before the first week has elapsed. */
  currentWeek: number;
  elapsedWeeks: number;
  completedWeeks: number;
  percentComplete: number;
}

/** Week counter of a running cycle; both dates are compared in UTC milliseconds. */
export function cycleProgress(
  start: Date | null,
  cycleWeeks: number,
  now: Date = new Date(),
): CycleProgress {
  const elapsed = start
    ? Math.max(0, Math.floor((now.getTime() - start.getTime()) / WEEK_MS))
    : 0;
  const elapsedWeeks = Math.min(cycleWeeks, elapsed);
  return {
    cycleWeeks,
    currentWeek: start ? Math.min(cycleWeeks, elapsed + 1) : 0,
    elapsedWeeks,
    completedWeeks: elapsedWeeks,
    percentComplete: cycleWeeks === 0 ? 0 : Math.round((elapsedWeeks / cycleWeeks) * 100),
  };
}

/** Cycle target: weekly target * cycle weeks (never more than the configured cap). */
export function cycleRewardTarget(
  weeklyTarget: Prisma.Decimal,
  cycleWeeks: number,
  maxCycleRewardRate: Prisma.Decimal,
  amount: Prisma.Decimal,
): Prisma.Decimal {
  const target = weeklyTarget.times(cycleWeeks).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const cap = amount.times(maxCycleRewardRate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  return target.greaterThan(cap) ? cap : target;
}
