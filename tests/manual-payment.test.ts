import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { Prisma, type AdminRole } from "@prisma/client";
import { createTestPrismaClient } from "./helpers/prisma";

import { getBalance, postLedgerEntry, verifyBalanceInvariant } from "../src/lib/services/ledger-service";
import { joinProgramTier } from "../src/lib/services/program-service";
import {
  PaymentError,
  createDepositRequest,
  createWithdrawalRequest,
  getAdminDashboardMetrics,
  listAuditTrail,
  listWithdrawalsForAdmin,
  listWithdrawalsForUser,
  reviewDepositRequest,
  reviewWithdrawalRequest,
} from "../src/lib/services/manual-payment-service";

/**
 * Integration tests for the manual payment workflow against the real PostgreSQL
 * database. They create an isolated program, tier and accounts, then remove
 * everything again (the append-only trigger protects ledger rows, so the teardown
 * unlocks the purge for its own transaction only).
 */
const prisma = createTestPrismaClient();
const stamp = `${Date.now()}`.slice(-7);
const meta = { ipAddress: "198.18.9.9", userAgent: "node-test-manual-payment" };
const joinAmount = new Prisma.Decimal("100.00");

let programId = "";
let tierId = "";
const createdUserIds: string[] = [];
let userCounter = 0;
let referenceCounter = 0;

async function createUser(
  label: string,
  role: "USER" | "ADMIN" = "USER",
  adminRole: AdminRole | null = null,
) {
  userCounter += 1;
  const username = `${label}_${stamp}_${userCounter}`;
  const user = await prisma.user.create({
    data: {
      name: `Uji ${label}`,
      username,
      email: `${username}@example.com`,
      phone: `+6288${stamp}${userCounter}`,
      // A pre-computed bcrypt shaped hash: these accounts never sign in.
      passwordHash: "$2b$10$abcdefghijklmnopqrstuvABCDEFGHIJKLMNOPQRSTUVWXYZ012345",
      role,
      adminRole,
    },
    select: { id: true, username: true },
  });
  createdUserIds.push(user.id);
  return user;
}

/** Gives a member spendable balance so a withdrawal has something to reserve. */
async function fundAvailable(userId: string, amount: Prisma.Decimal) {
  await prisma.$transaction(async (tx) => {
    await postLedgerEntry(tx, {
      userId,
      type: "REWARD",
      bucket: "AVAILABLE",
      amount,
      reference: `test:fund:${userId}`,
      description: "Saldo uji untuk penarikan",
    });
  });
}

async function submitDeposit(
  userId: string,
  userProgramId: string,
  overrides: { amount?: Prisma.Decimal; paymentMethod?: string } = {},
) {
  referenceCounter += 1;
  const reference = `REF-${stamp}-${referenceCounter}`;
  return createDepositRequest({
    userId,
    userProgramId,
    amount: overrides.amount ?? joinAmount,
    paymentMethod: overrides.paymentMethod ?? "BANK_TRANSFER",
    paymentReference: reference,
    proof: {
      storageKey: `proofs/${stamp}-${referenceCounter}.png`,
      fileName: "bukti.png",
      mimeType: "image/png",
      size: 4096,
    },
    meta,
  });
}

before(async () => {
  const program = await prisma.program.create({
    data: {
      code: `PAY-${stamp}`,
      name: "Program uji pembayaran manual",
      currency: "USDT",
      weeklyRewardRate: new Prisma.Decimal("0.1000"),
      cycleWeeks: 4,
      maxCycleRewardRate: new Prisma.Decimal("0.4000"),
      status: "ACTIVE",
      isDefault: false,
      tiers: {
        create: [{ code: `USDT-100-${stamp}`, name: "Uji USDT 100", joinAmount, sortOrder: 1 }],
      },
    },
    select: { id: true, tiers: { select: { id: true } } },
  });

  programId = program.id;
  tierId = program.tiers[0]!.id;
});

after(async () => {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL tatorprofit.allow_ledger_purge = 'on'");
    await tx.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });
  await prisma.programTier.deleteMany({ where: { programId } });
  await prisma.program.delete({ where: { id: programId } });
  await prisma.$disconnect();
});
test("permintaan setoran tidak mengkredit apa pun sebelum disetujui admin", async () => {
  const user = await createUser("depositor");
  const membership = await joinProgramTier(user.id, tierId, meta);

  const result = await submitDeposit(user.id, membership.userProgramId);

  assert.equal(result.status, "PENDING");
  assert.equal(result.amount, "100.00");
  assert.equal(result.currency, "USDT");

  const [row, balance, member, entries] = await Promise.all([
    prisma.depositRequest.findUnique({ where: { id: result.id }, select: { status: true } }),
    getBalance(user.id),
    prisma.userProgram.findUnique({
      where: { id: membership.userProgramId },
      select: { status: true },
    }),
    prisma.transaction.findMany({ where: { userId: user.id }, select: { bucket: true } }),
  ]);

  assert.equal(row?.status, "PENDING");
  assert.equal(member?.status, "PENDING");
  assert.equal(balance.programFundsAmount.toFixed(2), "0.00");
  assert.equal(balance.availableAmount.toFixed(2), "0.00");
  assert.equal(balance.reservedAmount.toFixed(2), "0.00");
  // The claim is documented as a non-monetary ledger event.
  assert.ok(entries.some((entry) => entry.bucket === "NONE"));
  assert.ok(!entries.some((entry) => entry.bucket === "PROGRAM_FUNDS"));

  const invariant = await verifyBalanceInvariant(prisma, user.id);
  assert.equal(invariant.ok, true);
});

test("setoran menolak jumlah yang tidak sama dengan nilai gabung keanggotaan", async () => {
  const user = await createUser("mismatch");
  const membership = await joinProgramTier(user.id, tierId, meta);

  await assert.rejects(
    () => submitDeposit(user.id, membership.userProgramId, { amount: new Prisma.Decimal("99.00") }),
    (error: unknown) =>
      error instanceof PaymentError && error.code === "DEPOSIT_AMOUNT_MISMATCH" && error.status === 422,
  );

  assert.equal(await prisma.depositRequest.count({ where: { userId: user.id } }), 0);
});

test("setoran kedua untuk keanggotaan yang sama selalu ditolak, termasuk saat ditandai", async () => {
  const user = await createUser("duplicate");
  const membership = await joinProgramTier(user.id, tierId, meta);
  const first = await submitDeposit(user.id, membership.userProgramId);

  await assert.rejects(
    () => submitDeposit(user.id, membership.userProgramId),
    (error: unknown) =>
      error instanceof PaymentError && error.code === "DEPOSIT_ALREADY_EXISTS" && error.status === 409,
  );

  const compliance = await createUser("compliance_dup", "ADMIN", "COMPLIANCE");
  await reviewDepositRequest({
    depositId: first.id,
    actorUserId: compliance.id,
    actorAdminRole: "COMPLIANCE",
    action: "FLAGGED",
    reason: "Bukti perlu ditinjau",
    meta,
  });

  // FLAGGED is outside the partial unique index, so the service must still refuse.
  await assert.rejects(
    () => submitDeposit(user.id, membership.userProgramId),
    (error: unknown) => error instanceof PaymentError && error.code === "DEPOSIT_ALREADY_EXISTS",
  );
});

test("peninjauan menolak aktor tanpa peran admin aktif dan tidak mempercayai actorAdminRole", async () => {
  const user = await createUser("owner_rbac");
  const membership = await joinProgramTier(user.id, tierId, meta);
  const deposit = await submitDeposit(user.id, membership.userProgramId);

  const adminWithoutRole = await createUser("admin_null_role", "ADMIN", null);
  const regularUser = await createUser("regular_user", "USER", null);

  for (const actorId of [adminWithoutRole.id, regularUser.id, user.id]) {
    await assert.rejects(
      () =>
        reviewDepositRequest({
          depositId: deposit.id,
          actorUserId: actorId,
          // A forged role must be ignored: the database role is authoritative.
          actorAdminRole: "SUPER_ADMIN",
          action: "UNDER_REVIEW",
          meta,
        }),
      (error: unknown) =>
        error instanceof PaymentError && error.code === "FORBIDDEN" && error.status === 403,
    );
  }

  const row = await prisma.depositRequest.findUnique({
    where: { id: deposit.id },
    select: { status: true, reviewedByUserId: true },
  });
  assert.equal(row?.status, "PENDING");
  assert.equal(row?.reviewedByUserId, null);
});

test("COMPLIANCE hanya boleh meninjau dan menandai, bukan menyetujui", async () => {
  const user = await createUser("compliance_owner");
  const membership = await joinProgramTier(user.id, tierId, meta);
  const deposit = await submitDeposit(user.id, membership.userProgramId);
  const compliance = await createUser("compliance_only", "ADMIN", "COMPLIANCE");

  await assert.rejects(
    () =>
      reviewDepositRequest({
        depositId: deposit.id,
        actorUserId: compliance.id,
        actorAdminRole: "COMPLIANCE",
        action: "APPROVED",
        meta,
      }),
    (error: unknown) => error instanceof PaymentError && error.code === "FORBIDDEN",
  );

  const underReview = await reviewDepositRequest({
    depositId: deposit.id,
    actorUserId: compliance.id,
    actorAdminRole: "COMPLIANCE",
    action: "UNDER_REVIEW",
    meta,
  });
  assert.equal(underReview.status, "UNDER_REVIEW");

  const flagged = await reviewDepositRequest({
    depositId: deposit.id,
    actorUserId: compliance.id,
    actorAdminRole: "COMPLIANCE",
    action: "FLAGGED",
    reason: "Nominal tidak terbaca",
    meta,
  });
  assert.equal(flagged.status, "FLAGGED");
});

test("alasan wajib diisi untuk menolak atau menandai setoran", async () => {
  const user = await createUser("needs_reason");
  const membership = await joinProgramTier(user.id, tierId, meta);
  const deposit = await submitDeposit(user.id, membership.userProgramId);
  const finance = await createUser("finance_reason", "ADMIN", "FINANCE");

  await assert.rejects(
    () =>
      reviewDepositRequest({
        depositId: deposit.id,
        actorUserId: finance.id,
        actorAdminRole: "FINANCE",
        action: "REJECTED",
        meta,
      }),
    (error: unknown) =>
      error instanceof PaymentError && error.code === "REASON_REQUIRED" && error.status === 422,
  );
});

test("persetujuan setoran mengaktifkan program, mengkredit dana program, dan mencatat imbalan dalam satu transaksi", async () => {
  const user = await createUser("approvee");
  const membership = await joinProgramTier(user.id, tierId, meta);
  const deposit = await submitDeposit(user.id, membership.userProgramId);
  const finance = await createUser("finance_approve", "ADMIN", "FINANCE");

  const result = await reviewDepositRequest({
    depositId: deposit.id,
    actorUserId: finance.id,
    actorAdminRole: "FINANCE",
    action: "APPROVED",
    reason: "Dana diterima di rekening perusahaan",
    meta,
  });

  assert.equal(result.status, "APPROVED");
  assert.equal(result.membershipStatus, "ACTIVE");
  assert.equal(result.amount, "100.00");
  assert.ok(result.ledgerReference, "kredit dana program harus memiliki referensi buku besar");
  assert.equal(result.rewardsCreated, 1);

  const [member, balance, rewardCount, audit] = await Promise.all([
    prisma.userProgram.findUnique({
      where: { id: membership.userProgramId },
      select: { status: true, fundsConfirmedAmount: true },
    }),
    getBalance(user.id),
    prisma.reward.count({ where: { userProgramId: membership.userProgramId } }),
    prisma.auditLog.findFirst({
      where: { entityType: "DepositRequest", entityId: deposit.id, action: "deposit.approved" },
      select: { ipAddress: true, userAgent: true, before: true, after: true },
    }),
  ]);

  assert.equal(member?.status, "ACTIVE");
  assert.equal(member?.fundsConfirmedAmount.toFixed(2), "100.00");
  // Program funds are never mixed into the spendable reward balance.
  assert.equal(balance.programFundsAmount.toFixed(2), "100.00");
  assert.equal(balance.availableAmount.toFixed(2), "0.00");
  assert.equal(rewardCount, 1);
  assert.ok(audit);
  assert.equal(audit?.ipAddress, meta.ipAddress);
  assert.equal(audit?.userAgent, meta.userAgent);

  const invariant = await verifyBalanceInvariant(prisma, user.id);
  assert.equal(invariant.ok, true);

  const trail = await listAuditTrail("DepositRequest", deposit.id);
  assert.equal(trail.length, 2);
  assert.equal(trail[0]?.action, "deposit.approved");
  assert.equal(trail[0]?.actorUsername, finance.username);
});

test("keputusan akhir setoran tidak dapat diputar ulang", async () => {
  const user = await createUser("replay_deposit");
  const membership = await joinProgramTier(user.id, tierId, meta);
  const deposit = await submitDeposit(user.id, membership.userProgramId);
  const finance = await createUser("finance_replay", "ADMIN", "FINANCE");

  await reviewDepositRequest({
    depositId: deposit.id,
    actorUserId: finance.id,
    actorAdminRole: "FINANCE",
    action: "APPROVED",
    meta,
  });

  await assert.rejects(
    () =>
      reviewDepositRequest({
        depositId: deposit.id,
        actorUserId: finance.id,
        actorAdminRole: "FINANCE",
        action: "APPROVED",
        meta,
      }),
    (error: unknown) =>
      error instanceof PaymentError && error.code === "INVALID_DEPOSIT_STATUS" && error.status === 409,
  );

  // Exactly one credit was created despite the replay attempt.
  const credits = await prisma.transaction.count({
    where: { userProgramId: membership.userProgramId, bucket: "PROGRAM_FUNDS" },
  });
  assert.equal(credits, 1);
});

test("setoran tidak dapat diajukan setelah keanggotaan aktif", async () => {
  const user = await createUser("already_active");
  const membership = await joinProgramTier(user.id, tierId, meta);
  const deposit = await submitDeposit(user.id, membership.userProgramId);
  const finance = await createUser("finance_active", "ADMIN", "FINANCE");

  await reviewDepositRequest({
    depositId: deposit.id,
    actorUserId: finance.id,
    actorAdminRole: "FINANCE",
    action: "APPROVED",
    meta,
  });

  await assert.rejects(
    () => submitDeposit(user.id, membership.userProgramId),
    (error: unknown) =>
      error instanceof PaymentError && error.code === "MEMBERSHIP_NOT_PENDING" && error.status === 409,
  );
});

test("penarikan memesan saldo dan hanya mendebit cadangan permanen saat selesai", async () => {
  const user = await createUser("withdrawer");
  await fundAvailable(user.id, new Prisma.Decimal("500.00"));

  const withdrawal = await createWithdrawalRequest({
    userId: user.id,
    amount: new Prisma.Decimal("200.00"),
    method: "BANK_TRANSFER",
    destination: "BCA 1234567890",
    notes: "Penarikan uji",
    meta,
  });

  assert.equal(withdrawal.status, "PENDING");
  assert.ok(withdrawal.reservedReference);
  // Gross 200 -> fee 10% = 20, net payable = 180. The reserved amount is the gross.
  assert.equal(withdrawal.amount, "200.00");
  assert.equal(withdrawal.fee, "20.00");
  assert.equal(withdrawal.netAmount, "180.00");

  let balance = await getBalance(user.id);
  assert.equal(balance.availableAmount.toFixed(2), "300.00");
  assert.equal(balance.reservedAmount.toFixed(2), "200.00");

  await assert.rejects(
    () =>
      createWithdrawalRequest({
        userId: user.id,
        amount: new Prisma.Decimal("10.00"),
        method: "BANK_TRANSFER",
        destination: "BCA 1234567890",
        meta,
      }),
    (error: unknown) =>
      error instanceof PaymentError && error.code === "WITHDRAWAL_ALREADY_OPEN" && error.status === 409,
  );

  const finance = await createUser("finance_withdrawal", "ADMIN", "FINANCE");
  const approved = await reviewWithdrawalRequest({
    withdrawalId: withdrawal.id,
    actorUserId: finance.id,
    actorAdminRole: "FINANCE",
    action: "APPROVED",
    meta,
  });
  assert.equal(approved.status, "APPROVED");
  assert.equal(approved.settled, false);

  balance = await getBalance(user.id);
  assert.equal(balance.availableAmount.toFixed(2), "300.00");
  assert.equal(balance.reservedAmount.toFixed(2), "200.00");

  const processing = await reviewWithdrawalRequest({
    withdrawalId: withdrawal.id,
    actorUserId: finance.id,
    actorAdminRole: "FINANCE",
    action: "PROCESSING",
    meta,
  });
  assert.equal(processing.status, "PROCESSING");

  const completed = await reviewWithdrawalRequest({
    withdrawalId: withdrawal.id,
    actorUserId: finance.id,
    actorAdminRole: "FINANCE",
    action: "COMPLETED",
    meta,
  });
  assert.equal(completed.status, "COMPLETED");
  assert.equal(completed.settled, true);
  assert.ok(completed.completionReference);
  // Approving/settling never re-derives or re-deducts the fee.
  assert.equal(completed.amount, "200.00");
  assert.equal(completed.fee, "20.00");
  assert.equal(completed.netAmount, "180.00");

  balance = await getBalance(user.id);
  assert.equal(balance.availableAmount.toFixed(2), "300.00");
  assert.equal(balance.reservedAmount.toFixed(2), "0.00");

  // The reservation is debited exactly once even though the fee is part of it.
  const completedDebits = await prisma.transaction.findMany({
    where: { userId: user.id, reference: `withdrawal:${withdrawal.id}:complete:reserved` },
    select: { amount: true },
  });
  assert.equal(completedDebits.length, 1);
  assert.equal(completedDebits[0]?.amount.toFixed(2), "-200.00");

  const invariant = await verifyBalanceInvariant(prisma, user.id);
  assert.equal(invariant.ok, true);
});

test("bukti transfer penarikan tersimpan saat selesai dan ditolak pada aksi lain", async () => {
  const user = await createUser("withdrawal_proof");
  await fundAvailable(user.id, new Prisma.Decimal("300.00"));

  const withdrawal = await createWithdrawalRequest({
    userId: user.id,
    amount: new Prisma.Decimal("100.00"),
    method: "BANK_TRANSFER",
    destination: "BCA 9988776655",
    meta,
  });

  const finance = await createUser("finance_proof", "ADMIN", "FINANCE");
  const proof = {
    storageKey: `proofs/withdrawal-${stamp}.png`,
    fileName: "bukti-transfer.png",
    mimeType: "image/png",
    size: 2048,
  };

  // A proof is only meaningful when the payout is finalised: the service refuses
  // to attach it to an intermediate action so a stray upload cannot leak into
  // the queue.
  await assert.rejects(
    () =>
      reviewWithdrawalRequest({
        withdrawalId: withdrawal.id,
        actorUserId: finance.id,
        actorAdminRole: "FINANCE",
        action: "APPROVED",
        proof,
        meta,
      }),
    (error: unknown) =>
      error instanceof PaymentError && error.code === "INVALID_PROOF_ACTION" && error.status === 422,
  );

  await reviewWithdrawalRequest({
    withdrawalId: withdrawal.id,
    actorUserId: finance.id,
    actorAdminRole: "FINANCE",
    action: "APPROVED",
    meta,
  });
  await reviewWithdrawalRequest({
    withdrawalId: withdrawal.id,
    actorUserId: finance.id,
    actorAdminRole: "FINANCE",
    action: "PROCESSING",
    meta,
  });
  const completed = await reviewWithdrawalRequest({
    withdrawalId: withdrawal.id,
    actorUserId: finance.id,
    actorAdminRole: "FINANCE",
    action: "COMPLETED",
    proof,
    meta,
  });
  assert.equal(completed.status, "COMPLETED");

  const stored = await prisma.withdrawalRequest.findUnique({
    where: { id: withdrawal.id },
    select: {
      proofStorageKey: true,
      proofFileName: true,
      proofMimeType: true,
      proofSize: true,
    },
  });
  assert.equal(stored?.proofStorageKey, proof.storageKey);
  assert.equal(stored?.proofFileName, proof.fileName);
  assert.equal(stored?.proofMimeType, proof.mimeType);
  assert.equal(stored?.proofSize, proof.size);

  // The attachment is recorded on the audit snapshot too, so the trail shows who
  // uploaded the receipt and when.
  const audit = await prisma.auditLog.findFirst({
    where: { entityType: "WithdrawalRequest", entityId: withdrawal.id, action: "withdrawal.completed" },
    select: { after: true },
  });
  const after = audit?.after as Record<string, unknown> | null;
  assert.equal(after?.proofFileName, proof.fileName);

  // A completed request is terminal: a second proof cannot rewrite history.
  await assert.rejects(
    () =>
      reviewWithdrawalRequest({
        withdrawalId: withdrawal.id,
        actorUserId: finance.id,
        actorAdminRole: "FINANCE",
        action: "COMPLETED",
        proof,
        meta,
      }),
    (error: unknown) => error instanceof PaymentError && error.status === 409,
  );
});
test("penolakan penarikan membebaskan cadangan ke saldo tersedia", async () => {
  const user = await createUser("reject_withdrawal");
  await fundAvailable(user.id, new Prisma.Decimal("150.00"));

  const withdrawal = await createWithdrawalRequest({
    userId: user.id,
    amount: new Prisma.Decimal("100.00"),
    method: "EWALLET",
    destination: "0812345678",
    meta,
  });

  const finance = await createUser("finance_reject", "ADMIN", "FINANCE");
  const rejected = await reviewWithdrawalRequest({
    withdrawalId: withdrawal.id,
    actorUserId: finance.id,
    actorAdminRole: "FINANCE",
    action: "REJECTED",
    reason: "Tujuan tidak valid",
    meta,
  });

  assert.equal(rejected.status, "REJECTED");
  assert.equal(rejected.released, true);

  const balance = await getBalance(user.id);
  assert.equal(balance.availableAmount.toFixed(2), "150.00");
  assert.equal(balance.reservedAmount.toFixed(2), "0.00");

  const invariant = await verifyBalanceInvariant(prisma, user.id);
  assert.equal(invariant.ok, true);
});

test("penarikan melebihi saldo tersedia ditolak tanpa meninggalkan permintaan", async () => {
  const user = await createUser("insufficient");
  await fundAvailable(user.id, new Prisma.Decimal("50.00"));

  await assert.rejects(
    () =>
      createWithdrawalRequest({
        userId: user.id,
        amount: new Prisma.Decimal("100.00"),
        method: "CRYPTO",
        destination: "bc1qexample",
        meta,
      }),
    (error: unknown) =>
      error instanceof PaymentError &&
      error.code === "INSUFFICIENT_AVAILABLE_BALANCE" &&
      error.status === 409,
  );

  const balance = await getBalance(user.id);
  assert.equal(balance.availableAmount.toFixed(2), "50.00");
  assert.equal(balance.reservedAmount.toFixed(2), "0.00");
  // The whole transaction rolled back: no orphan request, no orphan ledger row.
  assert.equal(await prisma.withdrawalRequest.count({ where: { userId: user.id } }), 0);
  assert.equal(
    await prisma.transaction.count({ where: { userId: user.id, bucket: "RESERVED" } }),
    0,
  );
});

test("biaya penarikan 10% dihitung dari bruto untuk 100/500/1000 USDT", async () => {
  const cases = [
    { gross: "100.00", fee: "10.00", net: "90.00" },
    { gross: "500.00", fee: "50.00", net: "450.00" },
    { gross: "1000.00", fee: "100.00", net: "900.00" },
  ];

  for (const [index, item] of cases.entries()) {
    const user = await createUser(`fee_case_${index}`);
    await fundAvailable(user.id, new Prisma.Decimal("2000.00"));

    const withdrawal = await createWithdrawalRequest({
      userId: user.id,
      amount: new Prisma.Decimal(item.gross),
      method: "BANK_TRANSFER",
      destination: `BCA 999000${index}`,
      meta,
    });

    assert.equal(withdrawal.amount, item.gross);
    assert.equal(withdrawal.fee, item.fee);
    assert.equal(withdrawal.netAmount, item.net);

    // The stored row matches exactly what the API returned (no display/storage drift).
    const row = await prisma.withdrawalRequest.findUnique({
      where: { id: withdrawal.id },
      select: { amount: true, fee: true, netAmount: true, idempotencyKey: true },
    });
    assert.equal(row?.amount.toFixed(2), item.gross);
    assert.equal(row?.fee?.toFixed(2), item.fee);
    assert.equal(row?.netAmount?.toFixed(2), item.net);

    // The gross is reserved; the fee is only a breakdown, never an extra charge.
    const balance = await getBalance(user.id);
    assert.equal(
      balance.availableAmount.toFixed(2),
      new Prisma.Decimal("2000.00").minus(item.gross).toFixed(2),
    );
    assert.equal(balance.reservedAmount.toFixed(2), item.gross);
  }
});

test("nominal penarikan nol atau negatif ditolak tanpa meninggalkan jejak", async () => {
  const user = await createUser("zero_withdrawal");
  await fundAvailable(user.id, new Prisma.Decimal("100.00"));

  for (const value of ["0.00", "0.001", "-10.00"]) {
    await assert.rejects(
      () =>
        createWithdrawalRequest({
          userId: user.id,
          amount: new Prisma.Decimal(value),
          method: "EWALLET",
          destination: "0812000000",
          meta,
        }),
      (error: unknown) => error instanceof PaymentError && error.code === "INVALID_AMOUNT",
    );
  }

  assert.equal(await prisma.withdrawalRequest.count({ where: { userId: user.id } }), 0);
  const balance = await getBalance(user.id);
  assert.equal(balance.availableAmount.toFixed(2), "100.00");
});

test("klik berulang dengan kunci idempotensi tidak memotong saldo dua kali", async () => {
  const user = await createUser("idempotent_withdrawal");
  await fundAvailable(user.id, new Prisma.Decimal("300.00"));

  const key = randomUUID();
  const input = {
    userId: user.id,
    amount: new Prisma.Decimal("100.00"),
    method: "BANK_TRANSFER",
    destination: "BCA 123123",
    idempotencyKey: key,
    meta,
  };

  const first = await createWithdrawalRequest(input);
  const second = await createWithdrawalRequest(input);

  assert.equal(first.id, second.id);
  assert.equal(first.fee, "10.00");
  assert.equal(second.fee, "10.00");
  assert.equal(await prisma.withdrawalRequest.count({ where: { userId: user.id } }), 1);

  const balance = await getBalance(user.id);
  assert.equal(balance.availableAmount.toFixed(2), "200.00");
  assert.equal(balance.reservedAmount.toFixed(2), "100.00");
});

test("riwayat penarikan mencatat bruto, biaya, netto, dan status", async () => {
  const user = await createUser("history_withdrawal");
  await fundAvailable(user.id, new Prisma.Decimal("150.00"));

  await createWithdrawalRequest({
    userId: user.id,
    amount: new Prisma.Decimal("100.00"),
    method: "EWALLET",
    destination: "0812345678",
    meta,
  });

  const history = await listWithdrawalsForUser(user.id);
  assert.equal(history.length, 1);
  assert.equal(history[0]?.amount, "100.00");
  assert.equal(history[0]?.fee, "10.00");
  assert.equal(history[0]?.netAmount, "90.00");
  assert.equal(history[0]?.status, "PENDING");

  const adminRows = await listWithdrawalsForAdmin({ search: user.username });
  const adminRow = adminRows.find((row) => row.id === history[0]?.id);
  assert.equal(adminRow?.amount, "100.00");
  assert.equal(adminRow?.fee, "10.00");
  assert.equal(adminRow?.netAmount, "90.00");
});


test("peralihan penarikan yang tidak valid ditolak dengan kode bersih", async () => {
  const user = await createUser("bad_transition");
  await fundAvailable(user.id, new Prisma.Decimal("120.00"));

  const withdrawal = await createWithdrawalRequest({
    userId: user.id,
    amount: new Prisma.Decimal("20.00"),
    method: "BANK_TRANSFER",
    destination: "BNI 000111222",
    meta,
  });
  const finance = await createUser("finance_transition", "ADMIN", "FINANCE");

  // PENDING -> COMPLETED is not a legal transition: the money was never processed.
  await assert.rejects(
    () =>
      reviewWithdrawalRequest({
        withdrawalId: withdrawal.id,
        actorUserId: finance.id,
        actorAdminRole: "FINANCE",
        action: "COMPLETED",
        meta,
      }),
    (error: unknown) =>
      error instanceof PaymentError && error.code === "INVALID_WITHDRAWAL_STATUS" && error.status === 409,
  );

  // A REVIEWER (read-only) admin must not be able to review withdrawals.
  const viewer = await createUser("viewer_admin", "ADMIN", "VIEWER");
  await assert.rejects(
    () =>
      reviewWithdrawalRequest({
        withdrawalId: withdrawal.id,
        actorUserId: viewer.id,
        actorAdminRole: "VIEWER",
        action: "APPROVED",
        meta,
      }),
    (error: unknown) => error instanceof PaymentError && error.code === "FORBIDDEN",
  );

  const balance = await getBalance(user.id);
  assert.equal(balance.reservedAmount.toFixed(2), "20.00");
  assert.equal(balance.availableAmount.toFixed(2), "100.00");
});

test("metrik admin dan jejak audit dibaca dari data nyata", async () => {
  const metrics = await getAdminDashboardMetrics();
  assert.equal(typeof metrics.flaggedTotal, "number");
  assert.equal(typeof metrics.openWithdrawals, "number");
  assert.ok(metrics.deposits.FLAGGED >= 1, "setidaknya satu setoran ditandai di suite ini");
  assert.match(metrics.reservedAmount, /^\d+\.\d{2}$/);

  const user = await createUser("metrics_owner");
  const membership = await joinProgramTier(user.id, tierId, meta);
  const deposit = await submitDeposit(user.id, membership.userProgramId);
  const finance = await createUser("finance_metrics", "ADMIN", "FINANCE");

  await reviewDepositRequest({
    depositId: deposit.id,
    actorUserId: finance.id,
    actorAdminRole: "FINANCE",
    action: "REJECTED",
    reason: "Bukti tidak sesuai",
    meta,
  });

  const refreshed = await getAdminDashboardMetrics();
  assert.ok(refreshed.deposits.REJECTED >= 1);

  const trail = await listAuditTrail("DepositRequest", deposit.id);
  assert.equal(trail.length, 2);
  assert.equal(trail[0]?.action, "deposit.rejected");
  assert.equal(trail[0]?.ipAddress, meta.ipAddress);
  assert.equal(trail[0]?.userAgent, meta.userAgent);
  assert.ok(trail[0]?.after);
});

