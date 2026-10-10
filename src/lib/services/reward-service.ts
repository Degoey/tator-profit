import {
  Prisma,
  type ProgramStatus,
  type RewardStatus,
  type UserProgramStatus,
  type UserStatus,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { recordAuditLog, type RequestMeta } from "@/lib/security";
import { postLedgerEntry } from "@/lib/services/ledger-service";
import {
  calculateWeeklyReward,
  cycleProgress,
  cycleRewardTarget,
  rewardDateFor,
} from "@/lib/services/reward-calculation";

/**
 * Reward engine.
 *
 * Rewards are never credited because a page was opened: the engine *records*
 * eligible reward periods as `PENDING`, an administrator approves them
 * (`APPROVED`) and only an explicit payout moves the balance (`PAID`).
 *
 * Idempotency: one reward row per membership + type + cycle + period, enforced by
 * the `Reward_userProgramId_type_cycleNumber_period_key` unique index. Running
 * the engine twice can therefore never pay the same period twice.
 */

export class RewardError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "RewardError";
    this.code = code;
    this.status = status;
  }
}

export interface EligibilityInput {
  membershipStatus: UserProgramStatus;
  fundsConfirmedAt: Date | null;
  fundsConfirmedAmount: Prisma.Decimal;
  joinAmount: Prisma.Decimal;
  programStatus: ProgramStatus;
  userStatus: UserStatus;
}

export interface EligibilityResult {
  eligible: boolean;
  reason: string;
}

/** Program rules that decide whether a membership may accrue a reward period. */
export function evaluateRewardEligibility(input: EligibilityInput): EligibilityResult {
  if (input.userStatus !== "ACTIVE") {
    return { eligible: false, reason: `Status akun: ${input.userStatus}.` };
  }
  if (input.programStatus !== "ACTIVE") {
    return { eligible: false, reason: `Status program: ${input.programStatus}.` };
  }
  if (input.membershipStatus !== "ACTIVE") {
    return { eligible: false, reason: `Status keanggotaan: ${input.membershipStatus}.` };
  }
  if (!input.fundsConfirmedAt) {
    return { eligible: false, reason: "Dana program belum dikonfirmasi." };
  }
  if (input.fundsConfirmedAmount.lessThan(input.joinAmount)) {
    return {
      eligible: false,
      reason: `Dana tercatat ${input.fundsConfirmedAmount.toFixed(2)} kurang dari nilai gabung ${input.joinAmount.toFixed(2)}.`,
    };
  }
  return { eligible: true, reason: "Memenuhi syarat: keanggotaan aktif dan dana sudah dikonfirmasi." };
}

const MEMBERSHIP_SELECT = {
  id: true,
  userId: true,
  programId: true,
  tierId: true,
  joinAmount: true,
  currency: true,
  status: true,
  weeklyRewardRate: true,
  cycleWeeks: true,
  maxCycleRewardRate: true,
  cycleNumber: true,
  weeksCompleted: true,
  activatedAt: true,
  fundsConfirmedAt: true,
  fundsConfirmedAmount: true,
  tier: { select: { code: true, name: true } },
  program: { select: { status: true, name: true } },
  user: { select: { status: true, username: true } },
} satisfies Prisma.UserProgramSelect;

type MembershipRow = Prisma.UserProgramGetPayload<{ select: typeof MEMBERSHIP_SELECT }>;

/** Guards the engine against unbounded runs; callers can target a single user. */
export const REWARD_GENERATION_LIMIT = 500;

export interface GenerateRewardsInput {
  actorUserId: string | null;
  meta?: RequestMeta;
  userProgramId?: string;
  userId?: string;
  /** Week number to generate; defaults to the membership's current week. */
  period?: number;
  now?: Date;
}

export interface GeneratedReward {
  id: string;
  userProgramId: string;
  userId: string;
  period: number;
  amount: string;
  status: string;
}

export interface GenerateRewardsResult {
  created: GeneratedReward[];
  skipped: { userProgramId: string; reason: string }[];
  evaluated: number;
}

async function generateForMembership(
  tx: Prisma.TransactionClient,
  membership: MembershipRow,
  period: number,
  actorUserId: string | null,
) {
  const eligibility = evaluateRewardEligibility({
    membershipStatus: membership.status,
    fundsConfirmedAt: membership.fundsConfirmedAt,
    fundsConfirmedAmount: membership.fundsConfirmedAmount,
    joinAmount: membership.joinAmount,
    programStatus: membership.program.status,
    userStatus: membership.user.status,
  });

  const calculation = calculateWeeklyReward({
    amount: membership.joinAmount,
    weeklyRate: membership.weeklyRewardRate,
    eligibility: eligibility.eligible,
    programStatus: membership.status,
  });

  if (!calculation.eligible || !membership.activatedAt) {
    return {
      status: "skipped" as const,
      reason: membership.activatedAt ? eligibility.reason : "Keanggotaan belum memiliki tanggal aktivasi.",
    };
  }

  const key = {
    userProgramId: membership.id,
    type: "WEEKLY" as const,
    cycleNumber: membership.cycleNumber,
    period,
  };

  const existing = await tx.reward.findUnique({ where: { userProgramId_type_cycleNumber_period: key }, select: { id: true } });
  if (existing) {
    return { status: "duplicate" as const, reason: `Minggu ${period} sudah tercatat.`, rewardId: existing.id };
  }

  const reward = await tx.reward.create({
    data: {
      userId: membership.userId,
      programId: membership.programId,
      userProgramId: membership.id,
      tierId: membership.tierId,
      type: "WEEKLY",
      status: "PENDING",
      amount: calculation.target,
      currency: membership.currency,
      rate: membership.weeklyRewardRate,
      period,
      cycleNumber: membership.cycleNumber,
      scheduledFor: rewardDateFor(membership.activatedAt, period, membership.cycleWeeks),
    },
    select: { id: true },
  });

  await tx.notification.create({
    data: {
      userId: membership.userId,
      type: "REWARD",
      title: `Imbalan tercatat: Minggu ${period}`,
      body:
        `Target imbalan Minggu ${period} sebesar ${membership.currency} ${calculation.target.toFixed(2)} ` +
        `dicatat dengan status menunggu persetujuan untuk ${membership.tier.code}. Persetujuan dan ketentuan kualifikasi berlaku.`,
      metadata: {
        rewardId: reward.id,
        period,
        userProgramId: membership.id,
        amount: calculation.target.toFixed(2),
        currency: membership.currency,
        href: "/rewards",
      },
    },
  });

  await tx.auditLog.create({
    data: {
      actorUserId,
      action: "reward.generate",
      entityType: "Reward",
      entityId: reward.id,
      after: {
        userProgramId: membership.id,
        tierCode: membership.tier.code,
        period,
        cycleNumber: membership.cycleNumber,
        rate: membership.weeklyRewardRate.toFixed(4),
        amount: calculation.target.toFixed(2),
        status: "PENDING",
      },
    },
  });

  return { status: "created" as const, rewardId: reward.id };
}

/**
 * Records the reward periods of eligible memberships as PENDING rewards.
 * Safe to run repeatedly (cron, retries, admin trigger): existing periods are
 * detected through the unique key and reported as duplicates instead of being
 * created twice.
 */
export async function generateWeeklyRewards(
  input: GenerateRewardsInput,
): Promise<GenerateRewardsResult> {
  const now = input.now ?? new Date();

  const memberships = await prisma.userProgram.findMany({
    where: {
      status: "ACTIVE",
      ...(input.userProgramId ? { id: input.userProgramId } : {}),
      ...(input.userId ? { userId: input.userId } : {}),
    },
    orderBy: [{ activatedAt: "asc" }, { id: "asc" }],
    take: REWARD_GENERATION_LIMIT,
    select: MEMBERSHIP_SELECT,
  });

  const result = await prisma.$transaction(
    async (tx) => {
      const created: GeneratedReward[] = [];
      const skipped: { userProgramId: string; reason: string }[] = [];

      for (const membership of memberships) {
        const period =
          input.period ??
          (membership.activatedAt
            ? cycleProgress(membership.activatedAt, membership.cycleWeeks, now).currentWeek
            : 0);

        if (period < 1) {
          skipped.push({ userProgramId: membership.id, reason: "Siklus belum dimulai." });
          continue;
        }
        if (period > membership.cycleWeeks) {
          skipped.push({
            userProgramId: membership.id,
            reason: `Siklus ${membership.cycleWeeks} minggu sudah selesai.`,
          });
          continue;
        }

        const outcome = await generateForMembership(tx, membership, period, input.actorUserId);
        if (outcome.status !== "created") {
          skipped.push({ userProgramId: membership.id, reason: outcome.reason });
          continue;
        }

        const row = await tx.reward.findUniqueOrThrow({
          where: { id: outcome.rewardId },
          select: { id: true, amount: true, status: true },
        });
        created.push({
          id: row.id,
          userProgramId: membership.id,
          userId: membership.userId,
          period,
          amount: row.amount.toFixed(2),
          status: row.status,
        });
      }

      return { created, skipped, evaluated: memberships.length };
    },
    { timeout: 30_000, maxWait: 10_000 },
  );

  await recordAuditLog({
    actorUserId: input.actorUserId,
    action: "reward.generate.run",
    entityType: "Reward",
    after: {
      evaluated: result.evaluated,
      created: result.created.length,
      skipped: result.skipped.length,
      period: input.period ?? "auto",
    },
    meta: input.meta,
  });

  return result;
}

/**
 * In-transaction variant of the reward engine.
 *
 * Records the reward periods of a single membership using the *caller's*
 * transaction instead of opening its own. That lets a workflow which must create
 * the first reward period together with the event that made the membership
 * eligible (e.g. approving a `DepositRequest`, which activates the program in the
 * same Serializable transaction) do so atomically: either the activation, the
 * ledger entry, the reward and the audit row all commit, or none of them do.
 *
 * It reuses the exact same eligibility calculation, idempotency key and audit
 * shape as `generateWeeklyRewards`, so running it twice can never double-record a
 * period.
 */
export async function generateRewardsInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    userProgramId: string;
    actorUserId: string | null;
    /** Week number to generate; defaults to the membership's current week. */
    period?: number;
    now?: Date;
  },
): Promise<GenerateRewardsResult> {
  const now = input.now ?? new Date();

  const memberships = await tx.userProgram.findMany({
    where: { id: input.userProgramId, status: "ACTIVE" },
    orderBy: [{ activatedAt: "asc" }, { id: "asc" }],
    select: MEMBERSHIP_SELECT,
  });

  const created: GeneratedReward[] = [];
  const skipped: { userProgramId: string; reason: string }[] = [];

  for (const membership of memberships) {
    const period =
      input.period ??
      (membership.activatedAt
        ? cycleProgress(membership.activatedAt, membership.cycleWeeks, now).currentWeek
        : 0);

    if (period < 1) {
      skipped.push({ userProgramId: membership.id, reason: "Siklus belum dimulai." });
      continue;
    }
    if (period > membership.cycleWeeks) {
      skipped.push({
        userProgramId: membership.id,
        reason: `Siklus ${membership.cycleWeeks} minggu sudah selesai.`,
      });
      continue;
    }

    const outcome = await generateForMembership(tx, membership, period, input.actorUserId);
    if (outcome.status !== "created") {
      skipped.push({ userProgramId: membership.id, reason: outcome.reason });
      continue;
    }

    const row = await tx.reward.findUniqueOrThrow({
      where: { id: outcome.rewardId },
      select: { id: true, amount: true, status: true },
    });
    created.push({
      id: row.id,
      userProgramId: membership.id,
      userId: membership.userId,
      period,
      amount: row.amount.toFixed(2),
      status: row.status,
    });
  }

  return { created, skipped, evaluated: memberships.length };
}


const REWARD_SELECT = {
  id: true,
  userId: true,
  userProgramId: true,
  programId: true,
  amount: true,
  currency: true,
  status: true,
  rate: true,
  period: true,
  cycleNumber: true,
  notes: true,
  userProgram: {
    select: {
      id: true,
      cycleWeeks: true,
      status: true,
      cycleNumber: true,
      completedAt: true,
      tier: { select: { code: true } },
    },
  },
} satisfies Prisma.RewardSelect;

type RewardRow = Prisma.RewardGetPayload<{ select: typeof REWARD_SELECT }>;

async function loadReward(tx: Prisma.TransactionClient, rewardId: string): Promise<RewardRow> {
  const reward = await tx.reward.findUnique({ where: { id: rewardId }, select: REWARD_SELECT });
  if (!reward) {
    throw new RewardError("REWARD_NOT_FOUND", "Imbalan tidak ditemukan.", 404);
  }
  return reward;
}

export interface RewardActionResult {
  id: string;
  status: string;
  amount: string;
  period: number;
  transactionId: string | null;
  weeksCompleted?: number;
  membershipCompleted?: boolean;
}

/**
 * PENDING -> APPROVED. Records the reward as an eligible, approved amount in the
 * PENDING balance bucket. No spendable balance is touched here.
 */
export async function approveReward(
  rewardId: string,
  actorUserId: string | null,
  meta?: RequestMeta,
  note?: string,
): Promise<RewardActionResult> {
  const result = await prisma.$transaction(async (tx) => {
    const reward = await loadReward(tx, rewardId);
    if (reward.status === "PAID") {
      throw new RewardError("REWARD_ALREADY_PAID", "Imbalan yang sudah dibayar tidak dapat disetujui lagi.", 409);
    }
    if (reward.status !== "PENDING") {
      throw new RewardError(
        "INVALID_REWARD_STATUS",
        `Hanya imbalan PENDING yang dapat disetujui (status saat ini: ${reward.status}).`,
        409,
      );
    }

    const now = new Date();
    const entry = await postLedgerEntry(tx, {
      userId: reward.userId,
      userProgramId: reward.userProgramId,
      type: "REWARD",
      bucket: "PENDING",
      amount: reward.amount,
      currency: reward.currency,
      reference: `reward:${reward.id}:approved`,
      description: `Imbalan Minggu ${reward.period} disetujui (${reward.userProgram.tier.code})`,
      metadata: { rewardId: reward.id, period: reward.period, cycleNumber: reward.cycleNumber },
    });

    const updated = await tx.reward.update({
      where: { id: reward.id },
      data: { status: "APPROVED", approvedAt: now, notes: note ?? reward.notes },
      select: { id: true, status: true, amount: true, period: true },
    });

    await tx.auditLog.create({
      data: {
        actorUserId,
        action: "reward.approve",
        entityType: "Reward",
        entityId: reward.id,
        before: { status: reward.status },
        after: {
          status: updated.status,
          amount: updated.amount.toFixed(2),
          period: updated.period,
          ledgerReference: entry.reference,
        },
        ipAddress: meta?.ipAddress ?? null,
      },
    });
    return {
      id: updated.id,
      status: updated.status,
      amount: updated.amount.toFixed(2),
      period: updated.period,
      transactionId: entry.id,
    };
  });

  return result;
}

/**
 * APPROVED -> PAID. This is the only path that moves money into the spendable
 * balance. A second payout attempt for the same reward is rejected, so a cron
 * running twice can never credit the same period twice.
 */
export async function payReward(
  rewardId: string,
  actorUserId: string | null,
  meta?: RequestMeta,
): Promise<RewardActionResult> {
  const result = await prisma.$transaction(async (tx) => {
    const reward = await loadReward(tx, rewardId);
    if (reward.status === "PAID") {
      throw new RewardError("REWARD_ALREADY_PAID", "Imbalan ini sudah dibayar.", 409);
    }
    if (reward.status !== "APPROVED") {
      throw new RewardError(
        "INVALID_REWARD_STATUS",
        `Hanya imbalan APPROVED yang dapat dibayar (status saat ini: ${reward.status}).`,
        409,
      );
    }

    const now = new Date();

    await postLedgerEntry(tx, {
      userId: reward.userId,
      userProgramId: reward.userProgramId,
      type: "REWARD",
      bucket: "PENDING",
      amount: reward.amount.negated(),
      currency: reward.currency,
      reference: `reward:${reward.id}:release`,
      description: `Imbalan Minggu ${reward.period} dikeluarkan dari saldo menunggu`,
      metadata: { rewardId: reward.id },
    });

    const paid = await postLedgerEntry(tx, {
      userId: reward.userId,
      userProgramId: reward.userProgramId,
      type: "REWARD",
      bucket: "AVAILABLE",
      amount: reward.amount,
      currency: reward.currency,
      reference: `reward:${reward.id}:paid`,
      description: `Imbalan Minggu ${reward.period} dibayar (${reward.userProgram.tier.code})`,
      metadata: { rewardId: reward.id, period: reward.period, cycleNumber: reward.cycleNumber },
      totalEarnedDelta: reward.amount,
    });

    const updated = await tx.reward.update({
      where: { id: reward.id },
      data: { status: "PAID", paidAt: now, transactionId: paid.id },
      select: { id: true, status: true, amount: true, period: true, transactionId: true },
    });

    const paidPeriods = await tx.reward.count({
      where: {
        userProgramId: reward.userProgramId,
        type: "WEEKLY",
        cycleNumber: reward.cycleNumber,
        status: "PAID",
      },
    });
    const membershipCompleted = paidPeriods >= reward.userProgram.cycleWeeks;

    await tx.userProgram.update({
      where: { id: reward.userProgramId },
      data: {
        weeksCompleted: paidPeriods,
        ...(membershipCompleted ? { status: "COMPLETED", completedAt: now } : {}),
      },
    });

    await tx.notification.create({
      data: {
        userId: reward.userId,
        type: "REWARD",
        title: `Imbalan dibayar: Minggu ${reward.period}`,
        body: `Imbalan Minggu ${reward.period} sebesar ${reward.currency} ${reward.amount.toFixed(2)} sudah dibayar ke saldo tersedia Anda.`,
        metadata: {
          rewardId: reward.id,
          transactionId: paid.id,
          period: reward.period,
          amount: reward.amount.toFixed(2),
          currency: reward.currency,
          href: "/rewards",
        },
      },
    });

    await tx.auditLog.create({
      data: {
        actorUserId,
        action: "reward.pay",
        entityType: "Reward",
        entityId: reward.id,
        before: { status: reward.status },
        after: {
          status: updated.status,
          amount: updated.amount.toFixed(2),
          period: updated.period,
          ledgerReference: paid.reference,
          weeksCompleted: paidPeriods,
        },
        ipAddress: meta?.ipAddress ?? null,
      },
    });

    return {
      id: updated.id,
      status: updated.status,
      amount: updated.amount.toFixed(2),
      period: updated.period,
      transactionId: paid.id,
      weeksCompleted: paidPeriods,
      membershipCompleted,
    };
  });

  return result;
}



/** PENDING -> REJECTED. No money moved, so nothing has to be reversed. */
export async function rejectReward(
  rewardId: string,
  actorUserId: string | null,
  reason: string,
  meta?: RequestMeta,
): Promise<RewardActionResult> {
  return prisma.$transaction(async (tx) => {
    const reward = await loadReward(tx, rewardId);
    if (reward.status !== "PENDING") {
      throw new RewardError(
        "INVALID_REWARD_STATUS",
        `Hanya reward PENDING yang dapat ditolak (status saat ini: ${reward.status}).`,
        409,
      );
    }

    const updated = await tx.reward.update({
      where: { id: reward.id },
      data: { status: "REJECTED", notes: reason },
      select: { id: true, status: true, amount: true, period: true },
    });

    await tx.notification.create({
      data: {
        userId: reward.userId,
        type: "REWARD",
        title: `Imbalan ditolak: Minggu ${reward.period}`,
        body: `Imbalan Minggu ${reward.period} ditolak. Alasan: ${reason}`,
        metadata: {
          rewardId: reward.id,
          period: reward.period,
          amount: reward.amount.toFixed(2),
          currency: reward.currency,
          reason,
          href: "/rewards",
        },
      },
    });

    await tx.auditLog.create({
      data: {
        actorUserId,
        action: "reward.reject",
        entityType: "Reward",
        entityId: reward.id,
        before: { status: reward.status },
        after: { status: updated.status, reason },
        ipAddress: meta?.ipAddress ?? null,
      },
    });

    return {
      id: updated.id,
      status: updated.status,
      amount: updated.amount.toFixed(2),
      period: updated.period,
      transactionId: null,
    };
  });
}

/**
 * Voids a reward. Money that was already paid is never deleted: an ADJUSTMENT
 * entry reverses it and the audit log keeps the reason, so the ledger stays a
 * complete history of what happened.
 */
export async function voidReward(
  rewardId: string,
  actorUserId: string | null,
  reason: string,
  meta?: RequestMeta,
): Promise<RewardActionResult> {
  return prisma.$transaction(async (tx) => {
    const reward = await loadReward(tx, rewardId);
    if (reward.status === "VOID") {
      throw new RewardError("REWARD_ALREADY_VOID", "Imbalan ini sudah dibatalkan (VOID).", 409);
    }

    let adjustmentId: string | null = null;

    if (reward.status === "PAID") {
      const adjustment = await postLedgerEntry(tx, {
        userId: reward.userId,
        userProgramId: reward.userProgramId,
        type: "ADJUSTMENT",
        bucket: "AVAILABLE",
        amount: reward.amount.negated(),
        currency: reward.currency,
        reference: `reward:${reward.id}:void`,
        description: `Pembalikan reward Minggu ${reward.period}: ${reason}`,
        metadata: { rewardId: reward.id, reason, reversedStatus: reward.status },
        totalReversedDelta: reward.amount,
      });
      adjustmentId = adjustment.id;
    } else if (reward.status === "APPROVED") {
      const adjustment = await postLedgerEntry(tx, {
        userId: reward.userId,
        userProgramId: reward.userProgramId,
        type: "ADJUSTMENT",
        bucket: "PENDING",
        amount: reward.amount.negated(),
        currency: reward.currency,
        reference: `reward:${reward.id}:void`,
        description: `Pelepasan reward Minggu ${reward.period} yang sudah disetujui: ${reason}`,
        metadata: { rewardId: reward.id, reason, reversedStatus: reward.status },
      });
      adjustmentId = adjustment.id;
    }

    const updated = await tx.reward.update({
      where: { id: reward.id },
      data: { status: "VOID", notes: reason },
      select: { id: true, status: true, amount: true, period: true },
    });

    const paidPeriods = await tx.reward.count({
      where: {
        userProgramId: reward.userProgramId,
        type: "WEEKLY",
        cycleNumber: reward.cycleNumber,
        status: "PAID",
      },
    });

    await tx.userProgram.update({
      where: { id: reward.userProgramId },
      data: {
        weeksCompleted: paidPeriods,
        ...(reward.userProgram.status === "COMPLETED" && paidPeriods < reward.userProgram.cycleWeeks
          ? { status: "ACTIVE", completedAt: null }
          : {}),
      },
    });

    await tx.auditLog.create({
      data: {
        actorUserId,
        action: "reward.void",
        entityType: "Reward",
        entityId: reward.id,
        before: { status: reward.status },
        after: {
          status: updated.status,
          reason,
          adjustmentTransactionId: adjustmentId,
          weeksCompleted: paidPeriods,
        },
        ipAddress: meta?.ipAddress ?? null,
      },
    });

    return {
      id: updated.id,
      status: updated.status,
      amount: updated.amount.toFixed(2),
      period: updated.period,
      transactionId: adjustmentId,
      weeksCompleted: paidPeriods,
      membershipCompleted: false,
    };
  });
}

export interface RewardView {
  id: string;
  userProgramId: string;
  tierCode: string;
  period: number;
  cycleNumber: number;
  amount: string;
  rate: string;
  status: RewardStatus;
  scheduledFor: Date | null;
  approvedAt: Date | null;
  paidAt: Date | null;
  transactionId: string | null;
  createdAt: Date;
}

const REWARD_VIEW_SELECT = {
  id: true,
  userProgramId: true,
  period: true,
  cycleNumber: true,
  amount: true,
  rate: true,
  status: true,
  scheduledFor: true,
  approvedAt: true,
  paidAt: true,
  transactionId: true,
  createdAt: true,
  tier: { select: { code: true } },
} satisfies Prisma.RewardSelect;

type RewardViewRow = Prisma.RewardGetPayload<{ select: typeof REWARD_VIEW_SELECT }>;

function toRewardView(row: RewardViewRow): RewardView {
  return {
    id: row.id,
    userProgramId: row.userProgramId,
    tierCode: row.tier.code,
    period: row.period,
    cycleNumber: row.cycleNumber,
    amount: row.amount.toFixed(2),
    rate: row.rate.toFixed(4),
    status: row.status,
    scheduledFor: row.scheduledFor,
    approvedAt: row.approvedAt,
    paidAt: row.paidAt,
    transactionId: row.transactionId,
    createdAt: row.createdAt,
  };
}

/** Reward rows of a user, newest period first. */
export async function listRewards(
  userId: string,
  options?: { userProgramId?: string; take?: number },
): Promise<RewardView[]> {
  const rows = await prisma.reward.findMany({
    where: { userId, ...(options?.userProgramId ? { userProgramId: options.userProgramId } : {}) },
    orderBy: [{ cycleNumber: "desc" }, { period: "desc" }, { createdAt: "desc" }],
    take: options?.take ?? 40,
    select: REWARD_VIEW_SELECT,
  });
  return rows.map(toRewardView);
}

export interface RewardOverview {
  /** Latest recorded period that is not rejected or void. */
  currentReward: RewardView | null;
  /** Earliest reward that is still waiting for approval or payout. */
  nextReward: RewardView | null;
  totals: { pending: string; approved: string; paid: string; rejected: string; void: string };
  counts: Record<RewardStatus, number>;
}

function emptyCounts(): Record<RewardStatus, number> {
  return { PENDING: 0, APPROVED: 0, PAID: 0, REJECTED: 0, VOID: 0 };
}

/** Current + next reward and per-status totals, all read from the database. */
export async function getRewardOverview(userId: string): Promise<RewardOverview> {
  const rows = await prisma.reward.findMany({
    where: { userId },
    orderBy: [{ cycleNumber: "desc" }, { period: "desc" }, { createdAt: "desc" }],
    take: 200,
    select: REWARD_VIEW_SELECT,
  });

  const rewards = rows.map(toRewardView);
  const counts = emptyCounts();
  const totals = {
    pending: new Prisma.Decimal(0),
    approved: new Prisma.Decimal(0),
    paid: new Prisma.Decimal(0),
    rejected: new Prisma.Decimal(0),
    void: new Prisma.Decimal(0),
  };

  for (const reward of rewards) {
    counts[reward.status] += 1;
    const amount = new Prisma.Decimal(reward.amount);
    if (reward.status === "PENDING") totals.pending = totals.pending.plus(amount);
    if (reward.status === "APPROVED") totals.approved = totals.approved.plus(amount);
    if (reward.status === "PAID") totals.paid = totals.paid.plus(amount);
    if (reward.status === "REJECTED") totals.rejected = totals.rejected.plus(amount);
    if (reward.status === "VOID") totals.void = totals.void.plus(amount);
  }

  const currentReward =
    rewards.find((reward) => reward.status !== "REJECTED" && reward.status !== "VOID") ?? null;

  const nextReward =
    [...rewards]
      .filter((reward) => reward.status === "PENDING" || reward.status === "APPROVED")
      .sort((a, b) => {
        const aDate = (a.scheduledFor ?? a.createdAt).getTime();
        const bDate = (b.scheduledFor ?? b.createdAt).getTime();
        return aDate - bDate;
      })
      .at(0) ?? null;

  return {
    currentReward,
    nextReward,
    totals: {
      pending: totals.pending.toFixed(2),
      approved: totals.approved.toFixed(2),
      paid: totals.paid.toFixed(2),
      rejected: totals.rejected.toFixed(2),
      void: totals.void.toFixed(2),
    },
    counts,
  };
}



export interface ProgramPeriodView {
  period: number;
  amount: string;
  status: RewardStatus | "NOT_RECORDED";
  scheduledFor: Date | null;
  rewardId: string | null;
}

export interface ProgramProgressView {
  userProgramId: string;
  tierCode: string;
  tierName: string;
  status: UserProgramStatus;
  joinAmount: string;
  currency: string;
  weeklyRewardRate: string;
  cycleWeeks: number;
  cycleNumber: number;
  /** `joinAmount * weeklyRewardRate` — a target, not a guarantee. */
  weeklyTarget: string;
  /** Weekly target * cycle weeks, capped by the configured maximum. */
  cycleTarget: string;
  startDate: Date | null;
  currentWeek: number;
  weeksCompleted: number;
  percentComplete: number;
  nextRewardDate: Date | null;
  currentReward: { period: number; amount: string; status: RewardStatus } | null;
  periods: ProgramPeriodView[];
  fundsConfirmedAt: Date | null;
  fundsConfirmedAmount: string;
  eligibility: EligibilityResult;
}

const PROGRESS_SELECT = {
  id: true,
  joinAmount: true,
  currency: true,
  status: true,
  weeklyRewardRate: true,
  cycleWeeks: true,
  maxCycleRewardRate: true,
  cycleNumber: true,
  weeksCompleted: true,
  activatedAt: true,
  joinedAt: true,
  fundsConfirmedAt: true,
  fundsConfirmedAmount: true,
  tier: { select: { code: true, name: true } },
  program: { select: { status: true } },
  rewards: {
    orderBy: [{ cycleNumber: "desc" }, { period: "desc" }],
    select: {
      id: true,
      period: true,
      cycleNumber: true,
      amount: true,
      status: true,
      scheduledFor: true,
    },
  },
} satisfies Prisma.UserProgramSelect;

/**
 * Week 1..N view of every membership of a user: start date, current week, next
 * reward date, current reward, target reward and cycle progress.
 */
export async function getProgramProgress(userId: string): Promise<ProgramProgressView[]> {
  const [user, memberships] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { status: true } }),
    prisma.userProgram.findMany({
      where: { userId },
      orderBy: [{ joinedAt: "desc" }, { id: "asc" }],
      select: PROGRESS_SELECT,
    }),
  ]);

  const userStatus: UserStatus = user?.status ?? "CLOSED";

  return memberships.map((membership) => {
    const eligibility = evaluateRewardEligibility({
      membershipStatus: membership.status,
      fundsConfirmedAt: membership.fundsConfirmedAt,
      fundsConfirmedAmount: membership.fundsConfirmedAmount,
      joinAmount: membership.joinAmount,
      programStatus: membership.program.status,
      userStatus,
    });

    const { target: weeklyTarget } = calculateWeeklyReward({
      amount: membership.joinAmount,
      weeklyRate: membership.weeklyRewardRate,
      eligibility: eligibility.eligible,
      programStatus: membership.status,
    });

    const cycleTarget = cycleRewardTarget(
      weeklyTarget,
      membership.cycleWeeks,
      membership.maxCycleRewardRate,
      membership.joinAmount,
    );

    const startDate = membership.activatedAt;
    const progress = cycleProgress(startDate, membership.cycleWeeks);
    const currentCycleRewards = membership.rewards.filter(
      (reward) => reward.cycleNumber === membership.cycleNumber,
    );

    const periods: ProgramPeriodView[] = Array.from(
      { length: membership.cycleWeeks },
      (_, index) => {
        const period = index + 1;
        const reward = currentCycleRewards.find((row) => row.period === period);
        return {
          period,
          amount: reward ? reward.amount.toFixed(2) : weeklyTarget.toFixed(2),
          status: reward ? reward.status : ("NOT_RECORDED" as const),
          scheduledFor:
            reward?.scheduledFor ??
            (startDate ? rewardDateFor(startDate, period, membership.cycleWeeks) : null),
          rewardId: reward?.id ?? null,
        };
      },
    );

    const currentPeriodReward = currentCycleRewards.find(
      (reward) => reward.period === progress.currentWeek,
    );
    const latestRecorded =
      currentPeriodReward ??
      currentCycleRewards.find((reward) => reward.status !== "VOID" && reward.status !== "REJECTED") ??
      null;

    const nextRewardDate =
      currentPeriodReward?.scheduledFor ??
      (startDate && progress.currentWeek > 0
        ? rewardDateFor(startDate, progress.currentWeek, membership.cycleWeeks)
        : null);

    return {
      userProgramId: membership.id,
      tierCode: membership.tier.code,
      tierName: membership.tier.name,
      status: membership.status,
      joinAmount: membership.joinAmount.toFixed(2),
      currency: membership.currency,
      weeklyRewardRate: membership.weeklyRewardRate.toFixed(4),
      cycleWeeks: membership.cycleWeeks,
      cycleNumber: membership.cycleNumber,
      weeklyTarget: weeklyTarget.toFixed(2),
      cycleTarget: cycleTarget.toFixed(2),
      startDate,
      currentWeek: progress.currentWeek,
      weeksCompleted: membership.weeksCompleted,
      percentComplete: progress.percentComplete,
      nextRewardDate,
      currentReward: latestRecorded
        ? {
            period: latestRecorded.period,
            amount: latestRecorded.amount.toFixed(2),
            status: latestRecorded.status,
          }
        : null,
      periods,
      fundsConfirmedAt: membership.fundsConfirmedAt,
      fundsConfirmedAmount: membership.fundsConfirmedAmount.toFixed(2),
      eligibility,
    };
  });
}
