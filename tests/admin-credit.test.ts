import assert from "node:assert/strict";
import { after, test } from "node:test";

import { Prisma, PrismaClient, type AdminRole } from "@prisma/client";

import { AdminCreditError, creditBalanceByAdmin } from "../src/lib/services/admin-credit-service";
import { postLedgerEntry, verifyBalanceInvariant } from "../src/lib/services/ledger-service";

/**
 * Integration tests for the administrator balance credit (Tahap 3) against the
 * real PostgreSQL database: the ledger, the audit trail and the balance buckets
 * are checked together, because the whole point of the feature is that money can
 * only move through those three in one transaction.
 */
const prisma = new PrismaClient();
const stamp = `${Date.now()}`.slice(-7);
const meta = { ipAddress: "198.18.9.9", userAgent: "node-test" };

const createdUserIds: string[] = [];
let counter = 0;

interface CreateUserOptions {
  role?: "USER" | "ADMIN";
  adminRole?: AdminRole | null;
  status?: "ACTIVE" | "SUSPENDED" | "CLOSED";
}

async function createUser(label: string, options: CreateUserOptions = {}) {
  counter += 1;
  const username = `${label}_${stamp}_${counter}`;
  const user = await prisma.user.create({
    data: {
      name: `Uji ${label}`,
      username,
      email: `${username}@example.com`,
      phone: `+6288${stamp}${counter}`,
      // Pre-computed bcrypt shaped hash: these accounts never sign in.
      passwordHash: "$2b$10$abcdefghijklmnopqrstuvABCDEFGHIJKLMNOPQRSTUVWXYZ012345",
      role: options.role ?? "USER",
      adminRole: options.adminRole ?? null,
      status: options.status ?? "ACTIVE",
    },
    select: { id: true, username: true },
  });
  createdUserIds.push(user.id);
  return user;
}

function creditInput(memberId: string, adminId: string, amount: string, reference: string) {
  return {
    userId: memberId,
    actorUserId: adminId,
    amount: new Prisma.Decimal(amount),
    reason: "Saldo awal uji otomatis",
    reference,
    meta,
  };
}

function isAdminCreditError(code: string, status: number) {
  return (error: unknown) => error instanceof AdminCreditError && error.code === code && error.status === status;
}

after(async () => {
  const transactions = await prisma.transaction.findMany({
    where: { userId: { in: createdUserIds } },
    select: { id: true },
  });

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL tatorprofit.allow_ledger_purge = 'on'");
    // Jejak audit yang menunjuk ke ledger uji ikut dibersihkan supaya pengujian
    // tidak meninggalkan residu; riwayat nyata tidak pernah disentuh.
    await tx.auditLog.deleteMany({
      where: {
        OR: [
          { entityId: { in: transactions.map((row) => row.id) } },
          { actorUserId: { in: createdUserIds } },
        ],
      },
    });
    await tx.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });
  await prisma.$disconnect();
});

test("kredit admin menulis ledger ADMIN_CREDIT, audit, notifikasi, dan saldo tersedia", async () => {
  const member = await createUser("credit_target");
  const admin = await createUser("credit_finance", { role: "ADMIN", adminRole: "FINANCE" });
  const reference = `TEST-${stamp}-A`;

  const result = await creditBalanceByAdmin(creditInput(member.id, admin.id, "100.00", reference));

  assert.equal(result.idempotent, false);
  assert.equal(result.amount, "100.00");
  assert.equal(result.currency, "USDT");
  assert.equal(result.balanceBefore, "0.00");
  assert.equal(result.balanceAfter, "100.00");

  const [entry, balance, audit, notification, invariant] = await Promise.all([
    prisma.transaction.findUniqueOrThrow({ where: { id: result.id } }),
    prisma.balance.findUniqueOrThrow({ where: { userId: member.id } }),
    prisma.auditLog.findFirst({ where: { action: "admin.credit_granted", entityId: result.id } }),
    prisma.notification.findFirst({ where: { userId: member.id, title: "Kredit saldo diterima" } }),
    verifyBalanceInvariant(prisma, member.id),
  ]);

  assert.equal(entry.type, "ADMIN_CREDIT");
  assert.equal(entry.bucket, "AVAILABLE");
  assert.equal(entry.status, "POSTED");
  assert.equal(entry.currency, "USDT");
  assert.equal(entry.amount.toFixed(2), "100.00");
  assert.equal(entry.reference, `admin-credit:${reference}`);

  assert.equal(balance.availableAmount.toFixed(2), "100.00");
  assert.equal(balance.currency, "USDT");
  // Kredit admin bukan imbalan: statistik imbalan tetap bersih.
  assert.equal(balance.totalEarned.toFixed(2), "0.00");

  assert.ok(audit, "audit kredit wajib tercatat");
  assert.equal(audit.actorUserId, admin.id);
  assert.equal((audit.before as { balance?: string } | null)?.balance, "0.00");
  assert.equal((audit.after as { balance?: string } | null)?.balance, "100.00");
  assert.equal((audit.after as { reference?: string } | null)?.reference, reference);
  assert.equal(audit.ipAddress, meta.ipAddress);
  assert.equal(audit.userAgent, meta.userAgent);

  assert.ok(notification, "penerima harus menerima notifikasi kredit");
  assert.equal(invariant.ok, true, JSON.stringify(invariant.checks));
});

test("referensi yang sama bersifat idempoten dan tidak mengkredit dua kali", async () => {
  const member = await createUser("credit_idempotent");
  const admin = await createUser("credit_super", { role: "ADMIN", adminRole: "SUPER_ADMIN" });
  const input = creditInput(member.id, admin.id, "100.00", `TEST-${stamp}-B`);

  const first = await creditBalanceByAdmin(input);
  const second = await creditBalanceByAdmin(input);

  assert.equal(first.idempotent, false);
  assert.equal(second.idempotent, true);
  assert.equal(second.id, first.id);
  assert.equal(second.balanceAfter, "100.00");

  const [entries, balance, audits] = await Promise.all([
    prisma.transaction.count({ where: { userId: member.id, type: "ADMIN_CREDIT" } }),
    prisma.balance.findUniqueOrThrow({ where: { userId: member.id } }),
    prisma.auditLog.count({ where: { action: "admin.credit_granted", entityId: first.id } }),
  ]);

  assert.equal(entries, 1);
  assert.equal(audits, 1);
  assert.equal(balance.availableAmount.toFixed(2), "100.00");
});

test("referensi yang sama dengan akun atau jumlah berbeda ditolak", async () => {
  const member = await createUser("credit_conflict");
  const other = await createUser("credit_conflict_other");
  const admin = await createUser("credit_finance_conflict", { role: "ADMIN", adminRole: "FINANCE" });
  const reference = `TEST-${stamp}-C`;

  await creditBalanceByAdmin(creditInput(member.id, admin.id, "100.00", reference));

  await assert.rejects(
    () => creditBalanceByAdmin(creditInput(member.id, admin.id, "250.00", reference)),
    isAdminCreditError("REFERENCE_CONFLICT", 409),
  );
  await assert.rejects(
    () => creditBalanceByAdmin(creditInput(other.id, admin.id, "100.00", reference)),
    isAdminCreditError("REFERENCE_CONFLICT", 409),
  );

  const [entries, otherBalance] = await Promise.all([
    prisma.transaction.count({ where: { userId: member.id, type: "ADMIN_CREDIT" } }),
    prisma.balance.findUnique({ where: { userId: other.id } }),
  ]);

  assert.equal(entries, 1);
  assert.equal(otherBalance, null, "akun lain tidak boleh menerima saldo apa pun");
});

test("peran tanpa kemampuan kredit ditolak di sisi server", async () => {
  const member = await createUser("credit_denied_target");
  const cases: { adminRole: AdminRole | null; label: string }[] = [
    { adminRole: "SUPPORT", label: "support" },
    { adminRole: "COMPLIANCE", label: "compliance" },
    { adminRole: "VIEWER", label: "viewer" },
    { adminRole: null, label: "tanpa_peran" },
  ];

  for (const [index, item] of cases.entries()) {
    const admin = await createUser(`credit_denied_${item.label}`, {
      role: "ADMIN",
      adminRole: item.adminRole,
    });
    await assert.rejects(
      () => creditBalanceByAdmin(creditInput(member.id, admin.id, "10.00", `TEST-${stamp}-D${index}`)),
      isAdminCreditError("FORBIDDEN", 403),
      `peran=${String(item.adminRole)}`,
    );
  }

  // Pengguna biasa tidak dapat bertindak sebagai admin.
  const plainUser = await createUser("credit_denied_user");
  await assert.rejects(
    () => creditBalanceByAdmin(creditInput(member.id, plainUser.id, "10.00", `TEST-${stamp}-D9`)),
    isAdminCreditError("FORBIDDEN", 403),
  );

  const [entries, balance] = await Promise.all([
    prisma.transaction.count({ where: { userId: member.id } }),
    prisma.balance.findUnique({ where: { userId: member.id } }),
  ]);

  assert.equal(entries, 0);
  assert.equal(balance, null, "permintaan yang ditolak tidak boleh membuat baris saldo");
});

test("akun non-aktif dan akun bersaldo bukan USDT tidak dapat dikredit", async () => {
  const admin = await createUser("credit_finance_guard", { role: "ADMIN", adminRole: "FINANCE" });

  const suspended = await createUser("credit_suspended", { status: "SUSPENDED" });
  await assert.rejects(
    () => creditBalanceByAdmin(creditInput(suspended.id, admin.id, "10.00", `TEST-${stamp}-E1`)),
    isAdminCreditError("USER_NOT_ELIGIBLE", 409),
  );

  const closed = await createUser("credit_closed", { status: "CLOSED" });
  await assert.rejects(
    () => creditBalanceByAdmin(creditInput(closed.id, admin.id, "10.00", `TEST-${stamp}-E2`)),
    isAdminCreditError("USER_NOT_ELIGIBLE", 409),
  );

  const legacy = await createUser("credit_legacy_currency");
  await prisma.balance.create({
    data: { userId: legacy.id, currency: "USD", availableAmount: new Prisma.Decimal("5.00") },
  });
  await assert.rejects(
    () => creditBalanceByAdmin(creditInput(legacy.id, admin.id, "10.00", `TEST-${stamp}-E3`)),
    isAdminCreditError("CURRENCY_MISMATCH", 409),
  );

  const legacyBalance = await prisma.balance.findUniqueOrThrow({ where: { userId: legacy.id } });
  assert.equal(legacyBalance.availableAmount.toFixed(2), "5.00");
});

test("jumlah tidak valid ditolak sebelum menyentuh ledger", async () => {
  const member = await createUser("credit_amount_guard");
  const admin = await createUser("credit_finance_amount", { role: "ADMIN", adminRole: "FINANCE" });

  for (const [index, amount] of ["0.00", "-10.00", "10.001"].entries()) {
    await assert.rejects(
      () => creditBalanceByAdmin(creditInput(member.id, admin.id, amount, `TEST-${stamp}-F${index}`)),
      isAdminCreditError("INVALID_AMOUNT", 422),
      `amount=${amount}`,
    );
  }

  const entries = await prisma.transaction.count({ where: { userId: member.id } });
  assert.equal(entries, 0);
});

test("koreksi memakai entri penyesuaian baru dan ledger tetap tidak dapat diubah", async () => {
  const member = await createUser("credit_correction");
  const admin = await createUser("credit_finance_correction", { role: "ADMIN", adminRole: "FINANCE" });

  const credit = await creditBalanceByAdmin(creditInput(member.id, admin.id, "100.00", `TEST-${stamp}-G`));

  // Koreksi kredit ganda: entri ADJUSTMENT baru, riwayat lama tidak disentuh.
  await prisma.$transaction(async (tx) => {
    await postLedgerEntry(tx, {
      userId: member.id,
      type: "ADJUSTMENT",
      bucket: "AVAILABLE",
      amount: new Prisma.Decimal("-40.00"),
      currency: "USDT",
      reference: `adjust:${stamp}:correction`,
      description: "Koreksi kredit ganda",
      metadata: { correctsTransactionId: credit.id },
    });
  });

  const [balance, original, invariant] = await Promise.all([
    prisma.balance.findUniqueOrThrow({ where: { userId: member.id } }),
    prisma.transaction.findUniqueOrThrow({ where: { id: credit.id } }),
    verifyBalanceInvariant(prisma, member.id),
  ]);

  assert.equal(balance.availableAmount.toFixed(2), "60.00");
  assert.equal(original.amount.toFixed(2), "100.00", "entri lama tidak boleh berubah");
  assert.equal(invariant.ok, true, JSON.stringify(invariant.checks));

  // Trigger append-only: entri ledger tidak dapat diubah maupun dihapus.
  await assert.rejects(() =>
    prisma.transaction.update({ where: { id: credit.id }, data: { amount: new Prisma.Decimal("999.00") } }),
  );
  await assert.rejects(() => prisma.transaction.delete({ where: { id: credit.id } }));

  const stillThere = await prisma.transaction.findUniqueOrThrow({ where: { id: credit.id } });
  assert.equal(stillThere.amount.toFixed(2), "100.00");
});



