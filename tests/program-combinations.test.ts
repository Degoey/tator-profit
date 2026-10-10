import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { Prisma } from "@prisma/client";
import { createTestPrismaClient } from "./helpers/prisma";

import {
  PROGRAM_COMBINATION_COUNT,
  PROGRAM_CYCLE_DEFINITIONS,
  PROGRAM_CYCLE_WEEKS,
  PROGRAM_CURRENCY,
  PROGRAM_TIER_AMOUNTS,
  cycleRewardRate,
} from "../src/lib/config/program";
import { displayCurrency, displayLegacyCurrencyText, formatMoney } from "../src/lib/money";
import { getBalance, verifyBalanceInvariant } from "../src/lib/services/ledger-service";
import { activateUserProgram, joinProgramTier } from "../src/lib/services/program-service";
import { approveReward, generateWeeklyRewards, payReward } from "../src/lib/services/reward-service";

/**
 * Bagian 5 acceptance tests against the real PostgreSQL database:
 *
 *  - 9 join amounts x 3 durations = 27 program combinations, generated from
 *    configuration instead of being written out one by one;
 *  - every membership snapshots the duration it was joined with (4 / 8 / 12
 *    weeks) plus the weekly and cycle rates, so later configuration edits cannot
 *    change an existing program retroactively;
 *  - the reward engine never records a period past the cycle bound (no week 5 for
 *    a 4-week program, no week 13 for a 12-week program) and never records the
 *    same period twice (cron run twice);
 *  - the ledger stays balanced after joining, paying a reward and querying the
 *    balance, and every amount is USDT.
 */
const prisma = createTestPrismaClient();
const stamp = `${Date.now()}`.slice(-7);
const meta = { ipAddress: "198.18.10.10", userAgent: "node-test-combinations" };

let programId = "";
/** tierId per join amount, e.g. "10.00" -> uuid. */
const tierIdByAmount = new Map<string, string>();
/** cycleId per duration in weeks, e.g. 12 -> uuid. */
const cycleIdByWeeks = new Map<number, string>();
const createdUserIds: string[] = [];
let userCounter = 0;

async function createUser(label: string, role: "USER" | "ADMIN" = "USER") {
  userCounter += 1;
  const username = `${label}_${stamp}_${userCounter}`;
  const user = await prisma.user.create({
    data: {
      name: `Uji ${label}`,
      username,
      email: `${username}@example.com`,
      phone: `+6287${stamp}${userCounter}`,
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
      code: `TEST-COMB-${stamp}`,
      name: "Program uji 27 kombinasi",
      currency: PROGRAM_CURRENCY,
      weeklyRewardRate: new Prisma.Decimal("0.1000"),
      cycleWeeks: 4,
      maxCycleRewardRate: new Prisma.Decimal("0.4000"),
      status: "ACTIVE",
      isDefault: false,
      tiers: {
        create: PROGRAM_TIER_AMOUNTS.map((amount, index) => ({
          code: `TEST-${PROGRAM_CURRENCY}-${amount}-${stamp}`,
          name: `Uji ${amount} ${PROGRAM_CURRENCY}`,
          joinAmount: new Prisma.Decimal(amount).toDecimalPlaces(2),
          currency: PROGRAM_CURRENCY,
          sortOrder: index + 1,
        })),
      },
      cycles: {
        create: PROGRAM_CYCLE_DEFINITIONS.map((cycle) => ({
          cycleWeeks: cycle.cycleWeeks,
          weeklyRewardRate: cycle.weeklyRewardRate,
          targetCycleRewardRate: cycle.targetCycleRewardRate,
        })),
      },
    },
    select: { id: true },
  });

  programId = program.id;

  const [tiers, cycles] = await Promise.all([
    prisma.programTier.findMany({
      where: { programId },
      select: { id: true, joinAmount: true },
    }),
    prisma.programCycle.findMany({ where: { programId }, select: { id: true, cycleWeeks: true } }),
  ]);

  for (const tier of tiers) tierIdByAmount.set(tier.joinAmount.toFixed(2), tier.id);
  for (const cycle of cycles) cycleIdByWeeks.set(cycle.cycleWeeks, cycle.id);
});

after(async () => {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL tatorprofit.allow_ledger_purge = 'on'");
    await tx.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });
  await prisma.userProgram.deleteMany({ where: { programId } });
  await prisma.programTier.deleteMany({ where: { programId } });
  await prisma.programCycle.deleteMany({ where: { programId } });
  await prisma.program.delete({ where: { id: programId } });
  await prisma.$disconnect();
});

test("konfigurasi pusat menghasilkan 27 kombinasi dari 9 nominal x 3 durasi", () => {
  assert.equal(PROGRAM_TIER_AMOUNTS.length, 9);
  assert.deepEqual([...PROGRAM_CYCLE_WEEKS], [4, 8, 12]);
  assert.equal(PROGRAM_COMBINATION_COUNT, 27);
  assert.equal(PROGRAM_CURRENCY, "USDT");

  const expected: Record<number, string> = { 4: "0.4000", 8: "0.8000", 12: "1.2000" };
  for (const cycle of PROGRAM_CYCLE_DEFINITIONS) {
    assert.equal(
      cycle.targetCycleRewardRate.toFixed(4),
      expected[cycle.cycleWeeks],
      `target siklus ${cycle.cycleWeeks} minggu`,
    );
    assert.equal(
      cycleRewardRate(new Prisma.Decimal("0.1000"), cycle.cycleWeeks).toFixed(4),
      expected[cycle.cycleWeeks],
    );
  }
});

test("program uji menyediakan 9 nominal x 3 durasi di database", async () => {
  const [tiers, cycles] = await Promise.all([
    prisma.programTier.count({ where: { programId, isActive: true } }),
    prisma.programCycle.count({ where: { programId, isActive: true } }),
  ]);

  assert.equal(tiers, 9);
  assert.equal(cycles, 3);
  assert.equal(tiers * cycles, 27);
});

test("setiap kombinasi 4, 8, dan 12 minggu dapat digabung dengan snapshot durasinya", async () => {
  const user = await createUser("combo_owner");

  for (const amount of PROGRAM_TIER_AMOUNTS) {
    const tierId = tierIdByAmount.get(new Prisma.Decimal(amount).toFixed(2));
    assert.ok(tierId, `tier ${amount} tersedia`);

    for (const weeks of PROGRAM_CYCLE_WEEKS) {
      const cycleId = cycleIdByWeeks.get(weeks);
      assert.ok(cycleId, `durasi ${weeks} minggu tersedia`);

      const result = await joinProgramTier(user.id, tierId, meta, undefined, cycleId);
      assert.equal(result.status, "PENDING");
      assert.equal(result.cycleWeeks, weeks);
      assert.equal(result.cycleId, cycleId);
      assert.equal(result.weeklyRewardTarget, new Prisma.Decimal(amount).times("0.1").toFixed(2));
      assert.equal(
        result.targetCycleRewardRate,
        cycleRewardRate(new Prisma.Decimal("0.1000"), weeks).toFixed(4),
      );
    }
  }

  const memberships = await prisma.userProgram.findMany({
    where: { userId: user.id, programId },
    select: {
      id: true,
      cycleWeeks: true,
      cycleId: true,
      weeklyRewardRate: true,
      maxCycleRewardRate: true,
      currency: true,
    },
  });

  assert.equal(memberships.length, 27, "sembilan nominal x tiga durasi");

  for (const membership of memberships) {
    const expectedTarget = cycleRewardRate(new Prisma.Decimal("0.1000"), membership.cycleWeeks);
    assert.equal(membership.currency, "USDT");
    assert.equal(membership.weeklyRewardRate.toFixed(4), "0.1000");
    assert.equal(membership.maxCycleRewardRate.toFixed(4), expectedTarget.toFixed(4));
    assert.ok(
      [4, 8, 12].includes(membership.cycleWeeks),
      `durasi ${membership.cycleWeeks} harus 4, 8, atau 12 minggu`,
    );
    assert.equal(membership.cycleId, cycleIdByWeeks.get(membership.cycleWeeks));
  }

  const ledger = await prisma.transaction.groupBy({
    by: ["type", "bucket"],
    where: { userId: user.id, userProgramId: { in: memberships.map((row) => row.id) } },
    _count: { _all: true },
  });

  assert.equal(ledger.length, 1);
  assert.equal(ledger[0]?.type, "PROGRAM_JOIN");
  assert.equal(ledger[0]?.bucket, "NONE");
  assert.equal(ledger[0]?._count._all, 27, "satu entri komitmen per kombinasi, tanpa kredit saldo");

  const balance = await getBalance(user.id);
  assert.equal(balance.availableAmount.toFixed(2), "0.00");
  assert.equal(balance.currency, "USDT");
});



test("gabung ulang untuk kombinasi yang sama ditolak", async () => {
  const user = await createUser("combo_duplicate");
  const tierId = tierIdByAmount.get("100.00")!;
  const cycleId = cycleIdByWeeks.get(8)!;

  await joinProgramTier(user.id, tierId, meta, undefined, cycleId);
  await assert.rejects(
    () => joinProgramTier(user.id, tierId, meta, undefined, cycleId),
    /sudah memiliki keanggotaan/i,
  );

  // A different duration of the same join amount is a different combination.
  const other = await joinProgramTier(user.id, tierId, meta, undefined, cycleIdByWeeks.get(12)!);
  assert.equal(other.cycleWeeks, 12);
  assert.equal(await prisma.userProgram.count({ where: { userId: user.id, programId } }), 2);
});

test("mesin imbalan berhenti di akhir durasi dan tidak menggandakan periode", async () => {
  const admin = await createUser("combo_admin", "ADMIN");
  const user = await createUser("combo_cycle");
  const tierId = tierIdByAmount.get("10.00")!;

  const four = await joinProgramTier(user.id, tierId, meta, undefined, cycleIdByWeeks.get(4)!);
  const twelve = await joinProgramTier(user.id, tierId, meta, undefined, cycleIdByWeeks.get(12)!);

  await activateUserProgram({ userProgramId: four.userProgramId, actorUserId: admin.id, meta });
  await activateUserProgram({ userProgramId: twelve.userProgramId, actorUserId: admin.id, meta });

  const overBound = await generateWeeklyRewards({
    actorUserId: admin.id,
    userProgramId: four.userProgramId,
    period: 5,
  });
  assert.equal(overBound.created.length, 0, "4 minggu tidak boleh lanjut ke Minggu 5");
  assert.match(overBound.skipped[0]?.reason ?? "", /4 minggu sudah selesai/);

  const thirteen = await generateWeeklyRewards({
    actorUserId: admin.id,
    userProgramId: twelve.userProgramId,
    period: 13,
  });
  assert.equal(thirteen.created.length, 0, "12 minggu tidak boleh lanjut ke Minggu 13");
  assert.match(thirteen.skipped[0]?.reason ?? "", /12 minggu sudah selesai/);

  const first = await generateWeeklyRewards({
    actorUserId: admin.id,
    userProgramId: twelve.userProgramId,
    period: 12,
  });
  assert.equal(first.created.length, 1);
  assert.equal(first.created[0]?.amount, "1.00", "10 USDT x 10%");

  // A cron that runs twice must not record the same period twice.
  const second = await generateWeeklyRewards({
    actorUserId: admin.id,
    userProgramId: twelve.userProgramId,
    period: 12,
  });
  assert.equal(second.created.length, 0);
  assert.match(second.skipped[0]?.reason ?? "", /sudah tercatat/);

  const rewardCount = await prisma.reward.count({
    where: { userProgramId: twelve.userProgramId, period: 12 },
  });
  assert.equal(
    rewardCount,
    1,
    "unique(userProgramId, type, cycleNumber, period) menjaga idempotensi",
  );

  const reward = await prisma.reward.findFirstOrThrow({
    where: { userProgramId: twelve.userProgramId, period: 12 },
    select: { id: true, currency: true, rate: true },
  });
  assert.equal(reward.currency, "USDT");
  assert.equal(reward.rate.toFixed(4), "0.1000", "snapshot tarif tersimpan pada baris imbalan");

  await approveReward(reward.id, admin.id, meta);
  await payReward(reward.id, admin.id, meta);

  const balance = await getBalance(user.id);
  assert.equal(balance.availableAmount.toFixed(2), "1.00");
  assert.equal(balance.currency, "USDT");

  const invariant = await verifyBalanceInvariant(prisma, user.id);
  assert.equal(invariant.ok, true, JSON.stringify(invariant.checks));
});

test("nilai USDT ditampilkan tanpa simbol mata uang", () => {
  assert.equal(formatMoney("10000", "USDT"), "10.000,00 USDT");
  assert.equal(formatMoney("10000"), "10.000,00 USDT");
  assert.ok(!formatMoney("10000").includes("$"));
});

test("baris buku besar lama tetap ditampilkan dalam USDT", () => {
  // Buku besar bersifat append-only: baris historis tidak pernah diubah di database,
  // tetapi tidak boleh menampilkan mata uang lama ke pengguna.
  assert.equal(displayCurrency("USD"), "USDT");
  assert.equal(displayCurrency("usdt"), "USDT");
  assert.equal(displayCurrency(null), "USDT");
  assert.equal(displayCurrency(undefined), "USDT");
  assert.equal(formatMoney("100", "USD"), "100,00 USDT");
  // "USD" hanya boleh muncul sebagai bagian dari "USDT", tidak pernah sendiri.
  assert.ok(!/USD(?!T)/.test(formatMoney("100", "USD")));

  // Kode asing tidak pernah diganti diam-diam.
  assert.equal(displayCurrency("EUR"), "EUR");
  assert.equal(formatMoney("100", "EUR"), "100,00 EUR");

  // Deskripsi buku besar historis yang menyebut kode paket lama dinormalkan saat ditampilkan.
  assert.equal(
    displayLegacyCurrencyText("Dana program dikonfirmasi untuk USD-100 (diterima di luar platform)"),
    "Dana program dikonfirmasi untuk USDT-100 (diterima di luar platform)",
  );
  assert.equal(displayLegacyCurrencyText("USDT-100 tetap USDT-100"), "USDT-100 tetap USDT-100");
});
