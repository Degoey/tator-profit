import { Prisma, type PrismaClient } from "@prisma/client";

import { REFERRAL_LEVEL_RATES, REFERRAL_DEPTH } from "@/lib/config/referral";
import { RATE_SCALE, formatRate, roundRate, toDecimal, type DecimalInput } from "@/lib/money";
import { prisma } from "@/lib/prisma";

/** The platform intentionally exposes exactly five rebate generations. */
export const REBATE_GENERATIONS = REFERRAL_DEPTH;

export interface RebateRate {
  generation: number;
  rate: Prisma.Decimal;
  displayRate: string;
}

interface CacheEntry {
  value: RebateRate[];
  expiresAt: number;
}

const CACHE_TTL_MS = 30_000;
let cache: CacheEntry | null = null;

function fallbackRates(): RebateRate[] {
  return REFERRAL_LEVEL_RATES.map((entry) => ({
    generation: entry.level,
    rate: entry.rate,
    displayRate: formatRate(entry.rate),
  }));
}

function toRates(rows: { generation: number; rate: Prisma.Decimal }[]): RebateRate[] {
  const byGeneration = new Map(rows.map((row) => [row.generation, row]));
  return Array.from({ length: REBATE_GENERATIONS }, (_, index) => {
    const generation = index + 1;
    const row = byGeneration.get(generation);
    if (!row) throw new Error(`Konfigurasi rabat generasi ${generation} tidak lengkap.`);
    return { generation, rate: row.rate, displayRate: formatRate(row.rate) };
  });
}

/** The pool or an open transaction; only needs `rebateConfig` access. */
export type RebateConfigClient = Pick<PrismaClient, "rebateConfig"> | Prisma.TransactionClient;

/**
 * Loads the single rebate configuration used by member/admin views and the
 * calculation engine. The fallback keeps pages available before migration, while
 * a complete database configuration always takes precedence.
 */
export async function getRebateRates(
  options?: { forceRefresh?: boolean; client?: RebateConfigClient },
): Promise<RebateRate[]> {
  const now = Date.now();
  if (!options?.client && !options?.forceRefresh && cache && cache.expiresAt > now) return cache.value;

  let value: RebateRate[];
  try {
    const rows = await (options?.client ?? prisma).rebateConfig.findMany({
      where: { generation: { gte: 1, lte: REBATE_GENERATIONS } },
      orderBy: { generation: "asc" },
      select: { generation: true, rate: true },
    });
    value = rows.length === REBATE_GENERATIONS ? toRates(rows) : fallbackRates();
  } catch {
    value = fallbackRates();
  }

  cache = { value, expiresAt: now + CACHE_TTL_MS };
  return value;
}

export function clearRebateConfigCache(): void {
  cache = null;
}

export function rebateRateForGeneration(
  rates: RebateRate[],
  generation: number,
): Prisma.Decimal | null {
  return rates.find((entry) => entry.generation === generation)?.rate ?? null;
}

/** Validates an admin-supplied percentage represented as a fraction. */
export function parseRebateRate(value: DecimalInput): Prisma.Decimal {
  const rawRate = toDecimal(value);
  if (rawRate.decimalPlaces() > RATE_SCALE) {
    throw new Error("Persentase rabat maksimal empat angka desimal.");
  }
  const rate = roundRate(rawRate);
  if (rate.isNegative() || rate.greaterThan(new Prisma.Decimal("1"))) {
    throw new Error("Persentase rabat harus berada di antara 0% dan 100%.");
  }
  return rate;
}
