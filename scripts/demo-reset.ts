import { PrismaClient } from "@prisma/client";

import { assertConfirmed, assertNotProduction } from "../src/lib/config/maintenance-guard";

/**
 * Removes the accounts created by `npm run demo:local` together with their
 * memberships, rewards, ledger entries and balances.
 *
 * The ledger is append-only (a database trigger blocks DELETE), so the cleanup
 * opts in to the documented maintenance escape hatch for its own transaction:
 * `SET LOCAL tatorprofit.allow_ledger_purge = 'on'`. Nothing else in the app
 * ever sets it.
 *
 * Usage: `npm run demo:reset -- --confirm`
 *
 * Refuses to run when `NODE_ENV=production` and refuses to run without
 * `--confirm`: deleting accounts and bypassing the ledger trigger must never
 * happen by accident. Demo accounts are deleted, never re-labelled as real ones.
 */
const DEMO_USERNAMES = ["demo_member", "demo_admin"];

const prisma = new PrismaClient();

async function main() {
  assertNotProduction(process.env, "Atur ulang demo");
  assertConfirmed(
    process.argv.slice(2),
    "jalankan `npm run demo:reset -- --confirm` untuk menghapus akun demo beserta ledger-nya.",
  );

  const users = await prisma.user.findMany({
    where: { username: { in: DEMO_USERNAMES } },
    select: { id: true, username: true },
  });

  if (users.length === 0) {
    console.log("Tidak ada akun demo yang ditemukan. Tidak ada yang dihapus.");
    return;
  }

  const ids = users.map((user) => user.id);

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL tatorprofit.allow_ledger_purge = 'on'");
    await tx.referral.deleteMany({
      where: { OR: [{ referrerId: { in: ids } }, { referredUserId: { in: ids } }] },
    });
    await tx.user.deleteMany({ where: { id: { in: ids } } });
  });

  const remaining = await prisma.user.count({ where: { id: { in: ids } } });
  for (const user of users) console.log(`- dihapus ${user.username}`);
  console.log(`Akun demo tersisa: ${remaining}`);
}

main()
  .catch((error) => {
    console.error("Atur ulang demo gagal:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
