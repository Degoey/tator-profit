import type { Prisma } from "@prisma/client";

import { canAdmin } from "@/lib/auth/admin-permissions";
import {
  FRAUD_SIGNAL_LABELS,
  REFERRER_BURST_MIN_COUNT,
  REFERRER_BURST_WINDOW_MS,
  SHARED_BANK_ACCOUNT_MIN_COUNT,
  SHARED_IP_MIN_COUNT,
  SHARED_IP_WINDOW_MS,
  FRAUD_STATUS_LABELS,
  fraudSignalLabel,
  trustedIpAddress,
  type FraudSignal,
} from "@/lib/config/anti-fraud";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/security";

/** Audit action written for every anti-fraud decision (open, cleared, confirmed). */
export const FRAUD_AUDIT_ACTIONS = {
  flagged: "fraud.flagged",
  cleared: "fraud.review.cleared",
  confirmed: "fraud.review.confirmed",
} as const;

export class FraudReviewError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "FraudReviewError";
    this.code = code;
    this.status = status;
  }
}

/** Evaluates the registration signals; extra keys are ignored by the caller. */
export interface FraudSignalResult {
  signals: FraudSignal[];
  relatedUserIds: string[];
}

export function emptyFraudSignalResult(): FraudSignalResult {
  return { signals: [], relatedUserIds: [] };
}

/** One subject row for the admin queue, already reduced to safe display fields. */
export interface FraudReviewCaseView {
  id: string;
  status: string;
  statusLabel: string;
  signals: string[];
  signalLabels: string[];
  note: string | null;
  reviewedAt: Date | null;
  reviewerUsername: string | null;
  createdAt: Date;
  user: {
    id: string;
    name: string;
    username: string;
    email: string;
    phone: string;
    status: string;
    createdAt: Date;
  };
  relatedUsers: { id: string; name: string; username: string }[];
}

/**
 * Query surface used to evaluate the registration signals. Keeping it behind an
 * interface makes the decision logic pure and testable without a database while
 * the real implementation still runs one set of indexed queries.
 */
export interface SignalQueries {
  /** Other accounts that already registered the same bank/e-wallet number. */
  otherUsersWithSameBankAccount(bankAccountNumber: string, userId: string): Promise<string[]>;
  /** Other accounts created from the same address inside the shared-IP window. */
  otherUsersWithSameIpAddress(ip: string, userId: string, since: Date): Promise<string[]>;
  referrerDetails(referrerId: string): Promise<{
    bank?: string | null;
    bankAccountNumber: string | null;
    registrationIp: string | null;
  } | null>;
  /** Referrals attributed to one referrer since the given instant (inclusive). */
  countReferralsSince(referrerId: string, since: Date): Promise<number>;
}

export function createPrismaSignalQueries(tx: Prisma.TransactionClient, bank: string): SignalQueries {
  return {
    async otherUsersWithSameBankAccount(bankAccountNumber, userId) {
      const rows = await tx.user.findMany({
        where: { bank, bankAccountNumber, id: { not: userId } },
        select: { id: true },
        take: 50,
      });
      return rows.map((row) => row.id);
    },

    async otherUsersWithSameIpAddress(ip, userId, since) {
      const rows = await tx.user.findMany({
        where: { registrationIp: ip, id: { not: userId }, createdAt: { gte: since } },
        select: { id: true },
        take: 50,
      });
      return rows.map((row) => row.id);
    },

    async referrerDetails(referrerId) {
      return tx.user.findFirst({
        where: { id: referrerId },
        select: { bank: true, bankAccountNumber: true, registrationIp: true },
      });
    },

    async countReferralsSince(referrerId, since) {
      return tx.referral.count({ where: { referrerId, createdAt: { gte: since } } });
    },
  };
}

export interface FraudFlagInput {
  userId: string;
  /** Bank/e-wallet code; two accounts only collide when both the code and number match. */
  bank: string;
  bankAccountNumber: string | null;
  referrerId: string | null;
  meta: RequestMeta;
  /** Injectable clock keeps the burst window deterministic in tests. */
  now?: Date;
}

/**
 * Evaluates and records the registration signals inside the caller's transaction,
 * so the account, its referral row and its fraud case are committed atomically.
 * Returns the empty result (and writes nothing) when no rule fires.
 */
export async function flagRegistrationInTransaction(
  tx: Prisma.TransactionClient,
  input: FraudFlagInput,
): Promise<FraudSignalResult> {
  const result = await evaluateRegistrationSignals({
    userId: input.userId,
    bank: input.bank,
    bankAccountNumber: input.bankAccountNumber,
    referrerId: input.referrerId,
    ipAddress: trustedIpAddress(input.meta),
    queries: createPrismaSignalQueries(tx, input.bank),
    now: input.now,
  });

  if (result.signals.length === 0) return emptyFraudSignalResult();

  const labels = result.signals.map((signal) => FRAUD_SIGNAL_LABELS[signal]);

  await tx.fraudReview.create({
    data: {
      userId: input.userId,
      signals: result.signals,
      relatedUserIds: result.relatedUserIds,
    },
  });

  await tx.securityEvent.create({
    data: {
      userId: input.userId,
      type: "FRAUD_FLAGGED",
      severity: "WARNING",
      description: `Sinyal anti-fraud saat pendaftaran: ${labels.join(", ")}`,
      ipAddress: input.meta.ipAddress,
      userAgent: input.meta.userAgent,
      metadata: { signals: result.signals, relatedUserIds: result.relatedUserIds },
    },
  });

  await tx.auditLog.create({
    data: {
      actorUserId: input.userId,
      action: FRAUD_AUDIT_ACTIONS.flagged,
      entityType: "FraudReview",
      entityId: input.userId,
      after: { signals: result.signals, relatedUserIds: result.relatedUserIds },
      ipAddress: input.meta.ipAddress,
      userAgent: input.meta.userAgent,
    },
  });

  return result;
}

export interface RegistrationSignalContext {
  /** Account that has just been created and is being evaluated. */
  userId: string;
  bank: string;
  bankAccountNumber: string | null;
  referrerId: string | null;
  /** Only ever non-null behind an explicitly trusted proxy. */
  ipAddress: string | null;
  queries: SignalQueries;
  /** Injectable clock keeps the windowed rules deterministic in tests. */
  now?: Date;
}

/**
 * Derives the anti-fraud signals of one registration. It is deliberately
 * conservative: every rule needs corroborating data (a shared account number, a
 * repeated address, a burst through one referrer) and never treats a single
 * coincidence as proof. The result only opens a case for a human to read.
 */
export async function evaluateRegistrationSignals(
  context: RegistrationSignalContext,
): Promise<FraudSignalResult> {
  const now = context.now ?? new Date();
  const signals = new Set<FraudSignal>();
  const related = new Set<string>();

  if (context.bankAccountNumber) {
    const others = await context.queries.otherUsersWithSameBankAccount(
      context.bankAccountNumber,
      context.userId,
    );
    if (others.length + 1 >= SHARED_BANK_ACCOUNT_MIN_COUNT) {
      signals.add("SHARED_BANK_ACCOUNT");
      for (const id of others) related.add(id);
    }
  }

  if (context.ipAddress) {
    const since = new Date(now.getTime() - SHARED_IP_WINDOW_MS);
    const others = await context.queries.otherUsersWithSameIpAddress(
      context.ipAddress,
      context.userId,
      since,
    );
    if (others.length + 1 >= SHARED_IP_MIN_COUNT) {
      signals.add("SHARED_IP");
      for (const id of others) related.add(id);
    }
  }

  if (context.referrerId) {
    const referrer = await context.queries.referrerDetails(context.referrerId);
    if (referrer) {
      if (context.ipAddress && referrer.registrationIp === context.ipAddress) {
        signals.add("SAME_IP_AS_REFERRER");
        related.add(context.referrerId);
      }
      if (context.bankAccountNumber && referrer.bank === context.bank && referrer.bankAccountNumber === context.bankAccountNumber) {
        signals.add("SAME_BANK_AS_REFERRER");
        related.add(context.referrerId);
      }
    }

    const burstSince = new Date(now.getTime() - REFERRER_BURST_WINDOW_MS);
    const burst = await context.queries.countReferralsSince(context.referrerId, burstSince);
    if (burst >= REFERRER_BURST_MIN_COUNT) {
      signals.add("REFERRER_BURST");
      related.add(context.referrerId);
    }
  }

  related.delete(context.userId);

  return { signals: [...signals], relatedUserIds: [...related] };
}

export interface ReviewFraudCaseInput {
  caseId: string;
  decision: "CLEARED" | "CONFIRMED";
  note: string;
  actorUserId: string;
  actorAdminRole: Parameters<typeof canAdmin>[0];
  meta?: RequestMeta;
}

/**
 * Pure decision helper shared by the queue and the tests: a case may only move
 * away from OPEN, and only by an administrator holding `reviewFraud`.
 */
export function validateFraudDecision(input: {
  currentStatus: string;
  decision: string;
  note: string;
  actorAdminRole: Parameters<typeof canAdmin>[0];
}): "CLEARED" | "CONFIRMED" {
  if (!canAdmin(input.actorAdminRole, "reviewFraud")) {
    throw new FraudReviewError(
      "FORBIDDEN",
      "Hanya administrator berwenang (Super Admin atau Kepatuhan) yang dapat menutup tinjauan.",
      403,
    );
  }

  if (input.decision !== "CLEARED" && input.decision !== "CONFIRMED") {
    throw new FraudReviewError("INVALID_DECISION", "Keputusan tinjauan tidak dikenal.", 422);
  }

  if (input.currentStatus !== "OPEN") {
    throw new FraudReviewError(
      "CASE_CLOSED",
      "Kasus ini sudah ditutup dan tidak dapat ditinjau ulang.",
      409,
    );
  }

  const note = input.note?.trim() ?? "";
  if (note.length < 10) {
    throw new FraudReviewError(
      "NOTE_REQUIRED",
      "Tuliskan alasan minimal 10 karakter sebelum menutup kasus.",
      422,
    );
  }
  if (note.length > 500) {
    throw new FraudReviewError("NOTE_TOO_LONG", "Alasan maksimal 500 karakter.", 422);
  }

  return input.decision;
}

/**
 * Loads the review queue. Every role with `readFraud` may see it; the page
 * decides whether the decision buttons render. Related accounts are resolved to
 * name/username only, never to private data.
 */
export async function listFraudCases(
  status: "OPEN" | "CLEARED" | "CONFIRMED" | "ALL" = "OPEN",
): Promise<FraudReviewCaseView[]> {
  const rows = await prisma.fraudReview.findMany({
    where: status === "ALL" ? {} : { status },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      user: {
        select: {
          id: true,
          name: true,
          username: true,
          email: true,
          phone: true,
          status: true,
          createdAt: true,
        },
      },
      reviewer: { select: { username: true } },
    },
  });

  const relatedIds = [...new Set(rows.flatMap((row) => row.relatedUserIds))];
  const relatedUsers = relatedIds.length
    ? await prisma.user.findMany({
        where: { id: { in: relatedIds } },
        select: { id: true, name: true, username: true },
      })
    : [];
  const relatedById = new Map(relatedUsers.map((user) => [user.id, user]));

  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    statusLabel: FRAUD_STATUS_LABELS[row.status] ?? row.status,
    signals: row.signals,
    signalLabels: row.signals.map((signal) => fraudSignalLabel(signal)),
    note: row.reviewNote,
    reviewedAt: row.reviewedAt,
    reviewerUsername: row.reviewer?.username ?? null,
    createdAt: row.createdAt,
    user: row.user,
    relatedUsers: row.relatedUserIds
      .map((id) => relatedById.get(id))
      .filter((user): user is { id: string; name: string; username: string } => Boolean(user)),
  }));
}

export async function countOpenFraudCases(): Promise<number> {
  return prisma.fraudReview.count({ where: { status: "OPEN" } });
}

export interface ReviewFraudCaseResult {
  id: string;
  status: "CLEARED" | "CONFIRMED";
  note: string;
  reviewedAt: Date;
}

/**
 * Closes one open case. A mandatory note records *why*, and one audit row keeps
 * the before/after state so a decision can always be traced. Deciding a case
 * never touches a balance: `CONFIRMED` only marks the account for a human to act
 * on through the normal suspension/withdrawal controls.
 */
export async function reviewFraudCase(input: ReviewFraudCaseInput): Promise<ReviewFraudCaseResult> {
  const existing = await prisma.fraudReview.findUnique({
    where: { id: input.caseId },
    select: { id: true, status: true, userId: true, signals: true },
  });

  if (!existing) {
    throw new FraudReviewError("CASE_NOT_FOUND", "Kasus tinjauan tidak ditemukan.", 404);
  }

  const decision = validateFraudDecision({
    currentStatus: existing.status,
    decision: input.decision,
    note: input.note,
    actorAdminRole: input.actorAdminRole,
  });

  const note = input.note.trim();
  const reviewedAt = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.fraudReview.update({
      where: { id: existing.id },
      data: {
        status: decision,
        reviewerId: input.actorUserId,
        reviewNote: note,
        reviewedAt,
      },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        action:
          decision === "CLEARED" ? FRAUD_AUDIT_ACTIONS.cleared : FRAUD_AUDIT_ACTIONS.confirmed,
        entityType: "FraudReview",
        entityId: existing.id,
        before: { status: existing.status, signals: existing.signals },
        after: { status: decision, note },
        ipAddress: input.meta?.ipAddress ?? null,
        userAgent: input.meta?.userAgent ?? null,
      },
    });
  });

  return { id: existing.id, status: decision, note, reviewedAt };
}