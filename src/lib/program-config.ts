import { Prisma } from "@prisma/client";

import {
  FALLBACK_PROGRAM_CONFIG,
  PROGRAM_TIER_DEFINITIONS,
  type ProgramConfig,
  type ProgramCycleConfig,
  type ProgramTierConfig,
} from "@/lib/config/program";
import { prisma } from "@/lib/prisma";

export interface ActiveProgram {
  program: ProgramConfig;
  tiers: ProgramTierConfig[];
  /** Selectable durations of the active program (4 / 8 / 12 weeks). */
  cycles: ProgramCycleConfig[];
  /** `true` when values were loaded from the database, `false` when fallback config was used. */
  fromDatabase: boolean;
}

interface CacheEntry {
  value: ActiveProgram;
  expiresAt: number;
}

const CACHE_TTL_MS = 30_000;
let cache: CacheEntry | null = null;

function fallbackTiers(): ProgramTierConfig[] {
  return PROGRAM_TIER_DEFINITIONS.map((tier) => ({
    id: `fallback:${tier.code}`,
    code: tier.code,
    name: tier.name,
    joinAmount: tier.joinAmount,
    currency: FALLBACK_PROGRAM_CONFIG.currency,
    sortOrder: tier.sortOrder,
  }));
}

function fallbackCycles(): ProgramCycleConfig[] {
  return FALLBACK_PROGRAM_CONFIG.cycles;
}

function toCycleConfig(cycle: {
  id: string;
  cycleWeeks: number;
  weeklyRewardRate: Prisma.Decimal;
  targetCycleRewardRate: Prisma.Decimal;
}): ProgramCycleConfig {
  return {
    id: cycle.id,
    cycleWeeks: cycle.cycleWeeks,
    weeklyRewardRate: cycle.weeklyRewardRate,
    targetCycleRewardRate: cycle.targetCycleRewardRate,
  };
}

/**
 * Loads the active program + tiers from the database (admin editable).
 * Falls back to the central configuration when the database has not been seeded
 * or is temporarily unreachable, so the public pages always render.
 */
export async function getActiveProgram(options?: { forceRefresh?: boolean }): Promise<ActiveProgram> {
  const now = Date.now();
  if (!options?.forceRefresh && cache && cache.expiresAt > now) {
    return cache.value;
  }

  let value: ActiveProgram;
  try {
    const program = await prisma.program.findFirst({
      where: { status: "ACTIVE" },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      include: {
        tiers: {
          where: { isActive: true },
          orderBy: [{ sortOrder: "asc" }, { joinAmount: "asc" }],
        },
        cycles: {
          where: { isActive: true },
          orderBy: { cycleWeeks: "asc" },
        },
      },
    });

    if (!program || program.tiers.length === 0) {
      value = {
        program: FALLBACK_PROGRAM_CONFIG,
        tiers: fallbackTiers(),
        cycles: fallbackCycles(),
        fromDatabase: false,
      };
    } else {
      const cycles = program.cycles.map(toCycleConfig);
      value = {
        program: {
          code: program.code,
          name: program.name,
          currency: program.currency,
          weeklyRewardRate: program.weeklyRewardRate,
          cycleWeeks: program.cycleWeeks,
          maxCycleRewardRate: program.maxCycleRewardRate,
          rewardTerms: program.rewardTerms ?? FALLBACK_PROGRAM_CONFIG.rewardTerms,
          status: program.status,
          cycles: cycles.length > 0 ? cycles : fallbackCycles(),
        },
        tiers: program.tiers.map((tier) => ({
          id: tier.id,
          code: tier.code,
          name: tier.name,
          joinAmount: tier.joinAmount,
          currency: tier.currency,
          sortOrder: tier.sortOrder,
        })),
        cycles: cycles.length > 0 ? cycles : fallbackCycles(),
        fromDatabase: true,
      };
    }
  } catch {
    value = {
      program: FALLBACK_PROGRAM_CONFIG,
      tiers: fallbackTiers(),
      cycles: fallbackCycles(),
      fromDatabase: false,
    };
  }

  cache = { value, expiresAt: now + CACHE_TTL_MS };
  return value;
}

export function clearProgramConfigCache(): void {
  cache = null;
}

/** Reward target per week for a join amount, using the active program rate. */
export function weeklyRewardTargetFor(joinAmount: Prisma.Decimal, program: ProgramConfig): Prisma.Decimal {
  return joinAmount.times(program.weeklyRewardRate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}
