import { Prisma, type AdminRole } from "@prisma/client";

import { canAdmin } from "@/lib/auth/admin-permissions";
import { prisma } from "@/lib/prisma";
import type { RequestMeta } from "@/lib/security";
import { LedgerError, postLedgerEntry } from "@/lib/services/ledger-service";

/**
 * Explicit administrator balance credit (Tahap 3).
 *
 * There is no automatic signup bonus and no name matching anywhere in this
 * service: money only moves when an authorised administrator asks for it, with a
 * reason and a reference. The rules that keep it auditable:
 *
 *  - the actor's admin role is re-read from the database inside the transaction
 *    (never trusted from the request body) and must hold `creditBalance`;
 *  - the recipient must be an ACTIVE account whose balance currency is USDT;
 *  - the balance is never overwritten: the delta is applied through
 *    `postLedgerEntry`, which appends the immutable ledger row and moves the
 *    AVAILABLE bucket in the same database transaction;
 *  - the reference is the idempotency key: replaying the same reference returns
 *    the original entry instead of crediting twice, and a reference reused for a
 *    different amount/account is refused;
 *  - every credit writes an audit row with the before/after balance, the actor,
 *    the IP and the user agent;
 *  - corrections are new adjustments, never edits: the ledger stays append-only.
 */

export class AdminCreditError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "AdminCreditError";
    this.code = code;
    this.status = status;
  }
}

export interface AdminCreditInput {
  userId: string;
  actorUserId: string;
  amount: Prisma.Decimal;
  reason: string;
  /** External reference supplied by finance; becomes the idempotency key. */
  reference: string;
  meta?: RequestMeta;
}

export interface AdminCreditResult {
  id: string;
  userId: string;
  amount: string;
  currency: "USDT";
  reference: string;
  balanceBefore: string;
  balanceAfter: string;
  creditedAt: string;
  /** True when the reference was already processed: nothing was written again. */
  idempotent: boolean;
}

const MAX_SERIALIZABLE_ATTEMPTS = 3;

function isSerializationFailure(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function assertValidAmount(amount: Prisma.Decimal): void {
  if (!amount.gt(0) || amount.decimalPlaces() > 2) {
    throw new AdminCreditError(
      "INVALID_AMOUNT",
      "Jumlah kredit harus berupa USDT positif dengan maksimal dua desimal.",
      422,
    );
  }
}

function ledgerReference(reference: string): string {
  return `admin-credit:${reference}`;
}

async function runSerializable<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < MAX_SERIALIZABLE_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (!isSerializationFailure(error)) throw error;
      if (attempt === MAX_SERIALIZABLE_ATTEMPTS - 1) {
        throw new AdminCreditError("CONFLICT_RETRY", "Transaksi bertabrakan. Silakan coba lagi.", 409);
      }
    }
  }
  throw new AdminCreditError("CONFLICT_RETRY", "Transaksi bertabrakan. Silakan coba lagi.", 409);
}

/** Credits one member explicitly; the ledger row and audit row commit together. */
export async function creditBalanceByAdmin(input: AdminCreditInput): Promise<AdminCreditResult> {
  assertValidAmount(input.amount);
  const reference = input.reference.trim();
  const reason = input.reason.trim();
  if (!reference || !reason) {
    throw new AdminCreditError("INVALID_INPUT", "Alasan dan referensi wajib diisi.", 422);
  }

  try {
    return await runSerializable(async (tx) => {
      const actor = await tx.user.findUnique({
        where: { id: input.actorUserId },
        select: { id: true, username: true, role: true, status: true, adminRole: true },
      });
      if (
        !actor ||
        actor.role !== "ADMIN" ||
        actor.status !== "ACTIVE" ||
        !canAdmin(actor.adminRole as AdminRole | null, "creditBalance")
      ) {
        throw new AdminCreditError("FORBIDDEN", "Peran SUPER_ADMIN aktif diperlukan.", 403);
      }

      const target = await tx.user.findUnique({
        where: { id: input.userId },
        select: { id: true, username: true, status: true, balance: { select: { currency: true } } },
      });
      if (!target || target.status !== "ACTIVE") {
        throw new AdminCreditError("USER_NOT_ELIGIBLE", "Akun penerima tidak ditemukan atau tidak aktif.", 409);
      }
      if (target.balance?.currency && target.balance.currency.toUpperCase() !== "USDT") {
        throw new AdminCreditError("CURRENCY_MISMATCH", "Saldo akun penerima bukan USDT.", 409);
      }

      const referenceKey = ledgerReference(reference);
      const existing = await tx.transaction.findUnique({
        where: { reference: referenceKey },
        select: {
          id: true,
          userId: true,
          amount: true,
          currency: true,
          balanceBefore: true,
          balanceAfter: true,
          createdAt: true,
        },
      });
      if (existing) {
        if (
          existing.userId !== target.id ||
          !existing.amount.equals(input.amount) ||
          existing.currency !== "USDT"
        ) {
          throw new AdminCreditError(
            "REFERENCE_CONFLICT",
            "Referensi ini sudah dipakai untuk kredit dengan akun atau jumlah yang berbeda.",
            409,
          );
        }
        return {
          id: existing.id,
          userId: existing.userId,
          amount: existing.amount.toFixed(2),
          currency: "USDT" as const,
          reference,
          balanceBefore: existing.balanceBefore.toFixed(2),
          balanceAfter: existing.balanceAfter.toFixed(2),
          creditedAt: existing.createdAt.toISOString(),
          idempotent: true,
        };
      }

      let entry;
      try {
        entry = await postLedgerEntry(tx, {
          userId: target.id,
          type: "ADMIN_CREDIT",
          bucket: "AVAILABLE",
          amount: input.amount,
          currency: "USDT",
          reference: referenceKey,
          description: `Kredit administrator ${input.amount.toFixed(2)} USDT: ${reason}`,
          metadata: {
            kind: "ADMIN_CREDIT",
            externalReference: reference,
            reason,
            actorUserId: actor.id,
            actorUsername: actor.username,
            recipientUsername: target.username,
          },
        });
      } catch (error) {
        if (error instanceof LedgerError) throw new AdminCreditError(error.code, error.message, 409);
        throw error;
      }

      await tx.auditLog.create({
        data: {
          actorUserId: actor.id,
          action: "admin.credit_granted",
          entityType: "Transaction",
          entityId: entry.id,
          before: {
            userId: target.id,
            username: target.username,
            currency: "USDT",
            balance: entry.balanceBefore.toFixed(2),
          },
          after: {
            userId: target.id,
            username: target.username,
            amount: entry.amount.toFixed(2),
            currency: "USDT",
            balance: entry.balanceAfter.toFixed(2),
            reference,
            reason,
            actorUserId: actor.id,
          },
          ipAddress: input.meta?.ipAddress ?? null,
          userAgent: input.meta?.userAgent ?? null,
        },
      });

      await tx.notification.create({
        data: {
          userId: target.id,
          type: "SYSTEM",
          title: "Kredit saldo diterima",
          body: `${entry.amount.toFixed(2)} USDT telah dikreditkan oleh administrator. Referensi: ${reference}.`,
          metadata: {
            transactionId: entry.id,
            reference,
            kind: "ADMIN_CREDIT",
            amount: entry.amount.toFixed(2),
            currency: entry.currency,
            href: "/transactions",
          },
        },
      });

      return {
        id: entry.id,
        userId: target.id,
        amount: entry.amount.toFixed(2),
        currency: "USDT" as const,
        reference,
        balanceBefore: entry.balanceBefore.toFixed(2),
        balanceAfter: entry.balanceAfter.toFixed(2),
        creditedAt: entry.createdAt.toISOString(),
        idempotent: false,
      };
    });
  } catch (error) {
    if (error instanceof AdminCreditError) throw error;
    if (isUniqueViolation(error)) {
      throw new AdminCreditError("CREDIT_ALREADY_EXISTS", "Referensi kredit sudah diproses.", 409);
    }
    throw error;
  }
}

export interface CreditRecipientRow {
  id: string;
  username: string;
  name: string;
  email: string;
}

/** Active member accounts that may receive an explicit administrator credit. */
export async function listCreditRecipients(take = 200): Promise<CreditRecipientRow[]> {
  return prisma.user.findMany({
    where: { status: "ACTIVE", role: "USER" },
    orderBy: { username: "asc" },
    take,
    select: { id: true, username: true, name: true, email: true },
  });
}

