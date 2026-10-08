import { Prisma, type UserProgramStatus } from "@prisma/client";

import { REFERRAL_DEPTH, calculateCommission } from "@/lib/config/referral";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/security";
import { ensureBalance, postLedgerEntry } from "@/lib/services/ledger-service";
import { calculateWeeklyReward, cycleRewardTarget } from "@/lib/services/reward-calculation";
import { generateWeeklyRewards } from "@/lib/services/reward-service";
import { postReferralCommissionsForTransaction } from "@/lib/services/referral-service";

export class ProgramError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "ProgramError";
    this.code = code;
    this.status = status;
  }
}

export interface JoinProgramResult {
  userProgramId: string;
  status: string;
  joinAmount: string;
  /** Selected duration row (null only for a legacy program without durations). */
  cycleId: string | null;
  cycleWeeks: number;
  weeklyRewardTarget: string;
  cycleRewardTarget: string;
  /** Snapshot of `weeklyRewardRate * cycleWeeks` (40% / 80% / 120%). */
  targetCycleRewardRate: string;
}

/**
 * Member selects a tier -> PENDING membership.
 * All validation, membership, ledger commitment and audit writes happen inside
 * the same database transaction. Money is received outside the platform and
 * later confirmed by an administrator; join never invents a spendable balance.
 */
export async function joinProgramTier(
  userId: string,
  tierId: string,
  meta: RequestMeta,
  referralCodeUsed?: string,
  cycleId?: string,
): Promise<JoinProgramResult> {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { status: true } });
    if (!user || user.status !== "ACTIVE") {
      throw new ProgramError("USER_NOT_ELIGIBLE", "Hanya akun aktif yang dapat gabung program.", 403);
    }

    const tier = await tx.programTier.findFirst({
      where: { id: tierId, isActive: true, program: { status: "ACTIVE" } },
      include: { program: true },
    });
    if (!tier) {
      throw new ProgramError("TIER_NOT_FOUND", "Paket gabung yang dipilih tidak tersedia.", 404);
    }
    if (tier.currency !== "USDT" || tier.program.currency !== "USDT") {
      throw new ProgramError("UNSUPPORTED_CURRENCY", "Paket program harus memakai USDT.", 400);
    }

    const cycleRows = await tx.programCycle.findMany({
      where: { programId: tier.programId, isActive: true },
      orderBy: { cycleWeeks: "asc" },
    });
    const selectedCycle =
      cycleRows.find((row) =>
        cycleId ? row.id === cycleId : row.cycleWeeks === tier.program.cycleWeeks,
      ) ?? null;
    if (!selectedCycle && (cycleId || cycleRows.length > 0)) {
      throw new ProgramError("CYCLE_NOT_FOUND", "Durasi program yang dipilih tidak tersedia.", 404);
    }

    const duplicate = await tx.userProgram.findFirst({
      where: {
        userId,
        tierId,
        cycleId: selectedCycle?.id ?? null,
        status: { in: ["PENDING", "ACTIVE", "SUSPENDED"] },
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new ProgramError("TIER_ALREADY_JOINED", "Anda sudah memiliki keanggotaan aktif untuk paket ini.", 409);
    }

    /**
     * Snapshot versioning: the membership stores the rates agreed at join time, so
     * a later configuration change never alters an existing program. A program
     * without duration rows keeps using its own (legacy) configuration.
     */
    const weeklyRewardRate = selectedCycle?.weeklyRewardRate ?? tier.program.weeklyRewardRate;
    const cycleWeeks = selectedCycle?.cycleWeeks ?? tier.program.cycleWeeks;
    const maxCycleRewardRate = selectedCycle?.targetCycleRewardRate ?? tier.program.maxCycleRewardRate;
    const { target: weeklyTarget } = calculateWeeklyReward({
      amount: tier.joinAmount,
      weeklyRate: weeklyRewardRate,
      eligibility: false,
      programStatus: "PENDING",
    });
    const cycleTarget = cycleRewardTarget(weeklyTarget, cycleWeeks, maxCycleRewardRate, tier.joinAmount);
    if (weeklyTarget.times(cycleWeeks).greaterThan(tier.joinAmount.times(maxCycleRewardRate))) {
      throw new ProgramError("REWARD_RATE_EXCEEDS_LIMIT", "Target imbalan siklus melebihi batas maksimum konfigurasi.", 500);
    }

    await ensureBalance(tx, userId, tier.currency);
    const membership = await tx.userProgram.create({
      data: {
        userId,
        programId: tier.programId,
        tierId: tier.id,
        cycleId: selectedCycle?.id ?? null,
        joinAmount: tier.joinAmount,
        currency: tier.currency,
        weeklyRewardRate,
        cycleWeeks,
        maxCycleRewardRate,
        status: "PENDING",
        referralCodeUsed: referralCodeUsed ?? null,
      },
      select: { id: true, status: true },
    });

    await postLedgerEntry(tx, {
      userId,
      userProgramId: membership.id,
      type: "PROGRAM_JOIN",
      bucket: "NONE",
      amount: tier.joinAmount,
      reference: `program:${membership.id}:join-request`,
      description: `Permintaan gabung ${tier.code} (${cycleWeeks} minggu); menunggu konfirmasi dana yang diterima di luar platform`,
      metadata: {
        tierId: tier.id,
        cycleId: selectedCycle?.id ?? null,
        weeklyRewardRate: weeklyRewardRate.toFixed(4),
        cycleWeeks,
        targetCycleRewardRate: maxCycleRewardRate.toFixed(4),
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: userId,
        action: "program.join",
        entityType: "UserProgram",
        entityId: membership.id,
        after: {
          tierId: tier.id,
          cycleId: selectedCycle?.id ?? null,
          cycleWeeks,
          joinAmount: tier.joinAmount.toFixed(2),
          status: "PENDING",
        },
        ipAddress: meta.ipAddress,
      },
    });
    await tx.notification.create({
      data: {
        userId,
        type: "PROGRAM",
        title: `Gabung tercatat: ${tier.code} · ${cycleWeeks} minggu`,
        body: `Gabungan Anda berstatus menunggu konfirmasi dana (durasi ${cycleWeeks} minggu, target ${maxCycleRewardRate.times(100).toFixed(0)}% per siklus). Admin harus mengonfirmasi dana yang diterima di luar platform sebelum siklus dimulai.`,
      },
    });

    return {
      userProgramId: membership.id,
      status: membership.status,
      joinAmount: tier.joinAmount.toFixed(2),
      cycleId: selectedCycle?.id ?? null,
      cycleWeeks,
      weeklyRewardTarget: weeklyTarget.toFixed(2),
      cycleRewardTarget: cycleTarget.toFixed(2),
      targetCycleRewardRate: maxCycleRewardRate.toFixed(4),
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}


export interface ActivateProgramResult {
  userProgramId: string;
  status: string;
  fundsConfirmedAmount: string;
  ledgerReference: string | null;
  rewardsCreated: number;
  rewardsSkipped: { userProgramId: string; reason: string }[];
  /** PENDING referral commissions created for the five generations of upline. */
  referralCommissionsCreated: number;
}

export interface ActivateMembershipInTransactionResult {
  userProgramId: string;
  userId: string;
  status: string;
  currency: string;
  fundsConfirmedAmount: Prisma.Decimal;
  ledgerReference: string | null;
  /** PENDING commissions created for the five generations of upline. */
  referralCommissionsCreated: number;
}

/**
 * In-transaction core of "an administrator confirmed that the join funds
 * arrived": the membership becomes ACTIVE, the recorded program funds are
 * appended to the ledger (bucket PROGRAM_FUNDS — never AVAILABLE), and the
 * referral commission engine runs against that very ledger entry.
 *
 * It deliberately does **not** open its own transaction, so a caller that must
 * commit the confirmation together with something else (e.g. approving a
 * `DepositRequest`) can do so atomically in a single Serializable transaction.
 * The weekly reward engine is *not* run here: it reads committed state, so every
 * caller triggers it after its transaction has committed.
 */
export async function activateUserProgramInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    userProgramId: string;
    actorUserId: string | null;
    confirmedAmount?: Prisma.Decimal;
    meta?: RequestMeta;
    note?: string;
  },
): Promise<ActivateMembershipInTransactionResult> {
  const membership = await tx.userProgram.findUnique({
    where: { id: input.userProgramId },
    select: {
      id: true,
      userId: true,
      status: true,
      joinAmount: true,
      currency: true,
      activatedAt: true,
      fundsConfirmedAt: true,
      fundsConfirmedAmount: true,
      tier: { select: { code: true } },
    },
  });
  if (!membership) {
    throw new ProgramError("MEMBERSHIP_NOT_FOUND", "Keanggotaan tidak ditemukan.", 404);
  }
  if (membership.status === "ACTIVE") {
    throw new ProgramError("MEMBERSHIP_ALREADY_ACTIVE", "Keanggotaan ini sudah aktif.", 409);
  }
  if (membership.status !== "PENDING" && membership.status !== "SUSPENDED") {
    throw new ProgramError(
      "INVALID_MEMBERSHIP_STATUS",
      `Hanya keanggotaan PENDING atau SUSPENDED yang dapat diaktifkan (status saat ini: ${membership.status}).`,
      409,
    );
  }

  const confirmed = input.confirmedAmount ?? membership.joinAmount;
  if (confirmed.lte(0) || confirmed.decimalPlaces() > 2) {
    throw new ProgramError("INVALID_AMOUNT", "Dana terkonfirmasi harus berupa nilai USDT positif dengan dua desimal.");
  }

  const now = new Date();
  const alreadyRecorded =
    membership.fundsConfirmedAt !== null && membership.fundsConfirmedAmount.greaterThanOrEqualTo(confirmed);

  const entry = alreadyRecorded
    ? null
    : await postLedgerEntry(tx, {
        userId: membership.userId,
        userProgramId: membership.id,
        type: "PROGRAM_JOIN",
        bucket: "PROGRAM_FUNDS",
        amount: confirmed,
        currency: membership.currency,
        reference: `program:${membership.id}:funds`,
        description: `Dana program dikonfirmasi untuk ${membership.tier.code} (diterima di luar platform)`,
        metadata: { confirmedAmount: confirmed.toFixed(2), confirmedBy: input.actorUserId },
      });

  const updated = await tx.userProgram.update({
    where: { id: membership.id },
    data: {
      status: "ACTIVE",
      activatedAt: membership.activatedAt ?? now,
      fundsConfirmedAt: now,
      fundsConfirmedAmount: confirmed,
      suspendedAt: null,
      cancelledAt: null,
      notes: input.note ?? undefined,
    },
    select: { id: true, status: true },
  });

  /**
   * Referral commissions are produced by this one configured event: the posted
   * PROGRAM_FUNDS entry of an ACTIVE, funds confirmed membership of an ACTIVE
   * program. Running it inside the same transaction means a commission can
   * never exist without the ledger entry that justifies it, and the unique key
   * (sourceTransactionId, beneficiaryUserId) turns a replay into a no-op.
   *
   * The membership is already ACTIVE at this point, so the engine reads the
   * committed state instead of the pre-activation snapshot.
   */
  const sourceEntry =
    entry ??
    (await tx.transaction.findFirst({
      where: {
        userProgramId: membership.id,
        type: "PROGRAM_JOIN",
        bucket: "PROGRAM_FUNDS",
        status: "POSTED",
      },
      orderBy: [{ postedAt: "asc" }, { createdAt: "asc" }],
      select: { id: true },
    }));

  const referralCommissions = sourceEntry
    ? await postReferralCommissionsForTransaction(tx, { transactionId: sourceEntry.id })
    : null;

  await tx.notification.create({
    data: {
      userId: membership.userId,
      type: "PROGRAM",
      title: `Program diaktifkan: ${membership.tier.code}`,
      body: `Program ${membership.currency} ${confirmed.toFixed(2)} Anda berstatus aktif. Periode imbalan mingguan sekarang dievaluasi sesuai ketentuan program.`,
    },
  });

  await tx.auditLog.create({
    data: {
      actorUserId: input.actorUserId,
      action: "program.activate",
      entityType: "UserProgram",
      entityId: membership.id,
      before: {
        status: membership.status,
        fundsConfirmedAmount: membership.fundsConfirmedAmount.toFixed(2),
      },
      after: {
        status: updated.status,
        fundsConfirmedAmount: confirmed.toFixed(2),
        ledgerReference: entry?.reference ?? null,
        referralCommissionsCreated: referralCommissions?.created.length ?? 0,
      },
      ipAddress: input.meta?.ipAddress ?? null,
      userAgent: input.meta?.userAgent ?? null,
    },
  });

  return {
    userProgramId: updated.id,
    userId: membership.userId,
    status: updated.status,
    currency: membership.currency,
    fundsConfirmedAmount: confirmed,
    ledgerReference: entry?.reference ?? null,
    referralCommissionsCreated: referralCommissions?.created.length ?? 0,
  };
}

/**
 * Admin confirms that the join funds arrived outside the platform.
 *
 * Runs the in-transaction activation core inside one Serializable transaction
 * and then lets the idempotent reward engine record the first reward period.
 */
export async function activateUserProgram(input: {
  userProgramId: string;
  actorUserId: string | null;
  confirmedAmount?: Prisma.Decimal;
  meta?: RequestMeta;
  note?: string;
}): Promise<ActivateProgramResult> {
  const result = await prisma.$transaction(
    (tx) => activateUserProgramInTransaction(tx, input),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );

  const generated = await generateWeeklyRewards({
    actorUserId: input.actorUserId,
    userProgramId: result.userProgramId,
    meta: input.meta,
  });

  return {
    userProgramId: result.userProgramId,
    status: result.status,
    fundsConfirmedAmount: result.fundsConfirmedAmount.toFixed(2),
    ledgerReference: result.ledgerReference,
    rewardsCreated: generated.created.length,
    rewardsSkipped: generated.skipped,
    referralCommissionsCreated: result.referralCommissionsCreated,
  };
}

export type MembershipAction = "SUSPEND" | "RESUME" | "COMPLETE" | "CANCEL";

const ACTION_TARGET: Record<MembershipAction, UserProgramStatus> = {
  SUSPEND: "SUSPENDED",
  RESUME: "ACTIVE",
  COMPLETE: "COMPLETED",
  CANCEL: "CANCELLED",
};

const ALLOWED_FROM: Record<MembershipAction, UserProgramStatus[]> = {
  SUSPEND: ["ACTIVE"],
  RESUME: ["SUSPENDED"],
  COMPLETE: ["ACTIVE", "SUSPENDED"],
  CANCEL: ["PENDING", "ACTIVE", "SUSPENDED"],
};

export interface MembershipStatusResult {
  userProgramId: string;
  status: UserProgramStatus;
  refunded: string | null;
}

/**
 * Membership lifecycle: PENDING -> ACTIVE -> COMPLETED, with SUSPENDED and
 * CANCELLED as side states. Returning recorded program funds is an explicit
 * ADJUSTMENT entry, never a deletion.
 */
export async function setUserProgramStatus(input: {
  userProgramId: string;
  action: MembershipAction;
  actorUserId: string | null;
  reason?: string;
  refundFunds?: boolean;
  meta?: RequestMeta;
}): Promise<MembershipStatusResult> {
  const membership = await prisma.userProgram.findUnique({
    where: { id: input.userProgramId },
    select: {
      id: true,
      userId: true,
      status: true,
      currency: true,
      fundsConfirmedAmount: true,
      tier: { select: { code: true } },
    },
  });
  if (!membership) {
    throw new ProgramError("MEMBERSHIP_NOT_FOUND", "Keanggotaan tidak ditemukan.", 404);
  }
  if (!ALLOWED_FROM[input.action].includes(membership.status)) {
    throw new ProgramError(
      "INVALID_MEMBERSHIP_STATUS",
      `Tidak dapat menjalankan aksi ${input.action.toLowerCase()} pada keanggotaan berstatus ${membership.status}.`,
      409,
    );
  }

  const target = ACTION_TARGET[input.action];
  const now = new Date();
  const refund =
    input.action === "CANCEL" && input.refundFunds && membership.fundsConfirmedAmount.greaterThan(0)
      ? membership.fundsConfirmedAmount
      : null;

  return prisma.$transaction(
    async (tx) => {
      let adjustmentReference: string | null = null;

      if (refund) {
        const adjustment = await postLedgerEntry(tx, {
          userId: membership.userId,
          userProgramId: membership.id,
          type: "ADJUSTMENT",
          bucket: "PROGRAM_FUNDS",
          amount: refund.negated(),
          currency: membership.currency,
          reference: `program:${membership.id}:refund`,
          description: `Dana program dikembalikan ke anggota: ${input.reason ?? "keanggotaan dibatalkan"}`,
          metadata: { reason: input.reason ?? null, actorUserId: input.actorUserId },
        });
        adjustmentReference = adjustment.reference;
      }

      const updated = await tx.userProgram.update({
        where: { id: membership.id },
        data: {
          status: target,
          suspendedAt:
            input.action === "SUSPEND" ? now : input.action === "RESUME" ? null : undefined,
          completedAt: input.action === "COMPLETE" ? now : undefined,
          cancelledAt: input.action === "CANCEL" ? now : undefined,
          notes: input.reason ?? undefined,
        },
        select: { id: true, status: true },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          action: `program.${input.action.toLowerCase()}`,
          entityType: "UserProgram",
          entityId: membership.id,
          before: { status: membership.status },
          after: {
            status: updated.status,
            reason: input.reason ?? null,
            refunded: refund ? refund.toFixed(2) : null,
            adjustmentReference,
          },
          ipAddress: input.meta?.ipAddress ?? null,
        },
      });

      return {
        userProgramId: updated.id,
        status: updated.status,
        refunded: refund ? refund.toFixed(2) : null,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}


export interface ReferralCommissionPreviewRow {
  level: number;
  rate: string;
  amount: string;
}

/** Illustrative referral commission breakdown for a given base amount (USDT). */
export function previewReferralCommissions(
  baseAmount: Prisma.Decimal,
): ReferralCommissionPreviewRow[] {
  const rows: ReferralCommissionPreviewRow[] = [];
  const safeBase = baseAmount.isZero() ? new Prisma.Decimal(1) : baseAmount;

  for (let level = 1; level <= REFERRAL_DEPTH; level += 1) {
    const amount = calculateCommission(baseAmount, level);
    if (!amount) continue;
    rows.push({
      level,
      rate: amount.dividedBy(safeBase).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP).toFixed(4),
      amount: amount.toFixed(2),
    });
  }

  return rows;
}

export interface UserProgramSummary {
  id: string;
  status: UserProgramStatus;
  joinAmount: string;
  currency: string;
  tierName: string;
  tierCode: string;
  /** Selected duration row (null for a legacy membership without a duration). */
  cycleId: string | null;
  /** Duration of the membership in weeks: 4, 8 or 12. */
  cycleWeeks: number;
  joinedAt: Date;
  weeksCompleted: number;
  cycleNumber: number;
  weeklyRewardTarget: string;
  cycleRewardTarget: string;
}

/** Program memberships of a user, newest first. */
export async function getUserPrograms(userId: string): Promise<UserProgramSummary[]> {
  const memberships = await prisma.userProgram.findMany({
    where: { userId },
    orderBy: { joinedAt: "desc" },
    select: {
      id: true,
      status: true,
      joinAmount: true,
      currency: true,
      joinedAt: true,
      weeksCompleted: true,
      cycleNumber: true,
      cycleId: true,
      weeklyRewardRate: true,
      cycleWeeks: true,
      maxCycleRewardRate: true,
      tier: { select: { name: true, code: true } },
    },
  });

  return memberships.map((membership) => {
    const weeklyTarget = membership.joinAmount
      .times(membership.weeklyRewardRate)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

    return {
      id: membership.id,
      status: membership.status,
      joinAmount: membership.joinAmount.toFixed(2),
      currency: membership.currency,
      tierName: membership.tier.name,
      tierCode: membership.tier.code,
      cycleId: membership.cycleId,
      cycleWeeks: membership.cycleWeeks,
      joinedAt: membership.joinedAt,
      weeksCompleted: membership.weeksCompleted,
      cycleNumber: membership.cycleNumber,
      weeklyRewardTarget: weeklyTarget.toFixed(2),
      cycleRewardTarget: cycleRewardTarget(
        weeklyTarget,
        membership.cycleWeeks,
        membership.maxCycleRewardRate,
        membership.joinAmount,
      ).toFixed(2),
    };
  });
}

