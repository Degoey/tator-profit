import { Prisma } from "@prisma/client";

import { canAdmin } from "@/lib/auth/admin-permissions";
import {
  REBATE_GENERATIONS,
  clearRebateConfigCache,
  getRebateRates,
  parseRebateRate,
} from "@/lib/rebate-config";
import { formatRate, toDecimal } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/security";

/** Audit action written whenever an administrator changes a rebate percentage. */
export const REBATE_CONFIG_AUDIT_ACTION = "rebate.config.updated";

export class RebateConfigError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "RebateConfigError";
    this.code = code;
    this.status = status;
  }
}

export interface RebateGenerationView {
  generation: number;
  /** Stored fraction, 4 decimals (e.g. `0.1000`). */
  rate: string;
  /** Display string (e.g. `10%`). */
  displayRate: string;
  /** Editable percentage string (e.g. `10` for 10%). */
  percent: string;
  updatedAt: Date | null;
  updatedBy: string | null;
}

/** Converts a stored fraction (`0.1000`) into an editable percent string (`10`). */
function fractionToPercent(fraction: Prisma.Decimal): string {
  const [intPart = "0", fracPart = ""] = fraction.toFixed(4).split(".");
  const digits = intPart + fracPart;
  const pointAt = intPart.length + 2;
  let out =
    pointAt >= digits.length
      ? digits + "0".repeat(pointAt - digits.length)
      : `${digits.slice(0, pointAt)}.${digits.slice(pointAt)}`;
  out = out.replace(/^0+(?=\d)/, "");
  if (out.includes(".")) out = out.replace(/0+$/, "").replace(/\.$/, "");
  return out || "0";
}

export interface RebateConfigView {
  generations: RebateGenerationView[];
  /** `true` when every generation row exists in the database. */
  fromDatabase: boolean;
}

export interface RebateUpdateInput {
  generation: number;
  rate: string;
}

/**
 * One administrator who may change rebate percentages. The capability is
 * re-checked here (never only in the UI) so an endpoint cannot be abused.
 */
export interface UpdateRebateConfigInput {
  updates: RebateUpdateInput[];
  actorUserId: string;
  actorAdminRole: Parameters<typeof canAdmin>[0];
  meta?: RequestMeta;
}

/**
 * Pure validation of admin supplied percentages. Rejects an empty payload,
 * duplicate generations, unknown generations and anything outside 1..5, so a
 * sixth (or later) generation can never be configured.
 */
export function normalizeRebateUpdates(updates: RebateUpdateInput[]): {
  generation: number;
  rate: Prisma.Decimal;
}[] {
  if (!Array.isArray(updates) || updates.length === 0) {
    throw new RebateConfigError("EMPTY_UPDATE", "Tidak ada persentase rabat yang dikirim.");
  }

  const seen = new Set<number>();
  const normalized: { generation: number; rate: Prisma.Decimal }[] = [];

  for (const update of updates) {
    const generation = update?.generation;
    if (!Number.isInteger(generation) || generation < 1 || generation > REBATE_GENERATIONS) {
      throw new RebateConfigError(
        "INVALID_GENERATION",
        `Generasi rabat harus bilangan bulat 1 sampai ${REBATE_GENERATIONS}. Generasi 6 atau lebih tidak disediakan.`,
      );
    }
    if (seen.has(generation)) {
      throw new RebateConfigError("DUPLICATE_GENERATION", `Generasi ${generation} dikirim lebih dari sekali.`);
    }
    seen.add(generation);

    let rate: Prisma.Decimal;
    try {
      rate = parseRebateRate(update.rate);
    } catch (error) {
      throw new RebateConfigError(
        "INVALID_RATE",
        error instanceof Error ? error.message : "Persentase rabat tidak valid.",
      );
    }

    normalized.push({ generation, rate });
  }

  return normalized;
}

/** Current rebate configuration for the admin screen (always 1..5, never 6+). */
export async function listRebateConfig(): Promise<RebateConfigView> {
  const rows = await prisma.rebateConfig.findMany({
    where: { generation: { gte: 1, lte: REBATE_GENERATIONS } },
    orderBy: { generation: "asc" },
    select: { generation: true, rate: true, updatedAt: true, updatedBy: true },
  });

  const byGeneration = new Map(rows.map((row) => [row.generation, row]));
  const rates = await getRebateRates();
  const fromDatabase = rows.length === REBATE_GENERATIONS;

  const generations = rates.map((entry) => {
    const row = byGeneration.get(entry.generation);
    return {
      generation: entry.generation,
      rate: entry.rate.toFixed(4),
      displayRate: entry.displayRate,
      percent: fractionToPercent(entry.rate),
      updatedAt: row?.updatedAt ?? null,
      updatedBy: row?.updatedBy ?? null,
    };
  });

  return { generations, fromDatabase };
}

/**
 * Writes the rebate percentages. Only SUPER_ADMIN/FINANCE (`manageFinance`) may
 * call it; every accepted change produces one audit row containing the
 * before/after snapshot of all five generations. The cache is cleared so the
 * member view and the commission engine immediately share the new values.
 */
export async function updateRebateConfig(input: UpdateRebateConfigInput): Promise<RebateConfigView> {
  if (!canAdmin(input.actorAdminRole, "manageFinance")) {
    throw new RebateConfigError(
      "FORBIDDEN",
      "Hanya administrator berwenang (Super Admin atau Keuangan) yang dapat mengubah persentase rabat.",
      403,
    );
  }

  const normalized = normalizeRebateUpdates(input.updates);

  const result = await prisma.$transaction(async (tx) => {
    const before = await tx.rebateConfig.findMany({
      where: { generation: { gte: 1, lte: REBATE_GENERATIONS } },
      orderBy: { generation: "asc" },
      select: { generation: true, rate: true },
    });

    for (const update of normalized) {
      await tx.rebateConfig.upsert({
        where: { generation: update.generation },
        update: { rate: update.rate, updatedBy: input.actorUserId },
        create: { generation: update.generation, rate: update.rate, updatedBy: input.actorUserId },
      });
    }

    const after = await tx.rebateConfig.findMany({
      where: { generation: { gte: 1, lte: REBATE_GENERATIONS } },
      orderBy: { generation: "asc" },
      select: { generation: true, rate: true, updatedAt: true, updatedBy: true },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        action: REBATE_CONFIG_AUDIT_ACTION,
        entityType: "RebateConfig",
        entityId: null,
        before: before.map((row) => ({ generation: row.generation, rate: row.rate.toFixed(4) })),
        after: after.map((row) => ({ generation: row.generation, rate: row.rate.toFixed(4) })),
        ipAddress: input.meta?.ipAddress ?? null,
        userAgent: input.meta?.userAgent ?? null,
      },
    });

    return after;
  });

  clearRebateConfigCache();

  return {
    fromDatabase: true,
    generations: result.map((row) => ({
      generation: row.generation,
      rate: row.rate.toFixed(4),
      displayRate: formatRate(toDecimal(row.rate)),
      percent: fractionToPercent(row.rate),
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy,
    })),
  };
}
