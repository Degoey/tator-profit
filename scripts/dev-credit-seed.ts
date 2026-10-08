import { Prisma, PrismaClient } from "@prisma/client";

import { creditBalanceByAdmin } from "../src/lib/services/admin-credit-service";

/**
 * Explicit, development-only initial balance seed (Tahap 3, butir 9).
 *
 * The platform never grants balance automatically — not on registration, not by
 * matching a username. When a local/demo account needs a starting balance it is
 * granted here through the very same administrator credit service the UI uses, so
 * the result is a real `ADMIN_CREDIT` ledger entry, a real audit row and a real
 * notification. The reference is the idempotency key: running the script twice
 * credits once.
 *
 * Usage (from the project root):
 *   npm run dev:credit -- --username demo_member --actor demo_admin \
 *     --amount 100.00 --reference DEV-INITIAL-DEMO-MEMBER --confirm
 *
 * Refuses to run when NODE_ENV=production and refuses to run without --confirm.
 */
const prisma = new PrismaClient();

interface Args {
  username?: string;
  actor?: string;
  amount?: string;
  reference?: string;
  reason?: string;
  confirm: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { confirm: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    switch (token) {
      case "--username": args.username = next; index += 1; break;
      case "--actor": args.actor = next; index += 1; break;
      case "--amount": args.amount = next; index += 1; break;
      case "--reference": args.reference = next; index += 1; break;
      case "--reason": args.reason = next; index += 1; break;
      case "--confirm": args.confirm = true; break;
      default: break;
    }
  }
  return args;
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Seed kredit tidak boleh dijalankan di lingkungan produksi.");
  }

  const args = parseArgs(process.argv.slice(2));
  if (!args.confirm) {
    throw new Error("Tambahkan --confirm untuk menyetujui kredit awal ini.");
  }
  if (!args.username || !args.actor || !args.amount || !args.reference) {
    throw new Error("Wajib: --username, --actor, --amount, --reference (dan --confirm).");
  }

  const [target, actor] = await Promise.all([
    prisma.user.findUnique({ where: { username: args.username }, select: { id: true, username: true } }),
    prisma.user.findUnique({ where: { username: args.actor }, select: { id: true, username: true, adminRole: true, role: true } }),
  ]);
  if (!target) throw new Error(`Akun penerima ${args.username} tidak ditemukan.`);
  if (!actor || actor.role !== "ADMIN") throw new Error(`Akun admin ${args.actor} tidak ditemukan atau bukan ADMIN.`);

  const result = await creditBalanceByAdmin({
    userId: target.id,
    actorUserId: actor.id,
    amount: new Prisma.Decimal(args.amount),
    reason: args.reason ?? "Saldo awal lingkungan pengembangan",
    reference: args.reference,
    meta: { ipAddress: null, userAgent: "scripts/dev-credit-seed.ts" },
  });

  console.log(
    result.idempotent
      ? `= referensi ${result.reference} sudah diproses sebelumnya; saldo ${result.balanceAfter} USDT (tanpa kredit baru)`
      : `+ ${result.amount} USDT untuk @${target.username} oleh @${actor.username} · saldo ${result.balanceBefore} → ${result.balanceAfter} USDT · referensi ${result.reference}`,
  );
}

main()
  .catch((error) => {
    console.error("Seed kredit gagal:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
