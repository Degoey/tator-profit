import {
  Prisma,
  type PrismaClient,
  type ProgramStatus,
  type ReferralCommissionStatus,
  type TransactionStatus,
  type TransactionType,
  type UserProgramStatus,
} from "@prisma/client";

import {
  REFERRAL_COMMISSION_STATUSES,
  REFERRAL_DEPTH,
  REFERRAL_ELIGIBLE_EVENT,
  isValidReferralLevel,
  normalizeReferralCode,
  referralRateForLevel,
  type ReferralEligibleEventConfig,
} from "@/lib/config/referral";
import { MAX_MONEY, MONEY_SCALE, toDecimal, type DecimalInput } from "@/lib/money";
import { getRebateRates, rebateRateForGeneration } from "@/lib/rebate-config";
import { prisma } from "@/lib/prisma";
import {
  loadReferralNetwork,
  type NetworkNode,
  type ReferralNetwork,
} from "@/lib/referral-network";
import type { RequestMeta } from "@/lib/security";
import { postLedgerEntry } from "@/lib/services/ledger-service";

/** Only call with the authenticated account as root. Exposes usernames, not contact data. */
export async function getReferralNetwork(root: {
  id: string;
  username: string;
}): Promise<ReferralNetwork> {
  return loadReferralNetwork(root, (parentIds, take) =>
    prisma.referral.findMany({
      where: { referrerId: { in: parentIds }, status: "ACTIVE" },
      select: {
        referrerId: true,
        referredUser: { select: { id: true, username: true } },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take,
    }),
  );
}

export class ReferralError extends Error {
  readonly code: string;
  /** Suggested HTTP status for API surfaces (403 for authorisation failures). */
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "ReferralError";
    this.code = code;
    this.status = status;
  }
}

export type TransactionClient = Prisma.TransactionClient;

/** Client that can read and write referrals: the pool or an open transaction. */
export type ReferralClient = Prisma.TransactionClient | PrismaClient;

/**
 * Advisory lock key for referral tree writes. Serialising referral inserts (they
 * only happen at registration) makes the cycle check safe against concurrent
 * writers: the second transaction sees the first committed edge and is rejected.
 * `pg_advisory_xact_lock` is released automatically when the transaction ends.
 */
export const REFERRAL_TREE_LOCK_SQL = "SELECT pg_advisory_xact_lock(hashtext('tatorprofit.referral.tree'))";

/** Upper bound for parent-chain walks; a healthy tree never comes close. */
export const MAX_TREE_WALK = 64;

/** Generates a unique, human readable referral code derived from the username. */
export async function generateUniqueReferralCode(
  username: string,
  client: Pick<PrismaClient, "profile"> | TransactionClient = prisma,
): Promise<string> {
  const base = username
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 12)
    .padEnd(4, "X");

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const suffix = Math.floor(Math.random() * 46_656)
      .toString(36)
      .toUpperCase()
      .padStart(3, "0");
    const candidate = `${base}-${suffix}`;
    const existing = await client.profile.findUnique({
      where: { referralCode: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
  }

  throw new ReferralError("CODE_GENERATION_FAILED", "Tidak dapat membuat kode rujukan unik.");
}

export interface ResolvedReferrer {
  userId: string;
  referralCode: string;
  username: string;
}

/** Resolves a share code to the owning (active) account. */
export async function findReferrerByCode(
  rawCode: string,
  client: Pick<PrismaClient, "profile"> | TransactionClient = prisma,
): Promise<ResolvedReferrer | null> {
  const code = normalizeReferralCode(rawCode);
  const profile = await client.profile.findUnique({
    where: { referralCode: code },
    select: {
      userId: true,
      referralCode: true,
      user: { select: { username: true, status: true } },
    },
  });

  if (!profile || profile.user.status !== "ACTIVE") return null;
  return {
    userId: profile.userId,
    referralCode: profile.referralCode,
    username: profile.user.username,
  };
}

/**
 * Walks up the parent chain of `userId` (bounded) and reports whether
 * `candidateAncestorId` is that user or one of its ancestors.
 */
export async function isSelfOrAncestor(
  userId: string,
  candidateAncestorId: string,
  client: ReferralClient = prisma,
): Promise<boolean> {
  if (userId === candidateAncestorId) return true;

  const visited = new Set<string>([userId]);
  let currentUserId = userId;

  for (let depth = 0; depth < MAX_TREE_WALK; depth += 1) {
    const parent = await client.referral.findUnique({
      where: { referredUserId: currentUserId },
      select: { referrerId: true },
    });
    if (!parent) return false;
    if (parent.referrerId === candidateAncestorId) return true;
    if (visited.has(parent.referrerId)) return false; // already cyclic data; stop
    visited.add(parent.referrerId);
    currentUserId = parent.referrerId;
  }

  return false;
}

/**
 * Validates a potential parent/child referral relationship.
 *
 * Rejects self references, accounts that already have a recorded parent and
 * every edge that would close a circle (the new referrer must not sit below the
 * referred account in the tree). Pass an open transaction client so the check
 * and the insert share one snapshot — `createReferral` always does.
 */
export async function assertValidReferralRelationship(
  referrerId: string,
  newUserId: string,
  client: ReferralClient = prisma,
): Promise<void> {
  if (referrerId === newUserId) {
    throw new ReferralError("SELF_REFERRAL", "Anda tidak dapat memakai kode rujukan Anda sendiri.");
  }

  const [existingParent, referrer] = await Promise.all([
    client.referral.findUnique({ where: { referredUserId: newUserId }, select: { id: true } }),
    client.user.findUnique({ where: { id: referrerId }, select: { status: true } }),
  ]);

  if (existingParent) {
    throw new ReferralError(
      "REFERRAL_ALREADY_SET",
      "Akun ini sudah memiliki hubungan rujukan yang tercatat.",
    );
  }
  if (!referrer || referrer.status !== "ACTIVE") {
    throw new ReferralError("REFERRER_NOT_ELIGIBLE", "Akun perujuk tidak aktif atau tidak ditemukan.");
  }

  if (await isSelfOrAncestor(referrerId, newUserId, client)) {
    throw new ReferralError(
      "REFERRAL_CYCLE",
      "Hubungan rujukan ini akan membentuk lingkaran (akun sudah berada di bawah calon perujuk).",
    );
  }
}

export interface CreateReferralInput {
  referrerId: string;
  referredUserId: string;
  codeUsed: string;
}

/**
 * Records the referral relationship. Referral rows are immutable by design —
 * changing an official relationship requires an audited admin process.
 *
 * The whole check-and-insert runs inside the caller's transaction and behind a
 * PostgreSQL advisory lock, so two concurrent registrations can never commit an
 * edge that closes a circle: the second transaction waits for the lock, then
 * sees the first edge and is rejected.
 */
export async function createReferral(
  client: TransactionClient,
  input: CreateReferralInput,
): Promise<{ id: string }> {
  await client.$executeRawUnsafe(REFERRAL_TREE_LOCK_SQL);
  await assertValidReferralRelationship(input.referrerId, input.referredUserId, client);

  try {
    return await client.referral.create({
      data: {
        referrerId: input.referrerId,
        referredUserId: input.referredUserId,
        codeUsed: normalizeReferralCode(input.codeUsed),
        level: 1,
        status: "ACTIVE",
      },
      select: { id: true },
    });
  } catch (error) {
    // The database unique keys are the last line of defence.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ReferralError(
        "REFERRAL_ALREADY_SET",
        "Akun ini sudah memiliki hubungan rujukan yang tercatat.",
      );
    }
    throw error;
  }
}

export interface UplineEntry {
  userId: string;
  level: number;
}

/**
 * Walks up the referral tree (max `REFERRAL_DEPTH` levels) and returns the
 * qualified upline of `userId` together with their level relative to that user.
 */
export async function getUplineChain(
  userId: string,
  client: Pick<PrismaClient, "referral"> | TransactionClient = prisma,
): Promise<UplineEntry[]> {
  const chain: UplineEntry[] = [];
  const visited = new Set<string>([userId]);
  let currentUserId = userId;

  for (let level = 1; level <= REFERRAL_DEPTH; level += 1) {
    const parent = await client.referral.findUnique({
      where: { referredUserId: currentUserId },
      select: { referrerId: true, status: true, referrer: { select: { status: true } } },
    });

    if (!parent || parent.status !== "ACTIVE" || parent.referrer.status !== "ACTIVE") break;
    if (visited.has(parent.referrerId)) break; // guards against cyclic data

    chain.push({ userId: parent.referrerId, level });
    visited.add(parent.referrerId);
    currentUserId = parent.referrerId;
  }

  return chain;
}

export interface ReferralSummary {
  directReferrals: number;
  totalNetwork: number;
  activePrograms: number;
}

/**
 * Counts used for commission reporting: direct referrals plus every distinct
 * source user that has already produced a commission row. The dashboard shows
 * its own counts from `getReferralNetwork` (the tree is the source of truth for
 * "who is in my network"); this helper stays for admin/reporting surfaces.
 */
export async function getReferralSummary(userId: string): Promise<ReferralSummary> {
  const [direct, network, activePrograms] = await Promise.all([
    prisma.referral.count({ where: { referrerId: userId, status: "ACTIVE" } }),
    getReferralNetwork({ id: userId, username: "" }),
    prisma.userProgram.count({ where: { userId, status: "ACTIVE" } }),
  ]);

  return {
    directReferrals: direct,
    totalNetwork: network.total,
    activePrograms,
  };
}

/** Convenience helper used by tests and the admin tooling. */
export function referralLevels(): number[] {
  return Array.from({ length: REFERRAL_DEPTH }, (_, index) => index + 1);
}

// ---------------------------------------------------------------------------
// Commission calculation — always server side, always exact Decimal
// ---------------------------------------------------------------------------

export interface ReferralCommissionBreakdown {
  level: number;
  /** Configured level rate (4 decimals). */
  rate: Prisma.Decimal;
  /** Source program value (2 decimals). */
  baseAmount: Prisma.Decimal;
  /** `baseAmount * rate`, rounded half up to 2 decimals. */
  commissionAmount: Prisma.Decimal;
  currency: string;
}

/**
 * Calculates a referral commission with `Prisma.Decimal` only — no JS float ever
 * touches a money value. Invalid levels or base amounts are rejected instead of
 * silently producing a rounded/zero commission.
 */
export function calculateReferralCommission(input: {
  level: number;
  baseAmount: DecimalInput;
  currency?: string;
  /** Optional snapshot supplied by the engine; omitted callers use legacy defaults. */
  rate?: DecimalInput;
}): ReferralCommissionBreakdown {
  if (!isValidReferralLevel(input.level)) {
    throw new ReferralError(
      "INVALID_LEVEL",
      `Tingkat rujukan harus bilangan bulat 1 sampai ${REFERRAL_DEPTH}.`,
    );
  }

  const rate = input.rate === undefined ? referralRateForLevel(input.level) : toDecimal(input.rate);
  if (!rate) {
    throw new ReferralError("INVALID_LEVEL", `Tarif untuk tingkat ${input.level} tidak dikonfigurasi.`);
  }
  if (rate.isNegative() || rate.greaterThan(1) || rate.decimalPlaces() > 4) {
    throw new ReferralError("INVALID_RATE", "Tarif rabat tidak valid.");
  }

  let base: Prisma.Decimal;
  try {
    base = toDecimal(input.baseAmount);
  } catch {
    throw new ReferralError("INVALID_BASE_AMOUNT", "Nilai dasar komisi bukan angka desimal yang valid.");
  }

  if (base.isNegative() || base.isZero()) {
    throw new ReferralError("INVALID_BASE_AMOUNT", "Nilai dasar komisi harus lebih besar dari nol.");
  }
  if (base.decimalPlaces() > MONEY_SCALE) {
    throw new ReferralError("INVALID_BASE_AMOUNT", "Nilai dasar komisi maksimal dua desimal.");
  }
  if (base.greaterThan(MAX_MONEY)) {
    throw new ReferralError("INVALID_BASE_AMOUNT", "Nilai dasar komisi melebihi batas maksimum.");
  }

  const baseAmount = base.toDecimalPlaces(MONEY_SCALE, Prisma.Decimal.ROUND_HALF_UP);

  return {
    level: input.level,
    rate,
    baseAmount,
    commissionAmount: baseAmount.times(rate).toDecimalPlaces(MONEY_SCALE, Prisma.Decimal.ROUND_HALF_UP),
    currency: input.currency ?? "USDT",
  };
}

// ---------------------------------------------------------------------------
// Eligibility — one explicitly configured event, never registration
// ---------------------------------------------------------------------------

export interface ReferralEventCandidate {
  type: TransactionType;
  status: TransactionStatus;
  bucket: string;
  userProgramId: string | null;
  membershipStatus: UserProgramStatus | null;
  fundsConfirmedAt: Date | null;
  programStatus: ProgramStatus | null;
}

export interface ReferralEventEligibility {
  eligible: boolean;
  reason: string;
}

/**
 * Pure eligibility rule for the configured commission event
 * (`REFERRAL_ELIGIBLE_EVENT`): a POSTED ledger entry in the PROGRAM_FUNDS bucket
 * belonging to an ACTIVE, funds confirmed membership of an ACTIVE program.
 * Registration (account creation) and every other event are rejected.
 */
export function evaluateReferralEventEligibility(
  candidate: ReferralEventCandidate,
  config: ReferralEligibleEventConfig = REFERRAL_ELIGIBLE_EVENT,
): ReferralEventEligibility {
  if (!config.transactionTypes.includes(candidate.type)) {
    return {
      eligible: false,
      reason: `Jenis transaksi ${candidate.type} bukan peristiwa yang dikonfigurasi untuk komisi rujukan.`,
    };
  }
  if (candidate.status !== config.requiredStatus) {
    return {
      eligible: false,
      reason: `Hanya transaksi ${config.requiredStatus} yang menghasilkan komisi (status saat ini: ${candidate.status}).`,
    };
  }
  if (candidate.bucket !== config.requiredBucket) {
    return {
      eligible: false,
      reason: `Transaksi harus memindahkan keranjang ${config.requiredBucket}.`,
    };
  }
  if (config.requiresMembership && !candidate.userProgramId) {
    return { eligible: false, reason: "Transaksi tidak terhubung ke keanggotaan program." };
  }
  if (
    config.requiresConfirmedFunds &&
    (candidate.membershipStatus !== "ACTIVE" || !candidate.fundsConfirmedAt)
  ) {
    return {
      eligible: false,
      reason: "Dana program belum dikonfirmasi sehingga keanggotaan belum aktif.",
    };
  }
  if (config.requiresActiveProgram && candidate.programStatus !== "ACTIVE") {
    return { eligible: false, reason: "Program dari keanggotaan ini tidak aktif." };
  }

  return { eligible: true, reason: "Peristiwa memenuhi syarat komisi rujukan." };
}

export type CommissionBeneficiarySkipReason =
  | "SELF"
  | "DUPLICATE"
  | "OUT_OF_RANGE"
  | "MISSING_EDGE";

export interface CommissionBeneficiarySkip {
  userId: string;
  level: number;
  reason: CommissionBeneficiarySkipReason;
}

/**
 * Pure guard that turns a raw upline walk into the payable beneficiaries: the
 * source account itself is never paid (no self commission), duplicates are
 * dropped and levels outside 1..5 are ignored.
 */
export function selectCommissionBeneficiaries(
  sourceUserId: string,
  upline: UplineEntry[],
): { eligible: UplineEntry[]; skipped: CommissionBeneficiarySkip[] } {
  const eligible: UplineEntry[] = [];
  const skipped: CommissionBeneficiarySkip[] = [];
  const seen = new Set<string>();

  for (const entry of upline) {
    if (entry.userId === sourceUserId) {
      skipped.push({ ...entry, reason: "SELF" });
      continue;
    }
    if (!isValidReferralLevel(entry.level)) {
      skipped.push({ ...entry, reason: "OUT_OF_RANGE" });
      continue;
    }
    if (seen.has(entry.userId)) {
      skipped.push({ ...entry, reason: "DUPLICATE" });
      continue;
    }
    seen.add(entry.userId);
    eligible.push(entry);
  }

  return { eligible, skipped };
}


// ---------------------------------------------------------------------------
// Commission engine — hooked into the ledger event, idempotent by unique key
// ---------------------------------------------------------------------------

export interface CreatedReferralCommission {
  id: string;
  beneficiaryUserId: string;
  level: number;
  rate: string;
  commissionAmount: string;
  currency: string;
  status: ReferralCommissionStatus;
}

export interface ReferralCommissionEngineResult {
  status: "CREATED" | "DUPLICATE" | "INELIGIBLE" | "NO_UPLINE";
  reason: string;
  created: CreatedReferralCommission[];
  skipped: CommissionBeneficiarySkip[];
}

const INELIGIBLE = (
  reason: string,
  skipped: CommissionBeneficiarySkip[] = [],
): ReferralCommissionEngineResult => ({
  status: "INELIGIBLE",
  reason,
  created: [],
  skipped,
});

/**
 * Creates the PENDING commissions owed to the five generations of upline when the
 * configured program event is posted.
 *
 * Must be called with the transaction client that recorded the source ledger
 * entry, so activation and commissions commit or roll back together. Running it
 * twice for the same transaction is safe: `UNIQUE(sourceTransactionId,
 * beneficiaryUserId)` plus `skipDuplicates` make the second run a no-op.
 */
export async function postReferralCommissionsForTransaction(
  client: TransactionClient,
  input: { transactionId: string },
): Promise<ReferralCommissionEngineResult> {
  const sourceTransaction = await client.transaction.findUnique({
    where: { id: input.transactionId },
    select: {
      id: true,
      userId: true,
      userProgramId: true,
      type: true,
      status: true,
      bucket: true,
      amount: true,
      currency: true,
      reference: true,
      postedAt: true,
      createdAt: true,
    },
  });

  if (!sourceTransaction) {
    throw new ReferralError("SOURCE_TRANSACTION_NOT_FOUND", "Transaksi sumber komisi tidak ditemukan.");
  }

  const membership = sourceTransaction.userProgramId
    ? await client.userProgram.findUnique({
        where: { id: sourceTransaction.userProgramId },
        select: {
          status: true,
          fundsConfirmedAt: true,
          program: { select: { status: true } },
        },
      })
    : null;

  const eligibility = evaluateReferralEventEligibility({
    type: sourceTransaction.type,
    status: sourceTransaction.status,
    bucket: sourceTransaction.bucket,
    userProgramId: sourceTransaction.userProgramId,
    membershipStatus: membership?.status ?? null,
    fundsConfirmedAt: membership?.fundsConfirmedAt ?? null,
    programStatus: membership?.program.status ?? null,
  });

  if (!eligibility.eligible) return INELIGIBLE(eligibility.reason);

  const upline = await getUplineChain(sourceTransaction.userId, client);
  const { eligible, skipped } = selectCommissionBeneficiaries(sourceTransaction.userId, upline);
  if (eligible.length === 0) return INELIGIBLE("Tidak ada upline aktif dalam lima tingkat.", skipped);

  // Read the current configuration inside the same transaction snapshot. The
  // resulting rate is copied into each commission row and therefore becomes an
  // immutable historical snapshot.
  const rebateRates = await getRebateRates({ client });
  const chainByLevel = new Map(upline.map((entry) => [entry.level, entry.userId]));
  const edges = await client.referral.findMany({
    where: {
      referrerId: { in: eligible.map((entry) => entry.userId) },
      referredUserId: { in: [sourceTransaction.userId, ...eligible.map((entry) => entry.userId)] },
    },
    select: { id: true, referrerId: true, referredUserId: true },
  });



  const rows: Prisma.ReferralCommissionCreateManyInput[] = [];
  const payable: UplineEntry[] = [];

  for (const entry of eligible) {
    const childUserId =
      entry.level === 1 ? sourceTransaction.userId : chainByLevel.get(entry.level - 1) ?? null;
    const edge = childUserId
      ? edges.find(
          (candidate) =>
            candidate.referrerId === entry.userId && candidate.referredUserId === childUserId,
        )
      : undefined;

    if (!edge) {
      skipped.push({ ...entry, reason: "MISSING_EDGE" });
      continue;
    }

    const breakdown = calculateReferralCommission({
      level: entry.level,
      baseAmount: sourceTransaction.amount,
      currency: sourceTransaction.currency,
      rate: rebateRateForGeneration(rebateRates, entry.level) ?? undefined,
    });

    rows.push({
      referralId: edge.id,
      beneficiaryUserId: entry.userId,
      sourceUserId: sourceTransaction.userId,
      sourceTransactionId: sourceTransaction.id,
      level: breakdown.level,
      rate: breakdown.rate,
      baseAmount: breakdown.baseAmount,
      commissionAmount: breakdown.commissionAmount,
      currency: breakdown.currency,
      status: "PENDING",
      sourceReference: sourceTransaction.reference,
      postedAt: sourceTransaction.postedAt ?? sourceTransaction.createdAt,
    });
    payable.push(entry);
  }

  if (rows.length === 0) return INELIGIBLE("Tidak ada baris komisi yang dapat dicatat.", skipped);

  const existing = await client.referralCommission.findMany({
    where: {
      sourceTransactionId: sourceTransaction.id,
      beneficiaryUserId: { in: rows.map((row) => row.beneficiaryUserId) },
    },
    select: { beneficiaryUserId: true },
  });
  const existingIds = new Set(existing.map((row) => row.beneficiaryUserId));
  const fresh = rows.filter((row) => !existingIds.has(row.beneficiaryUserId));

  if (fresh.length === 0) {
    return {
      status: "DUPLICATE",
      reason: "Komisi untuk transaksi ini sudah pernah dicatat.",
      created: [],
      skipped: payable.map((entry) => ({ ...entry, reason: "DUPLICATE" as const })),
    };
  }

  await client.referralCommission.createMany({ data: fresh, skipDuplicates: true });

  const created = await client.referralCommission.findMany({
    where: {
      sourceTransactionId: sourceTransaction.id,
      beneficiaryUserId: { in: fresh.map((row) => row.beneficiaryUserId) },
    },
    orderBy: [{ level: "asc" }, { beneficiaryUserId: "asc" }],
    select: {
      id: true,
      beneficiaryUserId: true,
      level: true,
      rate: true,
      commissionAmount: true,
      currency: true,
      status: true,
    },
  });

  return {
    status: "CREATED",
    reason: `${created.length} komisi rujukan dicatat sebagai MENUNGGU.`,
    created: created.map((row) => ({
      id: row.id,
      beneficiaryUserId: row.beneficiaryUserId,
      level: row.level,
      rate: row.rate.toFixed(4),
      commissionAmount: row.commissionAmount.toFixed(2),
      currency: row.currency,
      status: row.status,
    })),
    skipped: [
      ...skipped,
      ...payable
        .filter((entry) => existingIds.has(entry.userId))
        .map((entry) => ({ ...entry, reason: "DUPLICATE" as const })),
    ],
  };
}

// ---------------------------------------------------------------------------
// Reading commissions (own data only)
// ---------------------------------------------------------------------------

export interface ReferralCommissionRecord {
  id: string;
  level: number;
  status: ReferralCommissionStatus;
  rate: string;
  baseAmount: string;
  commissionAmount: string;
  currency: string;
  sourceUserId: string;
  sourceUsername: string;
  sourceReference: string;
  sourceTransactionId: string;
  postedAt: Date | null;
  approvedAt: Date | null;
  paidAt: Date | null;
  createdAt: Date;
}

/**
 * Commission rows earned by `userId`. The query is always filtered by the
 * beneficiary, so no caller can read another account's commissions.
 */
export async function listReferralCommissions(
  userId: string,
  limit = 200,
): Promise<ReferralCommissionRecord[]> {
  const rows = await prisma.referralCommission.findMany({
    where: { beneficiaryUserId: userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
    select: {
      id: true,
      level: true,
      status: true,
      rate: true,
      baseAmount: true,
      commissionAmount: true,
      currency: true,
      sourceUserId: true,
      sourceReference: true,
      sourceTransactionId: true,
      postedAt: true,
      approvedAt: true,
      paidAt: true,
      createdAt: true,
      sourceUser: { select: { username: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    level: row.level,
    status: row.status,
    rate: row.rate.toFixed(4),
    baseAmount: row.baseAmount.toFixed(2),
    commissionAmount: row.commissionAmount.toFixed(2),
    currency: row.currency,
    sourceUserId: row.sourceUserId,
    sourceUsername: row.sourceUser.username,
    sourceReference: row.sourceReference,
    sourceTransactionId: row.sourceTransactionId,
    postedAt: row.postedAt,
    approvedAt: row.approvedAt,
    paidAt: row.paidAt,
    createdAt: row.createdAt,
  }));
}

export interface ReferralCommissionStatusTotal {
  count: number;
  total: string;
}

export interface ReferralCommissionSummary {
  currency: string;
  count: number;
  total: string;
  byStatus: Record<ReferralCommissionStatus, ReferralCommissionStatusTotal>;
}

/** Totals per status (PENDING / APPROVED / PAID / REJECTED / VOID) for one account. */
export async function getReferralCommissionSummary(
  userId: string,
): Promise<ReferralCommissionSummary> {
  const grouped = await prisma.referralCommission.groupBy({
    by: ["status"],
    where: { beneficiaryUserId: userId },
    _count: { _all: true },
    _sum: { commissionAmount: true },
  });

  const byStatus = Object.fromEntries(
    REFERRAL_COMMISSION_STATUSES.map((status) => [
      status,
      { count: 0, total: new Prisma.Decimal(0) },
    ]),
  ) as Record<ReferralCommissionStatus, { count: number; total: Prisma.Decimal }>;

  for (const group of grouped) {
    byStatus[group.status] = {
      count: group._count._all,
      total: group._sum.commissionAmount ?? new Prisma.Decimal(0),
    };
  }

  const count = grouped.reduce((total, group) => total + group._count._all, 0);
  const total = Object.values(byStatus).reduce(
    (sum, entry) => sum.plus(entry.total),
    new Prisma.Decimal(0),
  );

  return {
    currency: "USDT",
    count,
    total: total.toFixed(2),
    byStatus: Object.fromEntries(
      REFERRAL_COMMISSION_STATUSES.map((status) => [
        status,
        { count: byStatus[status].count, total: byStatus[status].total.toFixed(2) },
      ]),
    ) as Record<ReferralCommissionStatus, ReferralCommissionStatusTotal>,
  };
}

// ---------------------------------------------------------------------------
// Commission lifecycle — administrator only
// ---------------------------------------------------------------------------

export type ReferralCommissionAction = "APPROVE" | "PAY" | "REJECT" | "VOID";

const COMMISSION_ALLOWED_FROM: Record<ReferralCommissionAction, ReferralCommissionStatus[]> = {
  APPROVE: ["PENDING"],
  PAY: ["APPROVED"],
  REJECT: ["PENDING", "APPROVED"],
  VOID: ["PENDING", "APPROVED"],
};

const COMMISSION_TARGET: Record<ReferralCommissionAction, ReferralCommissionStatus> = {
  APPROVE: "APPROVED",
  PAY: "PAID",
  REJECT: "REJECTED",
  VOID: "VOID",
};

export interface ReferralCommissionActionResult {
  commissionId: string;
  status: ReferralCommissionStatus;
  beneficiaryUserId: string;
  commissionAmount: string;
  currency: string;
  payoutTransactionId: string | null;
  payoutReference: string | null;
}

/**
 * Moves a commission through PENDING -> APPROVED -> PAID (or REJECTED / VOID).
 *
 * Only an ACTIVE administrator may call it, a PAID commission is terminal and
 * paying appends a REFERRAL_REWARD ledger entry to the beneficiary's spendable
 * balance in the same transaction as the status change — money can never be
 * credited without the audit trail that explains it.
 */
export async function setReferralCommissionStatus(input: {
  commissionId: string;
  action: ReferralCommissionAction;
  actorUserId: string;
  reason?: string;
  meta?: RequestMeta;
}): Promise<ReferralCommissionActionResult> {
  const actor = await prisma.user.findUnique({
    where: { id: input.actorUserId },
    select: { role: true, status: true },
  });
  if (!actor || actor.role !== "ADMIN" || actor.status !== "ACTIVE") {
    throw new ReferralError(
      "FORBIDDEN",
      "Hanya administrator aktif yang dapat mengubah status komisi rujukan.",
      403,
    );
  }
  if ((input.action === "REJECT" || input.action === "VOID") && !input.reason?.trim()) {
    throw new ReferralError(
      "REASON_REQUIRED",
      "Alasan wajib diisi untuk penolakan atau pembatalan komisi.",
    );
  }

  const commission = await prisma.referralCommission.findUnique({
    where: { id: input.commissionId },
    select: {
      id: true,
      status: true,
      beneficiaryUserId: true,
      sourceUserId: true,
      commissionAmount: true,
      currency: true,
      level: true,
    },
  });
  if (!commission) {
    throw new ReferralError("COMMISSION_NOT_FOUND", "Baris komisi tidak ditemukan.", 404);
  }
  if (!COMMISSION_ALLOWED_FROM[input.action].includes(commission.status)) {
    throw new ReferralError(
      "INVALID_COMMISSION_STATUS",
      `Aksi ${input.action.toLowerCase()} tidak dapat dijalankan pada komisi berstatus ${commission.status}.`,
      409,
    );
  }

  const target = COMMISSION_TARGET[input.action];
  const now = new Date();

  return prisma.$transaction(
    async (tx) => {
      let payoutTransactionId: string | null = null;
      let payoutReference: string | null = null;

      if (input.action === "PAY") {
        const payout = await postLedgerEntry(tx, {
          userId: commission.beneficiaryUserId,
          type: "REFERRAL_REWARD",
          bucket: "AVAILABLE",
          amount: commission.commissionAmount,
          currency: commission.currency,
          reference: `referral-commission:${commission.id}:payout`,
          description: `Komisi rujukan tingkat ${commission.level} dibayar`,
          metadata: {
            commissionId: commission.id,
            sourceUserId: commission.sourceUserId,
            actorUserId: input.actorUserId,
          },
          totalEarnedDelta: commission.commissionAmount,
        });
        payoutTransactionId = payout.id;
        payoutReference = payout.reference;
      }

      const updated = await tx.referralCommission.update({
        where: { id: commission.id },
        data: {
          status: target,
          approvedAt: input.action === "APPROVE" ? now : undefined,
          paidAt: input.action === "PAY" ? now : undefined,
          payoutTransactionId: payoutTransactionId ?? undefined,
        },
        select: { id: true, status: true },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          action: `referral.commission.${input.action.toLowerCase()}`,
          entityType: "ReferralCommission",
          entityId: commission.id,
          before: { status: commission.status },
          after: { status: updated.status, reason: input.reason ?? null, payoutReference },
          ipAddress: input.meta?.ipAddress ?? null,
        },
      });

      return {
        commissionId: updated.id,
        status: updated.status,
        beneficiaryUserId: commission.beneficiaryUserId,
        commissionAmount: commission.commissionAmount.toFixed(2),
        currency: commission.currency,
        payoutTransactionId,
        payoutReference,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

// ---------------------------------------------------------------------------
// Network members table — user, level, join date, program, status, commission
// ---------------------------------------------------------------------------

export interface ReferralMemberCommission {
  count: number;
  pending: string;
  approved: string;
  paid: string;
  total: string;
  currency: string;
}

export interface ReferralNetworkMember {
  userId: string;
  username: string;
  /** Generation relative to the root account (1..5). */
  level: number;
  /** When the member account was created. */
  joinedAt: Date;
  programName: string | null;
  programTierCode: string | null;
  programStatus: UserProgramStatus | null;
  programJoinedAt: Date | null;
  programJoinAmount: string | null;
  /** Commissions this member has already produced for the root account. */
  commission: ReferralMemberCommission;
}

/** Deterministic flattening of the tree, root excluded, breadth first. */
function flattenNetwork(root: NetworkNode): NetworkNode[] {
  const flat: NetworkNode[] = [];
  const queue = [root];

  while (queue.length) {
    const node = queue.shift()!;
    for (const child of node.children) {
      flat.push(child);
      queue.push(child);
    }
  }

  return flat;
}

/** Membership shown in the member table: ACTIVE first, then the newest row. */
const MEMBERSHIP_PRIORITY: Record<UserProgramStatus, number> = {
  ACTIVE: 5,
  SUSPENDED: 4,
  PENDING: 3,
  COMPLETED: 2,
  CANCELLED: 1,
};

/**
 * One row per member of the five-generation network of `userId`, enriched with
 * the program membership and the commission that member has generated. Always
 * scoped to the given account: the level comes from the traversed tree, never
 * from a stored value.
 */
export async function getReferralNetworkMembers(
  userId: string,
  client: ReferralClient = prisma,
): Promise<ReferralNetworkMember[]> {
  const root = await client.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true },
  });
  if (!root) {
    throw new ReferralError("USER_NOT_FOUND", "Akun tidak ditemukan.", 404);
  }

  const network = await loadReferralNetwork(root, (parentIds, take) =>
    client.referral.findMany({
      where: { referrerId: { in: parentIds }, status: "ACTIVE" },
      select: {
        referrerId: true,
        referredUser: { select: { id: true, username: true } },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take,
    }),
  );

  const members = flattenNetwork(network.root);
  const memberIds = members.map((member) => member.id);
  if (memberIds.length === 0) return [];

  const [users, memberships, commissionGroups] = await Promise.all([
    client.user.findMany({
      where: { id: { in: memberIds } },
      select: { id: true, createdAt: true },
    }),
    client.userProgram.findMany({
      where: { userId: { in: memberIds } },
      orderBy: [{ joinedAt: "desc" }],
      select: {
        userId: true,
        status: true,
        joinedAt: true,
        joinAmount: true,
        tier: { select: { code: true, name: true } },
      },
    }),
    client.referralCommission.groupBy({
      by: ["sourceUserId", "status"],
      where: { beneficiaryUserId: userId, sourceUserId: { in: memberIds } },
      _count: { _all: true },
      _sum: { commissionAmount: true },
    }),
  ]);

  const userById = new Map(users.map((user) => [user.id, user]));
  const membershipByUser = new Map<string, (typeof memberships)[number]>();
  for (const membership of memberships) {
    const current = membershipByUser.get(membership.userId);
    if (!current || MEMBERSHIP_PRIORITY[membership.status] > MEMBERSHIP_PRIORITY[current.status]) {
      membershipByUser.set(membership.userId, membership);
    }
  }

  return members.map((member) => {
    const membership = membershipByUser.get(member.id);
    const commission: ReferralMemberCommission = {
      count: 0,
      pending: "0.00",
      approved: "0.00",
      paid: "0.00",
      total: "0.00",
      currency: "USDT",
    };

    const sums = {
      PENDING: new Prisma.Decimal(0),
      APPROVED: new Prisma.Decimal(0),
      PAID: new Prisma.Decimal(0),
      REJECTED: new Prisma.Decimal(0),
      VOID: new Prisma.Decimal(0),
    } as Record<ReferralCommissionStatus, Prisma.Decimal>;

    for (const group of commissionGroups) {
      if (group.sourceUserId !== member.id) continue;
      commission.count += group._count._all;
      sums[group.status] = sums[group.status].plus(group._sum.commissionAmount ?? 0);
    }

    commission.pending = sums.PENDING.toFixed(2);
    commission.approved = sums.APPROVED.toFixed(2);
    commission.paid = sums.PAID.toFixed(2);
    // Entitled value only: REJECTED and VOID rows never count towards a total.
    commission.total = sums.PENDING.plus(sums.APPROVED).plus(sums.PAID).toFixed(2);

    return {
      userId: member.id,
      username: member.username,
      level: member.level,
      joinedAt: userById.get(member.id)?.createdAt ?? new Date(0),
      programName: membership?.tier.name ?? null,
      programTierCode: membership?.tier.code ?? null,
      programStatus: membership?.status ?? null,
      programJoinedAt: membership?.joinedAt ?? null,
      programJoinAmount: membership ? membership.joinAmount.toFixed(2) : null,
      commission,
    };
  });
}

