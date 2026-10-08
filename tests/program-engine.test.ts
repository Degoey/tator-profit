import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { Prisma, PrismaClient } from "@prisma/client";

import {
  LedgerError,
  getBalance,
  postLedgerEntry,
  verifyBalanceInvariant,
} from "../src/lib/services/ledger-service";
import {
  ProgramError,
  activateUserProgram,
  joinProgramTier,
  setUserProgramStatus,
} from "../src/lib/services/program-service";
import {
  RewardError,
  approveReward,
  generateWeeklyRewards,
  getProgramProgress,
  payReward,
  voidReward,
} from "../src/lib/services/reward-service";

/**
 * Integration tests for the program + reward engine against the real PostgreSQL
 * database. They create an isolated test program, tiers and accounts, then remove
 * everything again (ledger rows are protected by the append-only trigger, so the
 * teardown unlocks the purge for its own transaction only).
 */
const prisma = new PrismaClient();
const stamp = `${Date.now()}`.slice(-7);
const meta = { ipAddress: "198.18.7.7", userAgent: "node-test" };

let programId = "";
let tierSmallId = "";
let tierLargeId = "";
const createdUserIds: string[] = [];
let userCounter = 0;

async function createUser(label: string, role: "USER" | "ADMIN" = "USER") {
  userCounter += 1;
  const username = `${label}_${stamp}`;
  const user = await prisma.user.create({
    data: {
      name: `Uji ${label}`,
      username,
      email: `${username}@example.com`,
      phone: `+6289${stamp}${userCounter}`,
      // A pre-computed bcrypt shaped hash: these accounts never sign in.
      passwordHash: "$2b$10$abcdefghijklmnopqrstuvABCDEFGHIJKLMNOPQRSTUVWXYZ012345",
      role,
    },
    select: { id: true, username: true },
  });
  createdUserIds.push(user.id);
  return user;
}

before(async () => {
  const program = await prisma.program.create({
    data: {
      code: `TEST-${stamp}`,
      name: "Program uji mesin imbalan",
      currency: "USDT",
      weeklyRewardRate: new Prisma.Decimal("0.1000"),
      cycleWeeks: 4,
      maxCycleRewardRate: new Prisma.Decimal("0.4000"),
      status: "ACTIVE",
      isDefault: false,
      tiers: {
        create: [
          {
            code: `USDT-10-${stamp}`,
            name: "Uji USDT 10",
            joinAmount: new Prisma.Decimal("10.00"),
            sortOrder: 1,
          },
          {
            code: `USDT-100-${stamp}`,
            name: "Uji USDT 100",
            joinAmount: new Prisma.Decimal("100.00"),
            sortOrder: 2,
          },
        ],
      },
    },
    select: { id: true, tiers: { select: { id: true, joinAmount: true } } },
  });

  programId = program.id;
  tierSmallId = program.tiers.find((tier) => tier.joinAmount.equals(10))!.id;
  tierLargeId = program.tiers.find((tier) => tier.joinAmount.equals(100))!.id;
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

test("gabung mencatat keanggotaan MENUNGGU, komitmen buku besar, dan tanpa kredit imbalan", async () => {
  const user = await createUser("joiner");
  const result = await joinProgramTier(user.id, tierSmallId, meta);

  assert.equal(result.status, "PENDING");
  assert.equal(result.joinAmount, "10.00");
  assert.equal(result.weeklyRewardTarget, "1.00");
  assert.equal(result.cycleRewardTarget, "4.00");

  const [membership, rewardCount, entries, balance] = await Promise.all([
    prisma.userProgram.findFirst({
      where: { userId: user.id },
      select: { status: true, weeklyRewardRate: true, cycleWeeks: true, fundsConfirmedAt: true },
    }),
    prisma.reward.count({ where: { userId: user.id } }),
    prisma.transaction.findMany({
      where: { userId: user.id },
      select: { type: true, bucket: true, amount: true },
    }),
    getBalance(user.id),
  ]);

  assert.equal(membership?.status, "PENDING");
  assert.equal(membership?.weeklyRewardRate.toFixed(4), "0.1000");
  assert.equal(membership?.cycleWeeks, 4);
  assert.equal(membership?.fundsConfirmedAt, null);
  assert.equal(rewardCount, 0, "tidak boleh ada imbalan sebelum dana dikonfirmasi");
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.type, "PROGRAM_JOIN");
  assert.equal(entries[0]?.bucket, "NONE");
  assert.equal(entries[0]?.amount.toFixed(2), "10.00");
  assert.equal(balance.availableAmount.toFixed(2), "0.00");
  assert.equal(balance.programFundsAmount.toFixed(2), "0.00");
});

test("gabung menolak keanggotaan terbuka kedua untuk paket yang sama", async () => {
  const user = await createUser("duplicate");
  await joinProgramTier(user.id, tierSmallId, meta);

  await assert.rejects(
    () => joinProgramTier(user.id, tierSmallId, meta),
    (error: unknown) => error instanceof ProgramError && error.code === "TIER_ALREADY_JOINED",
  );

  const memberships = await prisma.userProgram.count({ where: { userId: user.id } });
  assert.equal(memberships, 1);
});

test("aktivasi mencatat dana terpisah dari saldo imbalan dan memulai minggu 1", async () => {
  const admin = await createUser("admin", "ADMIN");
  const user = await createUser("activated");
  const join = await joinProgramTier(user.id, tierSmallId, meta);

  const activation = await activateUserProgram({
    userProgramId: join.userProgramId,
    actorUserId: admin.id,
    meta,
  });

  assert.equal(activation.status, "ACTIVE");
  assert.equal(activation.fundsConfirmedAmount, "10.00");
  assert.equal(activation.rewardsCreated, 1);

  const [membership, balance, reward, ledger] = await Promise.all([
    prisma.userProgram.findUniqueOrThrow({
      where: { id: join.userProgramId },
      select: { status: true, activatedAt: true, fundsConfirmedAmount: true },
    }),
    getBalance(user.id),
    prisma.reward.findFirstOrThrow({
      where: { userId: user.id },
      select: { amount: true, rate: true, period: true, status: true, scheduledFor: true },
    }),
    prisma.transaction.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
      select: { type: true, bucket: true, amount: true },
    }),
  ]);

  assert.equal(membership.status, "ACTIVE");
  assert.equal(membership.fundsConfirmedAmount.toFixed(2), "10.00");
  assert.equal(balance.programFundsAmount.toFixed(2), "10.00");
  assert.equal(balance.availableAmount.toFixed(2), "0.00");
  assert.equal(balance.pendingAmount.toFixed(2), "0.00");

  assert.equal(reward.period, 1);
  assert.equal(reward.status, "PENDING");
  assert.equal(reward.amount.toFixed(2), "1.00");
  assert.equal(reward.rate.toFixed(4), "0.1000");
  assert.equal(
    reward.scheduledFor?.toISOString(),
    new Date(membership.activatedAt!.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  );

  assert.equal(ledger.length, 2);
  assert.equal(ledger[1]?.bucket, "PROGRAM_FUNDS");
  assert.equal(ledger[1]?.amount.toFixed(2), "10.00");
});

test("menjalankan ulang mesin imbalan tidak pernah menggandakan periode", async () => {
  const admin = await createUser("admin-idem", "ADMIN");
  const user = await createUser("idempotent");
  const join = await joinProgramTier(user.id, tierSmallId, meta);
  await activateUserProgram({ userProgramId: join.userProgramId, actorUserId: admin.id, meta });

  const first = await generateWeeklyRewards({ actorUserId: admin.id, userProgramId: join.userProgramId });
  const second = await generateWeeklyRewards({ actorUserId: admin.id, userProgramId: join.userProgramId });

  assert.equal(first.created.length, 0, "minggu 1 sudah ada dari aktivasi");
  assert.equal(second.created.length, 0);
  assert.equal(second.skipped.length, 1);

  const rewards = await prisma.reward.findMany({
    where: { userId: user.id },
    select: { period: true, status: true },
  });
  assert.equal(rewards.length, 1);
  assert.equal(rewards[0]?.period, 1);
});

test("kunci unik memblokir periode ganda bahkan di luar mesin", async () => {
  const admin = await createUser("admin-unique", "ADMIN");
  const user = await createUser("unique");
  const join = await joinProgramTier(user.id, tierSmallId, meta);
  await activateUserProgram({ userProgramId: join.userProgramId, actorUserId: admin.id, meta });

  await assert.rejects(
    () =>
      prisma.reward.create({
        data: {
          userId: user.id,
          programId,
          userProgramId: join.userProgramId,
          tierId: tierSmallId,
          type: "WEEKLY",
          status: "PENDING",
          amount: new Prisma.Decimal("1.00"),
          rate: new Prisma.Decimal("0.1000"),
          period: 1,
          cycleNumber: 1,
        },
      }),
    (error: unknown) =>
      error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002",
  );

  const count = await prisma.reward.count({ where: { userId: user.id, period: 1 } });
  assert.equal(count, 1);
});

test("imbalan tidak dapat dibayar dua kali dan saldo dikreditkan sekali", async () => {
  const admin = await createUser("admin-pay", "ADMIN");
  const user = await createUser("paid");
  const join = await joinProgramTier(user.id, tierSmallId, meta);
  await activateUserProgram({ userProgramId: join.userProgramId, actorUserId: admin.id, meta });

  const reward = await prisma.reward.findFirstOrThrow({
    where: { userId: user.id },
    select: { id: true },
  });

  const approved = await approveReward(reward.id, admin.id, meta);
  assert.equal(approved.status, "APPROVED");

  const midPending = await getBalance(user.id);
  assert.equal(midPending.pendingAmount.toFixed(2), "1.00");
  assert.equal(midPending.availableAmount.toFixed(2), "0.00");

  const paid = await payReward(reward.id, admin.id, meta);
  assert.equal(paid.status, "PAID");
  assert.equal(paid.transactionId !== null, true);

  await assert.rejects(
    () => payReward(reward.id, admin.id, meta),
    (error: unknown) => error instanceof RewardError && error.code === "REWARD_ALREADY_PAID",
  );

  const [balance, paidEntries, releasedEntries] = await Promise.all([
    getBalance(user.id),
    prisma.transaction.count({ where: { reference: `reward:${reward.id}:paid` } }),
    prisma.transaction.count({ where: { reference: `reward:${reward.id}:release` } }),
  ]);

  assert.equal(balance.availableAmount.toFixed(2), "1.00");
  assert.equal(balance.pendingAmount.toFixed(2), "0.00");
  assert.equal(balance.totalEarned.toFixed(2), "1.00");
  assert.equal(paidEntries, 1);
  assert.equal(releasedEntries, 1);
});

test("langkah buku besar yang gagal membatalkan seluruh pembayaran", async () => {
  const admin = await createUser("admin-rollback", "ADMIN");
  const user = await createUser("rollback");
  const join = await joinProgramTier(user.id, tierSmallId, meta);
  await activateUserProgram({ userProgramId: join.userProgramId, actorUserId: admin.id, meta });

  const reward = await prisma.reward.findFirstOrThrow({
    where: { userId: user.id },
    select: { id: true },
  });
  await approveReward(reward.id, admin.id, meta);

  // Out-of-band corruption: the release entry can no longer be covered, so the
  // whole payout transaction must roll back instead of half-posting.
  await prisma.balance.update({
    where: { userId: user.id },
    data: { pendingAmount: new Prisma.Decimal(0) },
  });

  await assert.rejects(
    () => payReward(reward.id, admin.id, meta),
    (error: unknown) => error instanceof LedgerError && error.code === "INSUFFICIENT_BALANCE",
  );

  const [after, paidRows, releaseRows] = await Promise.all([
    prisma.reward.findUniqueOrThrow({
      where: { id: reward.id },
      select: { status: true, paidAt: true, transactionId: true },
    }),
    prisma.transaction.count({ where: { reference: `reward:${reward.id}:paid` } }),
    prisma.transaction.count({ where: { reference: `reward:${reward.id}:release` } }),
  ]);

  assert.equal(after.status, "APPROVED", "pembayaran yang gagal harus membiarkan imbalan tetap disetujui");
  assert.equal(after.paidAt, null);
  assert.equal(after.transactionId, null);
  assert.equal(paidRows, 0);
  assert.equal(releaseRows, 0);
});


test("beberapa program menambah periode imbalan independen untuk satu anggota", async () => {
  const admin = await createUser("admin-multi", "ADMIN");
  const user = await createUser("multi");

  const small = await joinProgramTier(user.id, tierSmallId, meta);
  const large = await joinProgramTier(user.id, tierLargeId, meta);
  assert.notEqual(small.userProgramId, large.userProgramId);
  assert.equal(large.weeklyRewardTarget, "10.00");
  assert.equal(large.cycleRewardTarget, "40.00");

  await activateUserProgram({ userProgramId: small.userProgramId, actorUserId: admin.id, meta });
  await activateUserProgram({ userProgramId: large.userProgramId, actorUserId: admin.id, meta });

  const rewards = await prisma.reward.findMany({
    where: { userId: user.id },
    orderBy: { amount: "asc" },
    select: { userProgramId: true, period: true, amount: true, status: true },
  });

  assert.equal(rewards.length, 2);
  assert.equal(rewards[0]?.amount.toFixed(2), "1.00");
  assert.equal(rewards[1]?.amount.toFixed(2), "10.00");
  assert.equal(rewards[0]?.userProgramId, small.userProgramId);
  assert.equal(rewards[1]?.userProgramId, large.userProgramId);
  assert.equal(
    rewards.every((row) => row.status === "PENDING" && row.period === 1),
    true,
  );

  const balance = await getBalance(user.id);
  assert.equal(balance.programFundsAmount.toFixed(2), "110.00");
});

test("membatalkan imbalan yang sudah dibayar menambah PENYESUAIAN, bukan menghapus riwayat", async () => {
  const admin = await createUser("admin-void", "ADMIN");
  const user = await createUser("voided");
  const join = await joinProgramTier(user.id, tierSmallId, meta);
  await activateUserProgram({ userProgramId: join.userProgramId, actorUserId: admin.id, meta });

  const reward = await prisma.reward.findFirstOrThrow({
    where: { userId: user.id },
    select: { id: true },
  });
  await approveReward(reward.id, admin.id, meta);
  await payReward(reward.id, admin.id, meta);

  const voided = await voidReward(reward.id, admin.id, "Pelanggaran aturan program", meta);
  assert.equal(voided.status, "VOID");

  const [row, balance, adjustment, paidRows] = await Promise.all([
    prisma.reward.findUniqueOrThrow({
      where: { id: reward.id },
      select: { status: true, paidAt: true, transactionId: true },
    }),
    getBalance(user.id),
    prisma.transaction.findFirstOrThrow({
      where: { reference: `reward:${reward.id}:void` },
      select: { type: true, bucket: true, amount: true },
    }),
    prisma.transaction.count({ where: { reference: `reward:${reward.id}:paid` } }),
  ]);

  assert.equal(row.status, "VOID");
  assert.equal(row.paidAt !== null, true, "pembayaran asli tetap ada di riwayat");
  assert.equal(row.transactionId !== null, true);
  assert.equal(paidRows, 1);
  assert.equal(adjustment.type, "ADJUSTMENT");
  assert.equal(adjustment.bucket, "AVAILABLE");
  assert.equal(adjustment.amount.toFixed(2), "-1.00");
  assert.equal(balance.availableAmount.toFixed(2), "0.00");
  assert.equal(balance.totalReversed.toFixed(2), "1.00");
});

test("baris buku besar hanya dapat ditambah di database", async () => {
  const user = await createUser("ledger");
  await joinProgramTier(user.id, tierSmallId, meta);

  const pendingEntry = await postLedgerEntry(prisma, {
    userId: user.id,
    type: "ADJUSTMENT",
    bucket: "NONE",
    amount: new Prisma.Decimal("0.00"),
    reference: `test:pending:${stamp}`,
    status: "PENDING",
  });

  await assert.rejects(
    () => prisma.transaction.delete({ where: { id: pendingEntry.id } }),
    /immutable/i,
  );
  await assert.rejects(
    () =>
      prisma.transaction.update({
        where: { id: pendingEntry.id },
        data: { amount: new Prisma.Decimal("99.00") },
      }),
    /immutable/i,
  );

  const posted = await prisma.transaction.update({
    where: { id: pendingEntry.id },
    data: { status: "POSTED", postedAt: new Date() },
  });
  assert.equal(posted.status, "POSTED");
});



test("tampilan progres menampilkan minggu 1..4, tanggal, dan minggu saat ini", async () => {
  const admin = await createUser("admin-progress", "ADMIN");
  const user = await createUser("progress");
  const join = await joinProgramTier(user.id, tierLargeId, meta);
  await activateUserProgram({ userProgramId: join.userProgramId, actorUserId: admin.id, meta });

  const [membership] = await getProgramProgress(user.id);
  assert.ok(membership, "progres keanggotaan harus ada");
  assert.equal(membership.periods.length, 4);
  assert.equal(membership.currentWeek, 1);
  assert.equal(membership.weeklyTarget, "10.00");
  assert.equal(membership.cycleTarget, "40.00");
  assert.equal(membership.periods[0]?.status, "PENDING");
  assert.equal(membership.periods[1]?.status, "NOT_RECORDED");
  assert.equal(membership.periods[1]?.amount, "10.00");
  assert.ok(membership.nextRewardDate instanceof Date);
  assert.equal(membership.startDate !== null, true);
  assert.equal(membership.eligibility.eligible, true);
  assert.equal(membership.currentReward?.amount, "10.00");
});

test("akun yang baru dibuat terbaca $0.00 dengan buku besar kosong", async () => {
  const user = await createUser("fresh");
  const balance = await getBalance(user.id);

  assert.equal(balance.availableAmount.toFixed(2), "0.00");
  assert.equal(balance.pendingAmount.toFixed(2), "0.00");
  assert.equal(balance.programFundsAmount.toFixed(2), "0.00");
  assert.equal(balance.totalEarned.toFixed(2), "0.00");
  assert.equal(await prisma.transaction.count({ where: { userId: user.id } }), 0);
  assert.equal((await getProgramProgress(user.id)).length, 0);
});

test("saldo per keranjang selalu sesuai entri buku besar yang tercatat", async () => {
  const admin = await createUser("admin-invariant", "ADMIN");
  const user = await createUser("invariant");
  const join = await joinProgramTier(user.id, tierSmallId, meta);
  await activateUserProgram({ userProgramId: join.userProgramId, actorUserId: admin.id, meta });

  const reward = await prisma.reward.findFirstOrThrow({
    where: { userId: user.id },
    select: { id: true },
  });
  await approveReward(reward.id, admin.id, meta);
  await payReward(reward.id, admin.id, meta);
  await voidReward(reward.id, admin.id, "dibalik untuk uji invarian", meta);

  const invariant = await verifyBalanceInvariant(prisma, user.id);
  assert.equal(invariant.ok, true, JSON.stringify(invariant.checks));
});

test("peralihan siklus keanggotaan dan pengembalian dana tercatat", async () => {
  const admin = await createUser("admin-lifecycle", "ADMIN");
  const user = await createUser("lifecycle");
  const join = await joinProgramTier(user.id, tierSmallId, meta);
  await activateUserProgram({ userProgramId: join.userProgramId, actorUserId: admin.id, meta });

  const suspended = await setUserProgramStatus({
    userProgramId: join.userProgramId,
    action: "SUSPEND",
    actorUserId: admin.id,
    reason: "sedang ditinjau",
    meta,
  });
  assert.equal(suspended.status, "SUSPENDED");

  const generation = await generateWeeklyRewards({
    actorUserId: admin.id,
    userProgramId: join.userProgramId,
    period: 2,
  });
  assert.equal(generation.created.length, 0, "keanggotaan yang ditangguhkan tidak menambah imbalan");
  assert.equal(
    await prisma.reward.count({ where: { userProgramId: join.userProgramId, period: 2 } }),
    0,
  );

  const resumed = await setUserProgramStatus({
    userProgramId: join.userProgramId,
    action: "RESUME",
    actorUserId: admin.id,
    meta,
  });
  assert.equal(resumed.status, "ACTIVE");

  const cancelled = await setUserProgramStatus({
    userProgramId: join.userProgramId,
    action: "CANCEL",
    actorUserId: admin.id,
    reason: "permintaan anggota",
    refundFunds: true,
    meta,
  });
  assert.equal(cancelled.status, "CANCELLED");
  assert.equal(cancelled.refunded, "10.00");

  const [balance, refundEntry, rewardCount] = await Promise.all([
    getBalance(user.id),
    prisma.transaction.findFirstOrThrow({
      where: { reference: `program:${join.userProgramId}:refund` },
      select: { type: true, bucket: true, amount: true },
    }),
    prisma.reward.count({ where: { userId: user.id } }),
  ]);

  assert.equal(balance.programFundsAmount.toFixed(2), "0.00");
  assert.equal(refundEntry.type, "ADJUSTMENT");
  assert.equal(refundEntry.bucket, "PROGRAM_FUNDS");
  assert.equal(refundEntry.amount.toFixed(2), "-10.00");
  assert.equal(rewardCount, 1, "baris imbalan yang ada tetap disimpan untuk jejak audit");
});

