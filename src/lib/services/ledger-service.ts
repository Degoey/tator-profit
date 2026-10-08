import { Prisma, type TransactionStatus, type TransactionType } from "@prisma/client";

import { prisma } from "@/lib/prisma";

/**
 * Append-only transaction ledger.
 *
 * Every entry records the signed delta applied to exactly one balance bucket, so
 * `balance.bucket === sum(ledger entries for that bucket)`. Rows are never
 * deleted or edited: PostgreSQL enforces this with the `Transaction_append_only`
 * trigger. Corrections are appended with type ADJUSTMENT.
 */

export type LedgerBucket = "AVAILABLE" | "PENDING" | "PROGRAM_FUNDS" | "RESERVED" | "NONE";

export type LedgerClient = Prisma.TransactionClient;

const BUCKET_FIELD = {
  AVAILABLE: "availableAmount",
  PENDING: "pendingAmount",
  PROGRAM_FUNDS: "programFundsAmount",
  RESERVED: "reservedAmount",
} as const;

export class LedgerError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "LedgerError";
    this.code = code;
  }
}

function bucketValue(
  balance: {
    availableAmount: Prisma.Decimal;
    pendingAmount: Prisma.Decimal;
    programFundsAmount: Prisma.Decimal;
    reservedAmount: Prisma.Decimal;
  },
  bucket: LedgerBucket,
): Prisma.Decimal {
  if (bucket === "NONE") return balance.availableAmount;
  return balance[BUCKET_FIELD[bucket]];
}

/** Creates the balance row on first use so a brand new account reads as 0,00 USDT. */
export async function ensureBalance(client: LedgerClient, userId: string, currency = "USDT") {
  return client.balance.upsert({
    where: { userId },
    update: {},
    create: { userId, currency },
  });
}

export interface LedgerEntryInput {
  userId: string;
  userProgramId?: string | null;
  type: TransactionType;
  /** Balance bucket the delta applies to. `NONE` records a non-monetary event. */
  bucket?: LedgerBucket;
  /** Signed delta for the bucket (negative debits, positive credits). */
  amount: Prisma.Decimal;
  currency?: string;
  reference: string;
  description?: string;
  metadata?: Prisma.InputJsonValue;
  status?: TransactionStatus;
  /** Bookkeeping counters that move together with this entry. */
  totalEarnedDelta?: Prisma.Decimal;
  totalReversedDelta?: Prisma.Decimal;
}

/**
 * Appends one ledger entry and moves the matching balance bucket in the same
 * database transaction. The caller supplies the transaction client, so a ledger
 * entry can never be committed without its balance change.
 */
export async function postLedgerEntry(client: LedgerClient, input: LedgerEntryInput) {
  const bucket = input.bucket ?? "NONE";
  const currency = input.currency ?? "USDT";
  const amount = input.amount.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const balance = await ensureBalance(client, input.userId, currency);
  const before = bucketValue(balance, bucket);
  const after = bucket === "NONE" ? before : before.plus(amount);

  if (after.isNegative()) {
    throw new LedgerError(
      "INSUFFICIENT_BALANCE",
      `Entri buku besar akan membuat saldo ${bucket} menjadi minus.`,
    );
  }

  if (bucket !== "NONE" || input.totalEarnedDelta || input.totalReversedDelta) {
    await client.balance.update({
      where: { userId: input.userId },
      data: {
        ...(bucket === "NONE" ? {} : { [BUCKET_FIELD[bucket]]: after }),
        ...(input.totalEarnedDelta ? { totalEarned: { increment: input.totalEarnedDelta } } : {}),
        ...(input.totalReversedDelta
          ? { totalReversed: { increment: input.totalReversedDelta } }
          : {}),
      },
    });
  }

  return client.transaction.create({
    data: {
      userId: input.userId,
      userProgramId: input.userProgramId ?? null,
      type: input.type,
      status: input.status ?? "POSTED",
      bucket,
      amount,
      currency,
      balanceBefore: before,
      balanceAfter: after,
      reference: input.reference,
      description: input.description,
      metadata: input.metadata,
      postedAt: input.status === "PENDING" ? null : new Date(),
    },
  });
}

/** Balance of a user; a missing row reads as zeros (new account shows 0,00 USDT). */
export async function getBalance(userId: string) {
  const balance = await prisma.balance.findUnique({ where: { userId } });
  return (
    balance ?? {
      availableAmount: new Prisma.Decimal(0),
      pendingAmount: new Prisma.Decimal(0),
      programFundsAmount: new Prisma.Decimal(0),
      reservedAmount: new Prisma.Decimal(0),
      totalEarned: new Prisma.Decimal(0),
      totalReversed: new Prisma.Decimal(0),
      currency: "USDT",
    }
  );
}

/** Ledger history for the dashboard, newest first. */
export async function listTransactions(userId: string, limit = 10) {
  return prisma.transaction.findMany({
    where: { userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
    select: {
      id: true,
      type: true,
      status: true,
      bucket: true,
      amount: true,
      currency: true,
      balanceAfter: true,
      reference: true,
      description: true,
      postedAt: true,
      createdAt: true,
    },
  });
}

/**
 * Integrity check used by tests and ops: every POSTED ledger entry must be
 * reflected in the balance buckets it targets.
 */
export async function verifyBalanceInvariant(client: LedgerClient, userId: string) {
  const entries = await client.transaction.findMany({
    where: { userId, status: "POSTED" },
    select: { bucket: true, amount: true },
  });
  const balance = await ensureBalance(client, userId);
  const sums = {
    AVAILABLE: new Prisma.Decimal(0),
    PENDING: new Prisma.Decimal(0),
    PROGRAM_FUNDS: new Prisma.Decimal(0),
    RESERVED: new Prisma.Decimal(0),
  };

  for (const entry of entries) {
    if (
      entry.bucket === "AVAILABLE" ||
      entry.bucket === "PENDING" ||
      entry.bucket === "PROGRAM_FUNDS" ||
      entry.bucket === "RESERVED"
    ) {
      sums[entry.bucket] = sums[entry.bucket].plus(entry.amount);
    }
  }

  const checks = (Object.keys(sums) as (keyof typeof sums)[]).map((bucket) => ({
    bucket,
    ledger: sums[bucket].toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2),
    balance: balance[BUCKET_FIELD[bucket]].toFixed(2),
  }));

  return { ok: checks.every((check) => check.ledger === check.balance), checks };
}
