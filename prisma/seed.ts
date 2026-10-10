import { PrismaClient } from "@prisma/client";

import {
  DEFAULT_CYCLE_WEEKS,
  DEFAULT_MAX_CYCLE_REWARD_RATE,
  DEFAULT_PROGRAM_CODE,
  DEFAULT_PROGRAM_NAME,
  DEFAULT_WEEKLY_REWARD_RATE,
  PROGRAM_COMBINATION_COUNT,
  PROGRAM_CURRENCY,
  PROGRAM_CYCLE_DEFINITIONS,
  PROGRAM_REWARD_TERMS,
  PROGRAM_TIER_DEFINITIONS,
} from "../src/lib/config/program";
import { REFERRAL_LEVEL_RATES } from "../src/lib/config/referral";

/**
 * Seeds the active reward program, its nine USDT join tiers and its three
 * durations (4 / 8 / 12 weeks) from the central configuration
 * (`src/lib/config/program.ts`). Nine amounts x three durations are the 27
 * program combinations the platform offers.
 *
 * The rows stay editable in the database: runtime code always reads the active
 * database configuration first and only falls back to the central config.
 * No user, balance or demo account is created here.
 */
const prisma = new PrismaClient();

async function main() {
  const program = await prisma.program.upsert({
    where: { code: DEFAULT_PROGRAM_CODE },
    update: {
      name: DEFAULT_PROGRAM_NAME,
      currency: PROGRAM_CURRENCY,
      weeklyRewardRate: DEFAULT_WEEKLY_REWARD_RATE,
      cycleWeeks: DEFAULT_CYCLE_WEEKS,
      maxCycleRewardRate: DEFAULT_MAX_CYCLE_REWARD_RATE,
      rewardTerms: PROGRAM_REWARD_TERMS,
      status: "ACTIVE",
      isDefault: true,
    },
    create: {
      code: DEFAULT_PROGRAM_CODE,
      name: DEFAULT_PROGRAM_NAME,
      description:
        "Program target imbalan mingguan Tatorprofit dengan paket gabung mulai dari 10 USDT, durasi 4, 8, atau 12 minggu.",
      currency: PROGRAM_CURRENCY,
      weeklyRewardRate: DEFAULT_WEEKLY_REWARD_RATE,
      cycleWeeks: DEFAULT_CYCLE_WEEKS,
      maxCycleRewardRate: DEFAULT_MAX_CYCLE_REWARD_RATE,
      rewardTerms: PROGRAM_REWARD_TERMS,
      status: "ACTIVE",
      isDefault: true,
    },
  });

  for (const tier of PROGRAM_TIER_DEFINITIONS) {
    await prisma.programTier.upsert({
      where: { programId_code: { programId: program.id, code: tier.code } },
      update: {
        name: tier.name,
        joinAmount: tier.joinAmount,
        currency: PROGRAM_CURRENCY,
        sortOrder: tier.sortOrder,
        isActive: true,
      },
      create: {
        programId: program.id,
        code: tier.code,
        name: tier.name,
        joinAmount: tier.joinAmount,
        currency: PROGRAM_CURRENCY,
        sortOrder: tier.sortOrder,
        isActive: true,
      },
    });
  }

  for (const cycle of PROGRAM_CYCLE_DEFINITIONS) {
    await prisma.programCycle.upsert({
      where: { programId_cycleWeeks: { programId: program.id, cycleWeeks: cycle.cycleWeeks } },
      update: {
        weeklyRewardRate: cycle.weeklyRewardRate,
        targetCycleRewardRate: cycle.targetCycleRewardRate,
        isActive: true,
      },
      create: {
        programId: program.id,
        cycleWeeks: cycle.cycleWeeks,
        weeklyRewardRate: cycle.weeklyRewardRate,
        targetCycleRewardRate: cycle.targetCycleRewardRate,
        isActive: true,
      },
    });
  }

  // Persentase Komisi Rabat: lima generasi, sumber data utama bersama untuk
  // beranda member, dashboard admin, dan mesin perhitungan rabat. Nilainya
  // idempoten sehingga menjalankan seed ulang tidak menimpa perubahan admin.
  for (const entry of REFERRAL_LEVEL_RATES) {
    await prisma.rebateConfig.upsert({
      where: { generation: entry.level },
      update: {},
      create: { generation: entry.level, rate: entry.rate },
    });
  }

  const [tiers, cycles] = await Promise.all([
    prisma.programTier.findMany({
      where: { programId: program.id, isActive: true },
      orderBy: { sortOrder: "asc" },
      select: { code: true, joinAmount: true },
    }),
    prisma.programCycle.findMany({
      where: { programId: program.id, isActive: true },
      orderBy: { cycleWeeks: "asc" },
      select: { cycleWeeks: true, targetCycleRewardRate: true },
    }),
  ]);

  console.log(`Program siap: ${program.code} (${program.name})`);
  console.log(
    `Target imbalan: ${program.weeklyRewardRate.toString()} per minggu · durasi ${cycles
      .map((cycle) => `${cycle.cycleWeeks} minggu (${cycle.targetCycleRewardRate.times(100).toFixed(0)}%)`)
      .join(", ")}`,
  );
  for (const tier of tiers) {
    console.log(`  - ${tier.code}: ${tier.joinAmount.toFixed(2)} ${PROGRAM_CURRENCY}`);
  }
  console.log(`Total nominal aktif: ${tiers.length}`);
  console.log(`Total durasi aktif: ${cycles.length}`);
  console.log(`Total kombinasi program: ${tiers.length * cycles.length} dari ${PROGRAM_COMBINATION_COUNT}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error("Seed gagal", error);
    await prisma.$disconnect();
    process.exit(1);
  });
