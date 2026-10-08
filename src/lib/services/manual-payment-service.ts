import { Prisma, type AdminRole, type DepositStatus, type WithdrawalStatus } from "@prisma/client";

import { canAdmin, canReviewDepositAction } from "@/lib/auth/admin-permissions";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/security";
import { LedgerError, postLedgerEntry } from "@/lib/services/ledger-service";
import { ProgramError, activateUserProgramInTransaction } from "@/lib/services/program-service";
import { generateRewardsInTransaction } from "@/lib/services/reward-service";

/**
 * Manual payment workflow (deposit / withdrawal).
 *
 * The platform never touches a payment gateway: a member reports money that was
 * sent outside the platform and attaches a proof file, and an administrator
 * reviews the request. Because real money is at stake, every rule that decides
 * whether funds move lives *here* — inside one Serializable database transaction
 * — and not in the API routes:
 *
 *  - the actor's administrator role is re-read from the database, never trusted
 *    from the request body, and must be an ACTIVE `ADMIN` with a non-null
 *    `adminRole` holding the required capability;
 *  - a deposit submit never credits anything: it only records the claim, and the
 *    money is credited when an administrator approves it, in the same
 *    transaction that activates the membership, records the first reward period
 *    and writes the audit trail;
 *  - a withdrawal submit moves AVAILABLE -> RESERVED, a rejection moves it back,
 *    and only PROCESSING -> COMPLETED debits the reservation for good;
 *  - terminal states (APPROVED/REJECTED for deposits, COMPLETED/REJECTED for
 *    withdrawals) can never be replayed;
 *  - every mutation appends an immutable ledger entry and an audit row carrying
 *    the before/after snapshots plus the request IP and user agent.
 *
 * Ledger rows are append-only (PostgreSQL trigger): money is never edited or
 * deleted, it is only ever appended.
 */

export class PaymentError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "PaymentError";
    this.code = code;
    this.status = status;
  }
}

export type DepositAction = "UNDER_REVIEW" | "APPROVED" | "REJECTED" | "FLAGGED";
export type WithdrawalAction =
  | "UNDER_REVIEW"
  | "APPROVED"
  | "PROCESSING"
  | "COMPLETED"
  | "REJECTED";

export interface DepositProofInput {
  storageKey: string;
  fileName: string;
  mimeType: string;
  size: number;
}

export interface CreateDepositRequestInput {
  userId: string;
  userProgramId: string;
  amount: Prisma.Decimal;
  paymentMethod: string;
  paymentReference: string;
  proof: DepositProofInput;
  meta?: RequestMeta;
}

export interface CreateWithdrawalRequestInput {
  userId: string;
  amount: Prisma.Decimal;
  method: string;
  destination: string;
  notes?: string;
  meta?: RequestMeta;
}

export interface ReviewDepositRequestInput {
  depositId: string;
  actorUserId: string;
  /** Advisory only: the authoritative role is re-read from the database. */
  actorAdminRole?: AdminRole | null;
  action: DepositAction;
  reason?: string;
  note?: string;
  meta?: RequestMeta;
}

export interface ReviewWithdrawalRequestInput {
  withdrawalId: string;
  actorUserId: string;
  /** Advisory only: the authoritative role is re-read from the database. */
  actorAdminRole?: AdminRole | null;
  action: WithdrawalAction;
  reason?: string;
  note?: string;
  meta?: RequestMeta;
}
export interface DepositRequestSummary {
  id: string;
  status: DepositStatus;
  amount: string;
  currency: string;
  userProgramId: string;
  paymentMethod: string;
  paymentReference: string;
  createdAt: string;
}

export interface ReviewDepositResult {
  id: string;
  status: DepositStatus;
  amount: string;
  currency: string;
  ledgerReference: string | null;
  membershipStatus: string | null;
  rewardsCreated: number;
  referralCommissionsCreated: number;
  reviewedAt: string;
}

export interface WithdrawalRequestSummary {
  id: string;
  status: WithdrawalStatus;
  amount: string;
  currency: string;
  method: string;
  destination: string;
  notes: string | null;
  reservedReference: string | null;
  createdAt: string;
}

export interface ReviewWithdrawalResult {
  id: string;
  status: WithdrawalStatus;
  amount: string;
  currency: string;
  reservedReference: string | null;
  completionReference: string | null;
  /** True when a rejection returned the money to AVAILABLE. */
  released: boolean;
  /** True when PROCESSING -> COMPLETED debited the reservation for good. */
  settled: boolean;
  reviewedAt: string;
}

/**
 * Which statuses a review action may be applied *from*. A status that appears in
 * no list is terminal: replaying a decision is refused with a clean 409.
 */
const DEPOSIT_TRANSITIONS: Record<DepositAction, DepositStatus[]> = {
  UNDER_REVIEW: ["PENDING", "FLAGGED"],
  FLAGGED: ["PENDING", "UNDER_REVIEW"],
  APPROVED: ["PENDING", "UNDER_REVIEW", "FLAGGED"],
  REJECTED: ["PENDING", "UNDER_REVIEW", "FLAGGED"],
};

const WITHDRAWAL_TRANSITIONS: Record<WithdrawalAction, WithdrawalStatus[]> = {
  UNDER_REVIEW: ["PENDING"],
  APPROVED: ["PENDING", "UNDER_REVIEW"],
  PROCESSING: ["APPROVED"],
  COMPLETED: ["PROCESSING"],
  REJECTED: ["PENDING", "UNDER_REVIEW", "APPROVED", "PROCESSING"],
};

/** Statuses that keep a deposit "open" for its membership (see the unique index). */
const OPEN_DEPOSIT_STATUSES: DepositStatus[] = ["PENDING", "UNDER_REVIEW", "APPROVED", "FLAGGED"];
/** Statuses that hold a reservation on the member's spendable balance. */
const OPEN_WITHDRAWAL_STATUSES: WithdrawalStatus[] = [
  "PENDING",
  "UNDER_REVIEW",
  "APPROVED",
  "PROCESSING",
];

const MAX_SERIALIZABLE_ATTEMPTS = 3;

function isSerializationFailure(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * Runs `fn` in a Serializable transaction. PostgreSQL aborts a serializable
 * transaction that would break isolation with SQLSTATE 40001, which Prisma
 * surfaces as P2034; such a conflict is a retryable race, not a user error, so it
 * is retried a bounded number of times before it becomes a clean 409.
 */
async function runSerializable<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < MAX_SERIALIZABLE_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (!isSerializationFailure(error)) throw error;
      if (attempt === MAX_SERIALIZABLE_ATTEMPTS - 1) {
        throw new PaymentError(
          "CONFLICT_RETRY",
          "Permintaan bentrok dengan transaksi lain. Silakan coba lagi.",
          409,
        );
      }
    }
  }
  // Unreachable: the loop either returns or throws.
  throw new PaymentError("CONFLICT_RETRY", "Permintaan bentrok dengan transaksi lain.", 409);
}

interface AdminActorRow {
  id: string;
  role: string;
  status: string;
  adminRole: AdminRole | null;
}

/**
 * Resolves the authoritative administrator for a review. The role is read from
 * the database (never from the caller supplied `actorAdminRole`), and a missing
 * admin role fails closed exactly like `canAdmin` does.
 */
async function resolveReviewActor(
  tx: Prisma.TransactionClient,
  actorUserId: string,
): Promise<AdminActorRow> {
  const actor = await tx.user.findUnique({
    where: { id: actorUserId },
    select: { id: true, role: true, status: true, adminRole: true },
  });

  if (!actor || actor.role !== "ADMIN" || actor.status !== "ACTIVE" || actor.adminRole === null) {
    throw new PaymentError(
      "FORBIDDEN",
      "Akses administrator aktif dengan peran yang ditetapkan diperlukan.",
      403,
    );
  }

  return actor;
}

function assertPositiveAmount(amount: Prisma.Decimal, code: string): void {
  if (amount.lte(0) || amount.decimalPlaces() > 2) {
    throw new PaymentError(code, "Jumlah harus berupa nilai USDT positif dengan dua desimal.", 422);
  }
}

function decimal(value: Prisma.Decimal): string {
  return value.toFixed(2);
}

/** Converts a ledger balance guard into a user facing payment error. */
function mapLedgerError(error: unknown): never {
  if (error instanceof LedgerError) {
    throw new PaymentError(
      error.code === "INSUFFICIENT_BALANCE" ? "INSUFFICIENT_AVAILABLE_BALANCE" : error.code,
      error.message,
      409,
    );
  }
  throw error;
}

/**
 * Records a manual deposit claim for a PENDING membership of the caller.
 *
 * Nothing is credited here: the membership must be PENDING, the amount must equal
 * the membership join amount exactly, and the row is written with status PENDING.
 * A ledger entry with bucket `NONE` documents the claim without touching any
 * balance bucket, so submitting can never create spendable money.
 */
export async function createDepositRequest(
  input: CreateDepositRequestInput,
): Promise<DepositRequestSummary> {
  assertPositiveAmount(input.amount, "INVALID_AMOUNT");

  try {
    return await runSerializable(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: input.userId },
        select: { id: true, status: true },
      });
      if (!user || user.status !== "ACTIVE") {
        throw new PaymentError(
          "USER_NOT_ELIGIBLE",
          "Hanya akun aktif yang dapat mengirim setoran.",
          403,
        );
      }

      const membership = await tx.userProgram.findUnique({
        where: { id: input.userProgramId },
        select: { id: true, userId: true, status: true, joinAmount: true, currency: true },
      });
      if (!membership || membership.userId !== input.userId) {
        throw new PaymentError(
          "MEMBERSHIP_NOT_FOUND",
          "Keanggotaan program tidak ditemukan untuk akun ini.",
          404,
        );
      }
      if (membership.status !== "PENDING") {
        throw new PaymentError(
          "MEMBERSHIP_NOT_PENDING",
          `Setoran hanya dapat diajukan untuk keanggotaan berstatus menunggu (status saat ini: ${membership.status}).`,
          409,
        );
      }
      if (!membership.joinAmount.equals(input.amount)) {
        throw new PaymentError(
          "DEPOSIT_AMOUNT_MISMATCH",
          `Jumlah setoran harus sama dengan nilai gabung ${decimal(membership.joinAmount)} ${membership.currency}.`,
          422,
        );
      }

      // The partial unique index only covers PENDING/UNDER_REVIEW/APPROVED, so a
      // FLAGGED request would slip past it: check every still-open status here.
      const open = await tx.depositRequest.findFirst({
        where: { userProgramId: membership.id, status: { in: OPEN_DEPOSIT_STATUSES } },
        select: { id: true, status: true },
      });
      if (open) {
        throw new PaymentError(
          "DEPOSIT_ALREADY_EXISTS",
          `Masih ada permintaan setoran terbuka (status ${open.status}) untuk keanggotaan ini.`,
          409,
        );
      }

      const deposit = await tx.depositRequest.create({
        data: {
          userId: input.userId,
          userProgramId: membership.id,
          amount: input.amount,
          currency: membership.currency,
          paymentMethod: input.paymentMethod,
          paymentReference: input.paymentReference,
          proofStorageKey: input.proof.storageKey,
          proofFileName: input.proof.fileName,
          proofMimeType: input.proof.mimeType,
          proofSize: input.proof.size,
          status: "PENDING",
          metadata: {
            submittedBy: input.userId,
            joinAmount: decimal(membership.joinAmount),
          },
        },
        select: { id: true, status: true, amount: true, currency: true, createdAt: true },
      });

      await postLedgerEntry(tx, {
        userId: input.userId,
        userProgramId: membership.id,
        type: "PROGRAM_JOIN",
        bucket: "NONE",
        amount: input.amount,
        currency: membership.currency,
        reference: `deposit:${deposit.id}:request`,
        description: `Permintaan setoran manual ${decimal(input.amount)} ${membership.currency} (menunggu peninjauan admin)`,
        metadata: { depositId: deposit.id, paymentMethod: input.paymentMethod },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: input.userId,
          action: "deposit.request",
          entityType: "DepositRequest",
          entityId: deposit.id,
          after: {
            status: deposit.status,
            amount: decimal(deposit.amount),
            currency: deposit.currency,
            userProgramId: membership.id,
            paymentMethod: input.paymentMethod,
            paymentReference: input.paymentReference,
          },
          ipAddress: input.meta?.ipAddress ?? null,
          userAgent: input.meta?.userAgent ?? null,
        },
      });

      return {
        id: deposit.id,
        status: deposit.status,
        amount: decimal(deposit.amount),
        currency: deposit.currency,
        userProgramId: membership.id,
        paymentMethod: input.paymentMethod,
        paymentReference: input.paymentReference,
        createdAt: deposit.createdAt.toISOString(),
      };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new PaymentError(
        "DEPOSIT_ALREADY_EXISTS",
        "Masih ada permintaan setoran terbuka untuk keanggotaan ini.",
        409,
      );
    }
    throw error;
  }
}

/**
 * Administrator review of a deposit.
 *
 * APPROVED runs the membership activation, the PROGRAM_FUNDS ledger entry, the
 * first reward period and the audit row in the same Serializable transaction as
 * the status change, so a deposit can never be approved without the money and
 * the membership state that justify it.
 */
export async function reviewDepositRequest(
  input: ReviewDepositRequestInput,
): Promise<ReviewDepositResult> {
  if ((input.action === "REJECTED" || input.action === "FLAGGED") && !input.reason?.trim()) {
    throw new PaymentError(
      "REASON_REQUIRED",
      "Alasan wajib diisi untuk menolak atau menandai setoran.",
      422,
    );
  }

  try {
    return await runSerializable(async (tx) => {
      const actor = await resolveReviewActor(tx, input.actorUserId);
      // `canReviewDepositAction` already subsumes `canAdmin(role, "reviewDeposit")`
      // (SUPER_ADMIN/FINANCE for every action) and additionally lets COMPLIANCE
      // move a request to UNDER_REVIEW or FLAGGED only.
      if (!canReviewDepositAction(actor.adminRole, input.action)) {
        throw new PaymentError("FORBIDDEN", "Peran Anda tidak boleh melakukan aksi ini.", 403);
      }

      const deposit = await tx.depositRequest.findUnique({
        where: { id: input.depositId },
        select: {
          id: true,
          userId: true,
          userProgramId: true,
          amount: true,
          currency: true,
          status: true,
          ledgerReference: true,
          userProgram: {
            select: { id: true, userId: true, status: true, joinAmount: true, currency: true },
          },
        },
      });
      if (!deposit) {
        throw new PaymentError("DEPOSIT_NOT_FOUND", "Permintaan setoran tidak ditemukan.", 404);
      }
      if (!DEPOSIT_TRANSITIONS[input.action].includes(deposit.status)) {
        throw new PaymentError(
          "INVALID_DEPOSIT_STATUS",
          `Tidak dapat menjalankan aksi ${input.action} pada setoran berstatus ${deposit.status}.`,
          409,
        );
      }

      const now = new Date();
      let ledgerReference: string | null = deposit.ledgerReference;
      let membershipStatus: string | null = deposit.userProgram.status;
      let rewardsCreated = 0;
      let referralCommissionsCreated = 0;

      if (input.action === "APPROVED") {
        const membership = deposit.userProgram;
        if (membership.userId !== deposit.userId) {
          throw new PaymentError(
            "MEMBERSHIP_MISMATCH",
            "Keanggotaan setoran tidak sesuai dengan pemilik permintaan.",
            409,
          );
        }
        if (membership.status !== "PENDING") {
          throw new PaymentError(
            "MEMBERSHIP_NOT_PENDING",
            `Keanggotaan harus berstatus menunggu sebelum setoran disetujui (status saat ini: ${membership.status}).`,
            409,
          );
        }
        if (!membership.joinAmount.equals(deposit.amount)) {
          throw new PaymentError(
            "DEPOSIT_AMOUNT_MISMATCH",
            "Jumlah setoran tidak lagi sama dengan nilai gabung keanggotaan.",
            409,
          );
        }

        const activation = await activateUserProgramInTransaction(tx, {
          userProgramId: membership.id,
          actorUserId: actor.id,
          confirmedAmount: deposit.amount,
          note: input.note ?? input.reason,
          meta: input.meta,
        });
        ledgerReference = activation.ledgerReference;
        membershipStatus = activation.status;
        referralCommissionsCreated = activation.referralCommissionsCreated;

        const generated = await generateRewardsInTransaction(tx, {
          userProgramId: membership.id,
          actorUserId: actor.id,
          now,
        });
        rewardsCreated = generated.created.length;
      }

      const updated = await tx.depositRequest.update({
        where: { id: deposit.id },
        data: {
          status: input.action,
          reviewedByUserId: actor.id,
          reviewedAt: now,
          rejectionReason: input.action === "REJECTED" ? (input.reason ?? null) : undefined,
          flaggedReason: input.action === "FLAGGED" ? (input.reason ?? null) : undefined,
          reviewNote: input.note ?? input.reason ?? undefined,
          ledgerReference: input.action === "APPROVED" ? ledgerReference : undefined,
        },
        select: { id: true, status: true, amount: true, currency: true },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: actor.id,
          action: `deposit.${input.action.toLowerCase()}`,
          entityType: "DepositRequest",
          entityId: deposit.id,
          before: {
            status: deposit.status,
            ledgerReference: deposit.ledgerReference,
            userProgramId: deposit.userProgramId,
          },
          after: {
            status: updated.status,
            amount: decimal(updated.amount),
            currency: updated.currency,
            ledgerReference,
            membershipStatus,
            rewardsCreated,
            referralCommissionsCreated,
            reason: input.reason ?? null,
          },
          ipAddress: input.meta?.ipAddress ?? null,
          userAgent: input.meta?.userAgent ?? null,
        },
      });

      return {
        id: updated.id,
        status: updated.status,
        amount: decimal(updated.amount),
        currency: updated.currency,
        ledgerReference,
        membershipStatus,
        rewardsCreated,
        referralCommissionsCreated,
        reviewedAt: now.toISOString(),
      };
    });
  } catch (error) {
    if (error instanceof ProgramError) {
      throw new PaymentError(error.code, error.message, error.status);
    }
    throw error;
  }
}

/**
 * Creates a manual withdrawal request and reserves its amount.
 *
 * The reservation is the double entry AVAILABLE -> RESERVED (two append-only
 * entries, so the ledger still sums to the balance buckets). A member can only
 * have one open withdrawal at a time; the partial unique index enforces it in the
 * database and this check turns the violation into a readable 409.
 */
export async function createWithdrawalRequest(
  input: CreateWithdrawalRequestInput,
): Promise<WithdrawalRequestSummary> {
  assertPositiveAmount(input.amount, "INVALID_AMOUNT");

  try {
    return await runSerializable(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: input.userId },
        select: { id: true, status: true, balance: { select: { currency: true } } },
      });
      if (!user || user.status !== "ACTIVE") {
        throw new PaymentError(
          "USER_NOT_ELIGIBLE",
          "Hanya akun aktif yang dapat mengajukan penarikan.",
          403,
        );
      }

      const open = await tx.withdrawalRequest.findFirst({
        where: { userId: input.userId, status: { in: OPEN_WITHDRAWAL_STATUSES } },
        select: { id: true, status: true },
      });
      if (open) {
        throw new PaymentError(
          "WITHDRAWAL_ALREADY_OPEN",
          `Masih ada permintaan penarikan terbuka (status ${open.status}). Selesaikan atau tunggu keputusannya terlebih dahulu.`,
          409,
        );
      }

      const currency = user.balance?.currency ?? "USDT";
      const withdrawal = await tx.withdrawalRequest.create({
        data: {
          userId: input.userId,
          amount: input.amount,
          currency,
          method: input.method,
          destination: input.destination,
          notes: input.notes ?? null,
          status: "PENDING",
          metadata: { submittedBy: input.userId },
        },
        select: { id: true, status: true, amount: true, currency: true, createdAt: true },
      });

      await postLedgerEntry(tx, {
        userId: input.userId,
        type: "WITHDRAWAL",
        bucket: "AVAILABLE",
        amount: input.amount.negated(),
        currency,
        reference: `withdrawal:${withdrawal.id}:reserve:available`,
        description: `Dana penarikan ${decimal(input.amount)} ${currency} dipesan (menunggu peninjauan admin)`,
        metadata: { withdrawalId: withdrawal.id, step: "reserve" },
      });
      const reserved = await postLedgerEntry(tx, {
        userId: input.userId,
        type: "WITHDRAWAL",
        bucket: "RESERVED",
        amount: input.amount,
        currency,
        reference: `withdrawal:${withdrawal.id}:reserve:reserved`,
        description: `Dana penarikan ${decimal(input.amount)} ${currency} masuk bucket cadangan`,
        metadata: { withdrawalId: withdrawal.id, step: "reserve" },
      });

      const updated = await tx.withdrawalRequest.update({
        where: { id: withdrawal.id },
        data: { reservedReference: reserved.reference },
        select: {
          id: true,
          status: true,
          amount: true,
          currency: true,
          method: true,
          destination: true,
          notes: true,
          reservedReference: true,
          createdAt: true,
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: input.userId,
          action: "withdrawal.request",
          entityType: "WithdrawalRequest",
          entityId: withdrawal.id,
          after: {
            status: updated.status,
            amount: decimal(updated.amount),
            currency: updated.currency,
            method: input.method,
            destination: input.destination,
            reservedReference: updated.reservedReference,
          },
          ipAddress: input.meta?.ipAddress ?? null,
          userAgent: input.meta?.userAgent ?? null,
        },
      });

      return {
        id: updated.id,
        status: updated.status,
        amount: decimal(updated.amount),
        currency: updated.currency,
        method: updated.method,
        destination: updated.destination,
        notes: updated.notes,
        reservedReference: updated.reservedReference,
        createdAt: updated.createdAt.toISOString(),
      };
    });
  } catch (error) {
    if (error instanceof LedgerError) mapLedgerError(error);
    if (isUniqueViolation(error)) {
      throw new PaymentError(
        "WITHDRAWAL_ALREADY_OPEN",
        "Masih ada permintaan penarikan terbuka untuk akun ini.",
        409,
      );
    }
    throw error;
  }
}

/**
 * Administrator review of a withdrawal.
 *
 * APPROVED/PROCESSING only change the state (the money already sits in RESERVED),
 * REJECTED returns the reservation to AVAILABLE, and only PROCESSING -> COMPLETED
 * debits the reservation permanently. Terminal states (COMPLETED/REJECTED) can
 * never be replayed.
 */
export async function reviewWithdrawalRequest(
  input: ReviewWithdrawalRequestInput,
): Promise<ReviewWithdrawalResult> {
  if (input.action === "REJECTED" && !input.reason?.trim()) {
    throw new PaymentError("REASON_REQUIRED", "Alasan wajib diisi untuk menolak penarikan.", 422);
  }

  try {
    return await runSerializable(async (tx) => {
      const actor = await resolveReviewActor(tx, input.actorUserId);
      if (!canAdmin(actor.adminRole, "reviewWithdrawal")) {
        throw new PaymentError("FORBIDDEN", "Peran Anda tidak boleh meninjau penarikan.", 403);
      }

      const withdrawal = await tx.withdrawalRequest.findUnique({
        where: { id: input.withdrawalId },
        select: {
          id: true,
          userId: true,
          amount: true,
          currency: true,
          status: true,
          reservedReference: true,
          completionReference: true,
        },
      });
      if (!withdrawal) {
        throw new PaymentError("WITHDRAWAL_NOT_FOUND", "Permintaan penarikan tidak ditemukan.", 404);
      }
      if (!WITHDRAWAL_TRANSITIONS[input.action].includes(withdrawal.status)) {
        throw new PaymentError(
          "INVALID_WITHDRAWAL_STATUS",
          `Tidak dapat menjalankan aksi ${input.action} pada penarikan berstatus ${withdrawal.status}.`,
          409,
        );
      }

      const now = new Date();
      let released = false;
      let settled = false;
      let completionReference = withdrawal.completionReference;

      if (input.action === "REJECTED") {
        await postLedgerEntry(tx, {
          userId: withdrawal.userId,
          type: "ADJUSTMENT",
          bucket: "RESERVED",
          amount: withdrawal.amount.negated(),
          currency: withdrawal.currency,
          reference: `withdrawal:${withdrawal.id}:release:reserved`,
          description: `Cadangan penarikan ${decimal(withdrawal.amount)} ${withdrawal.currency} dibebaskan (ditolak)`,
          metadata: { withdrawalId: withdrawal.id, step: "release" },
        });
        await postLedgerEntry(tx, {
          userId: withdrawal.userId,
          type: "ADJUSTMENT",
          bucket: "AVAILABLE",
          amount: withdrawal.amount,
          currency: withdrawal.currency,
          reference: `withdrawal:${withdrawal.id}:release:available`,
          description: `Dana penarikan ${decimal(withdrawal.amount)} ${withdrawal.currency} dikembalikan ke saldo tersedia`,
          metadata: { withdrawalId: withdrawal.id, step: "release" },
        });
        released = true;
      }

      if (input.action === "COMPLETED") {
        const entry = await postLedgerEntry(tx, {
          userId: withdrawal.userId,
          type: "WITHDRAWAL",
          bucket: "RESERVED",
          amount: withdrawal.amount.negated(),
          currency: withdrawal.currency,
          reference: `withdrawal:${withdrawal.id}:complete:reserved`,
          description: `Penarikan ${decimal(withdrawal.amount)} ${withdrawal.currency} dibayarkan; cadangan didebit permanen`,
          metadata: { withdrawalId: withdrawal.id, step: "complete" },
        });
        completionReference = entry.reference;
        settled = true;
      }

      const updated = await tx.withdrawalRequest.update({
        where: { id: withdrawal.id },
        data: {
          status: input.action,
          reviewedByUserId: actor.id,
          reviewedAt: now,
          rejectionReason: input.action === "REJECTED" ? (input.reason ?? null) : undefined,
          reviewNote: input.note ?? input.reason ?? undefined,
          processedAt: input.action === "PROCESSING" ? now : undefined,
          completedAt: input.action === "COMPLETED" ? now : undefined,
          completionReference: input.action === "COMPLETED" ? completionReference : undefined,
        },
        select: {
          id: true,
          status: true,
          amount: true,
          currency: true,
          reservedReference: true,
          completionReference: true,
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: actor.id,
          action: `withdrawal.${input.action.toLowerCase()}`,
          entityType: "WithdrawalRequest",
          entityId: withdrawal.id,
          before: {
            status: withdrawal.status,
            reservedReference: withdrawal.reservedReference,
            completionReference: withdrawal.completionReference,
          },
          after: {
            status: updated.status,
            amount: decimal(updated.amount),
            currency: updated.currency,
            released,
            settled,
            reservedReference: updated.reservedReference,
            completionReference: updated.completionReference,
            reason: input.reason ?? null,
          },
          ipAddress: input.meta?.ipAddress ?? null,
          userAgent: input.meta?.userAgent ?? null,
        },
      });

      return {
        id: updated.id,
        status: updated.status,
        amount: decimal(updated.amount),
        currency: updated.currency,
        reservedReference: updated.reservedReference,
        completionReference: updated.completionReference,
        released,
        settled,
        reviewedAt: now.toISOString(),
      };
    });
  } catch (error) {
    if (error instanceof LedgerError) mapLedgerError(error);
    throw error;
  }
}

export interface AdminDepositRow extends DepositRequestSummary {
  username: string;
  userEmail: string;
  membershipStatus: string;
  proofFileName: string;
  proofMimeType: string;
  proofSize: number;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  flaggedReason: string | null;
  ledgerReference: string | null;
}

export interface AdminWithdrawalRow extends WithdrawalRequestSummary {
  username: string;
  userEmail: string;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  processedAt: string | null;
  completedAt: string | null;
  completionReference: string | null;
}

export interface AdminDashboardMetrics {
  deposits: Record<DepositStatus, number>;
  withdrawals: Record<WithdrawalStatus, number>;
  /** Flagged deposits plus rejected withdrawals — the real "needs attention" count. */
  flaggedTotal: number;
  openWithdrawals: number;
  reservedAmount: string;
}

export interface AuditTrailRow {
  id: string;
  createdAt: string;
  actorUserId: string | null;
  actorUsername: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  before: Prisma.JsonValue;
  after: Prisma.JsonValue;
}

function zeroedCounts<T extends string>(statuses: readonly T[]): Record<T, number> {
  const counts = {} as Record<T, number>;
  for (const status of statuses) counts[status] = 0;
  return counts;
}

/** Deposits of one member, newest first. */
export async function listDepositsForUser(
  userId: string,
  take = 25,
): Promise<DepositRequestSummary[]> {
  const rows = await prisma.depositRequest.findMany({
    where: { userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take,
    select: {
      id: true,
      status: true,
      amount: true,
      currency: true,
      userProgramId: true,
      paymentMethod: true,
      paymentReference: true,
      createdAt: true,
    },
  });

  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    amount: decimal(row.amount),
    currency: row.currency,
    userProgramId: row.userProgramId,
    paymentMethod: row.paymentMethod,
    paymentReference: row.paymentReference,
    createdAt: row.createdAt.toISOString(),
  }));
}

/** Withdrawals of one member, newest first. */
export async function listWithdrawalsForUser(
  userId: string,
  take = 25,
): Promise<WithdrawalRequestSummary[]> {
  const rows = await prisma.withdrawalRequest.findMany({
    where: { userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take,
    select: {
      id: true,
      status: true,
      amount: true,
      currency: true,
      method: true,
      destination: true,
      notes: true,
      reservedReference: true,
      createdAt: true,
    },
  });

  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    amount: decimal(row.amount),
    currency: row.currency,
    method: row.method,
    destination: row.destination,
    notes: row.notes,
    reservedReference: row.reservedReference,
    createdAt: row.createdAt.toISOString(),
  }));
}

/** Review queue for deposits, optionally narrowed by status and a free-text search. */
export async function listDepositsForAdmin(
  options: { status?: DepositStatus; search?: string; take?: number } = {},
): Promise<AdminDepositRow[]> {
  const search = options.search?.trim();
  const rows = await prisma.depositRequest.findMany({
    where: {
      ...(options.status ? { status: options.status } : {}),
      ...(search
        ? {
            OR: [
              { paymentReference: { contains: search, mode: "insensitive" } },
              { user: { username: { contains: search, mode: "insensitive" } } },
              { user: { email: { contains: search, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: options.take ?? 50,
    select: {
      id: true,
      status: true,
      amount: true,
      currency: true,
      userProgramId: true,
      paymentMethod: true,
      paymentReference: true,
      createdAt: true,
      proofFileName: true,
      proofMimeType: true,
      proofSize: true,
      reviewedByUserId: true,
      reviewedAt: true,
      rejectionReason: true,
      flaggedReason: true,
      ledgerReference: true,
      user: { select: { username: true, email: true } },
      userProgram: { select: { status: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    amount: decimal(row.amount),
    currency: row.currency,
    userProgramId: row.userProgramId,
    paymentMethod: row.paymentMethod,
    paymentReference: row.paymentReference,
    createdAt: row.createdAt.toISOString(),
    username: row.user.username,
    userEmail: row.user.email,
    membershipStatus: row.userProgram.status,
    proofFileName: row.proofFileName,
    proofMimeType: row.proofMimeType,
    proofSize: row.proofSize,
    reviewedByUserId: row.reviewedByUserId,
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    rejectionReason: row.rejectionReason,
    flaggedReason: row.flaggedReason,
    ledgerReference: row.ledgerReference,
  }));
}

/** Review queue for withdrawals, optionally narrowed by status and a free-text search. */
export async function listWithdrawalsForAdmin(
  options: { status?: WithdrawalStatus; search?: string; take?: number } = {},
): Promise<AdminWithdrawalRow[]> {
  const search = options.search?.trim();
  const rows = await prisma.withdrawalRequest.findMany({
    where: {
      ...(options.status ? { status: options.status } : {}),
      ...(search
        ? {
            OR: [
              { destination: { contains: search, mode: "insensitive" } },
              { method: { contains: search, mode: "insensitive" } },
              { user: { username: { contains: search, mode: "insensitive" } } },
              { user: { email: { contains: search, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: options.take ?? 50,
    select: {
      id: true,
      status: true,
      amount: true,
      currency: true,
      method: true,
      destination: true,
      notes: true,
      reservedReference: true,
      createdAt: true,
      reviewedByUserId: true,
      reviewedAt: true,
      rejectionReason: true,
      processedAt: true,
      completedAt: true,
      completionReference: true,
      user: { select: { username: true, email: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    amount: decimal(row.amount),
    currency: row.currency,
    method: row.method,
    destination: row.destination,
    notes: row.notes,
    reservedReference: row.reservedReference,
    createdAt: row.createdAt.toISOString(),
    username: row.user.username,
    userEmail: row.user.email,
    reviewedByUserId: row.reviewedByUserId,
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    rejectionReason: row.rejectionReason,
    processedAt: row.processedAt ? row.processedAt.toISOString() : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    completionReference: row.completionReference,
  }));
}

const DEPOSIT_STATUSES: DepositStatus[] = [
  "PENDING",
  "UNDER_REVIEW",
  "APPROVED",
  "REJECTED",
  "FLAGGED",
];

const WITHDRAWAL_STATUSES: WithdrawalStatus[] = [
  "PENDING",
  "UNDER_REVIEW",
  "APPROVED",
  "PROCESSING",
  "COMPLETED",
  "REJECTED",
];

/** Real counters for the admin dashboard; no placeholder numbers. */
export async function getAdminDashboardMetrics(): Promise<AdminDashboardMetrics> {
  const [depositGroups, withdrawalGroups, reserved] = await Promise.all([
    prisma.depositRequest.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.withdrawalRequest.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.balance.aggregate({ _sum: { reservedAmount: true } }),
  ]);

  const deposits = zeroedCounts(DEPOSIT_STATUSES);
  for (const group of depositGroups) deposits[group.status] = group._count._all;

  const withdrawals = zeroedCounts(WITHDRAWAL_STATUSES);
  for (const group of withdrawalGroups) withdrawals[group.status] = group._count._all;

  return {
    deposits,
    withdrawals,
    flaggedTotal: deposits.FLAGGED + withdrawals.REJECTED,
    openWithdrawals:
      withdrawals.PENDING +
      withdrawals.UNDER_REVIEW +
      withdrawals.APPROVED +
      withdrawals.PROCESSING,
    reservedAmount: decimal(reserved._sum.reservedAmount ?? new Prisma.Decimal(0)),
  };
}

/**
 * Full audit history of one entity, newest first — used by the deposit and
 * withdrawal detail views so a decision can be traced back to the request that
 * produced it.
 */
export async function listAuditTrail(
  entityType: string,
  entityId: string,
  take = 50,
): Promise<AuditTrailRow[]> {
  const rows = await prisma.auditLog.findMany({
    where: { entityType, entityId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take,
    select: {
      id: true,
      createdAt: true,
      actorUserId: true,
      action: true,
      entityType: true,
      entityId: true,
      ipAddress: true,
      userAgent: true,
      before: true,
      after: true,
      actor: { select: { username: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    actorUserId: row.actorUserId,
    actorUsername: row.actor?.username ?? null,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    before: row.before,
    after: row.after,
  }));
}

