import { PrismaClient } from "@prisma/client";

/**
 * Removes the accounts created by `npm run demo:local` together with their
 * memberships, rewards, ledger entries and balances.
 *
 * The ledger is append-only (a database trigger blocks DELETE), so the cleanup
 * opts in to the documented maintenance escape hatch for its own transaction:
 * `SET LOCAL tatorprofit.allow_ledger_purge = 'on'`. Nothing else in the app
 * ever sets it.
 */
const DEMO_USERNAMES = ["demo_member", "demo_admin"];

const prisma = new PrismaClient();

async function main() {
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
