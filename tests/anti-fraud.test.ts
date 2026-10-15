import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { createTestPrismaClient } from "./helpers/prisma";

import { canAdmin } from "../src/lib/auth/admin-permissions";
import {
  FRAUD_SIGNALS,
  FRAUD_SIGNAL_LABELS,
  REFERRER_BURST_MIN_COUNT,
  SHARED_IP_MIN_COUNT,
  fraudSignalLabel,
  isFraudSignal,
  trustedIpAddress,
} from "../src/lib/config/anti-fraud";
import {
  FRAUD_AUDIT_ACTIONS,
  FraudReviewError,
  createPrismaSignalQueries,
  evaluateRegistrationSignals,
  flagRegistrationInTransaction,
  listFraudCases,
  reviewFraudCase,
  validateFraudDecision,
  type SignalQueries,
} from "../src/lib/services/anti-fraud-service";
import { registerUser } from "../src/lib/services/auth-service";

/**
 * Anti-fraud multi-akun dan penyalahgunaan rujukan (Bagian 13).
 *
 * Yang diuji: keputusan murni (tanpa database), penulisan kasus tinjauan ke
 * database, alur pendaftaran nyata, batas izin peran, dan janji keamanan bahwa
 * pendeteksi ini tidak pernah memindahkan uang.
 */
const prisma = createTestPrismaClient();
const ROOT = process.cwd();
const meta = { ipAddress: "203.0.113.9", userAgent: "node-test" };
const stamp = `${Date.now()}`.slice(-7);

function readProjectFile(...segments: string[]): string {
  return readFileSync(path.join(ROOT, ...segments), "utf8");
}

/** Query palsu: setiap kolom bisa di-override sesuai skenario yang diuji. */
function fakeQueries(overrides: Partial<SignalQueries> = {}): SignalQueries {
  return {
    otherUsersWithSameBankAccount: async () => [],
    otherUsersWithSameIpAddress: async () => [],
    referrerDetails: async () => null,
    countReferralsSince: async () => 0,
    ...overrides,
  };
}

const createdUserIds: string[] = [];

function track(id: string): string {
  createdUserIds.push(id);
  return id;
}

async function cleanupUsers(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const where = { in: ids };
  await prisma.fraudReview.deleteMany({ where: { userId: where } });
  await prisma.referralCommission.deleteMany({
    where: { OR: [{ beneficiaryUserId: where }, { sourceUserId: where }] },
  });
  await prisma.referral.deleteMany({
    where: { OR: [{ referrerId: where }, { referredUserId: where }] },
  });
  await prisma.securityEvent.deleteMany({ where: { userId: where } });
  await prisma.auditLog.deleteMany({ where: { actorUserId: where } });
  await prisma.notification.deleteMany({ where: { userId: where } });
  await prisma.balance.deleteMany({ where: { userId: where } });
  await prisma.profile.deleteMany({ where: { userId: where } });
  await prisma.user.deleteMany({ where: { id: where } });
}

after(async () => {
  await cleanupUsers(createdUserIds);
  await prisma.$disconnect();
});

let userSeq = 0;

/** Nomor telepon unik per pengguna uji (7-15 digit, awalan + opsional). */
function uniquePhone(): string {
  userSeq += 1;
  return `+6289${stamp}${String(userSeq).padStart(2, "0")}`;
}

const TEST_PASSWORD_HASH =
  "$2b$10$abcdefghijklmnopqrstuvABCDEFGHIJKLMNOPQRSTUVWXYZ012345";

async function createUser(input: {
  username: string;
  bank?: string | null;
  bankAccountNumber?: string | null;
  registrationIp?: string | null;
  adminRole?: "SUPER_ADMIN" | "FINANCE" | "SUPPORT" | "COMPLIANCE" | "VIEWER";
}): Promise<{ id: string; username: string }> {
  const user = await prisma.user.create({
    data: {
      name: `Uji Fraud ${input.username}`,
      username: input.username,
      email: `${input.username}@example.com`,
      phone: uniquePhone(),
      bank: input.bank ?? "BCA",
      bankAccountNumber: input.bankAccountNumber ?? null,
      registrationIp: input.registrationIp ?? null,
      passwordHash: TEST_PASSWORD_HASH,
      role: input.adminRole ? "ADMIN" : "USER",
      adminRole: input.adminRole ?? null,
    },
    select: { id: true, username: true },
  });
  track(user.id);
  return user;
}

/** Payload pendaftaran yang lolos skema, dengan nomor rekening yang ditentukan. */
function registerInput(suffix: string, bankAccountNumber: string) {
  return {
    name: `Uji Anti Fraud ${suffix.toUpperCase()}`,
    username: `af${stamp}${suffix}`,
    email: `af${stamp}${suffix}@example.com`,
    phone: `+6281${stamp}${suffix.charCodeAt(0) - 96}`,
    bankAccountNumber,
    bank: "BCA" as const,
    password: "Rahasia123",
    confirmPassword: "Rahasia123",
    referralCode: undefined,
    acceptTerms: true,
  };
}


describe("sinyal anti-fraud saat pendaftaran (murni)", () => {
  it("tidak menandai pendaftaran yang bersih", async () => {
    const result = await evaluateRegistrationSignals({
      userId: "user-1",
      bank: "BCA",
      bankAccountNumber: "123456789",
      referrerId: null,
      ipAddress: null,
      queries: fakeQueries(),
    });

    assert.deepEqual(result.signals, []);
    assert.deepEqual(result.relatedUserIds, []);
  });

  it("menandai nomor rekening yang sudah dipakai akun lain", async () => {
    const result = await evaluateRegistrationSignals({
      userId: "user-1",
      bank: "BCA",
      bankAccountNumber: "123456789",
      referrerId: null,
      ipAddress: null,
      queries: fakeQueries({ otherUsersWithSameBankAccount: async () => ["user-2"] }),
    });

    assert.deepEqual(result.signals, ["SHARED_BANK_ACCOUNT"]);
    assert.deepEqual(result.relatedUserIds, ["user-2"]);
  });

  it(`menandai IP yang dipakai minimal ${SHARED_IP_MIN_COUNT} akun dan mengabaikan dua akun`, async () => {
    const twoAccounts = await evaluateRegistrationSignals({
      userId: "user-3",
      bank: "BCA",
      bankAccountNumber: null,
      referrerId: null,
      ipAddress: "203.0.113.10",
      queries: fakeQueries({ otherUsersWithSameIpAddress: async () => ["user-1"] }),
    });
    const threeAccounts = await evaluateRegistrationSignals({
      userId: "user-3",
      bank: "BCA",
      bankAccountNumber: null,
      referrerId: null,
      ipAddress: "203.0.113.10",
      queries: fakeQueries({ otherUsersWithSameIpAddress: async () => ["user-1", "user-2"] }),
    });

    assert.deepEqual(twoAccounts.signals, []);
    assert.deepEqual(threeAccounts.signals, ["SHARED_IP"]);
    assert.deepEqual(threeAccounts.relatedUserIds.sort(), ["user-1", "user-2"]);
  });

  it("menandai IP dan rekening yang sama dengan perujuk", async () => {
    const result = await evaluateRegistrationSignals({
      userId: "user-9",
      bank: "BCA",
      bankAccountNumber: "555000111",
      referrerId: "referrer-1",
      ipAddress: "203.0.113.11",
      queries: fakeQueries({
        referrerDetails: async () => ({
          bank: "BCA",
          bankAccountNumber: "555000111",
          registrationIp: "203.0.113.11",
        }),
      }),
    });

    assert.deepEqual([...result.signals].sort(), ["SAME_BANK_AS_REFERRER", "SAME_IP_AS_REFERRER"]);
    assert.deepEqual(result.relatedUserIds, ["referrer-1"]);
  });

  it("tidak menandai nomor rekening sama bila kode bank berbeda", async () => {
    const result = await evaluateRegistrationSignals({
      userId: "user-9",
      bank: "DANA",
      bankAccountNumber: "555000111",
      referrerId: "referrer-1",
      ipAddress: null,
      queries: fakeQueries({
        referrerDetails: async () => ({
          bank: "BCA",
          bankAccountNumber: "555000111",
          registrationIp: null,
        }),
      }),
    });

    assert.deepEqual(result.signals, []);
  });

  it(`menandai lonjakan rujukan mulai ${REFERRER_BURST_MIN_COUNT} pendaftaran per jam`, async () => {
    const below = await evaluateRegistrationSignals({
      userId: "user-9",
      bank: "BCA",
      bankAccountNumber: null,
      referrerId: "referrer-1",
      ipAddress: null,
      queries: fakeQueries({ countReferralsSince: async () => REFERRER_BURST_MIN_COUNT - 1 }),
    });
    const atThreshold = await evaluateRegistrationSignals({
      userId: "user-9",
      bank: "BCA",
      bankAccountNumber: null,
      referrerId: "referrer-1",
      ipAddress: null,
      queries: fakeQueries({ countReferralsSince: async () => REFERRER_BURST_MIN_COUNT }),
    });

    assert.deepEqual(below.signals, []);
    assert.deepEqual(atThreshold.signals, ["REFERRER_BURST"]);
    assert.deepEqual(atThreshold.relatedUserIds, ["referrer-1"]);
  });

  it("tidak pernah memasukkan akun yang sedang diperiksa ke daftar terkait", async () => {
    const result = await evaluateRegistrationSignals({
      userId: "user-7",
      bank: "BCA",
      bankAccountNumber: "987654321",
      referrerId: null,
      ipAddress: "203.0.113.12",
      queries: fakeQueries({ otherUsersWithSameBankAccount: async () => ["user-7", "user-8"] }),
    });

    assert.deepEqual(result.relatedUserIds, ["user-8"]);
  });

  it("mengabaikan alamat IP bila reverse proxy tidak dinyatakan tepercaya", () => {
    const previous = process.env.TRUST_PROXY_HEADERS;
    try {
      delete process.env.TRUST_PROXY_HEADERS;
      assert.equal(trustedIpAddress({ ipAddress: "203.0.113.13" }), null);
      process.env.TRUST_PROXY_HEADERS = "1";
      assert.equal(trustedIpAddress({ ipAddress: "203.0.113.13" }), "203.0.113.13");
      assert.equal(trustedIpAddress({ ipAddress: "   " }), null);
    } finally {
      if (previous === undefined) delete process.env.TRUST_PROXY_HEADERS;
      else process.env.TRUST_PROXY_HEADERS = previous;
    }
  });

  it("memberi label bahasa Indonesia untuk setiap sinyal yang dikenal", () => {
    for (const signal of FRAUD_SIGNALS) {
      assert.equal(isFraudSignal(signal), true, `sinyal=${signal}`);
      assert.equal(fraudSignalLabel(signal), FRAUD_SIGNAL_LABELS[signal]);
      assert.ok(FRAUD_SIGNAL_LABELS[signal].length > 0);
    }
    assert.equal(isFraudSignal("SESUATU_YANG_TIDAK_DIKENAL"), false);
    assert.equal(fraudSignalLabel("TIDAK_DIKENAL"), "TIDAK_DIKENAL");
  });
});

describe("batas keputusan tinjauan (murni)", () => {
  it("menolak peran yang tidak berwenang menutup kasus", () => {
    for (const role of ["FINANCE", "SUPPORT", "VIEWER", null] as const) {
      assert.throws(
        () =>
          validateFraudDecision({
            currentStatus: "OPEN",
            decision: "CLEARED",
            note: "Sudah diperiksa manual",
            actorAdminRole: role,
          }),
        (error: unknown) => error instanceof FraudReviewError && error.code === "FORBIDDEN",
        `role=${String(role)}`,
      );
    }
  });

  it("menerima Super Admin dan Kepatuhan dengan alasan memadai", () => {
    for (const role of ["SUPER_ADMIN", "COMPLIANCE"] as const) {
      const decision = validateFraudDecision({
        currentStatus: "OPEN",
        decision: "CLEARED",
        note: "  Rekening milik keluarga, sudah dikonfirmasi via telepon  ",
        actorAdminRole: role,
      });
      assert.equal(decision, "CLEARED", `role=${role}`);
    }
  });

  it("menolak keputusan tidak dikenal dan kasus yang sudah ditutup", () => {
    assert.throws(
      () =>
        validateFraudDecision({
          currentStatus: "OPEN",
          decision: "MAYBE",
          note: "Sudah diperiksa manual",
          actorAdminRole: "COMPLIANCE",
        }),
      (error: unknown) => error instanceof FraudReviewError && error.code === "INVALID_DECISION",
    );

    assert.throws(
      () =>
        validateFraudDecision({
          currentStatus: "CLEARED",
          decision: "CONFIRMED",
          note: "Sudah diperiksa manual",
          actorAdminRole: "COMPLIANCE",
        }),
      (error: unknown) => error instanceof FraudReviewError && error.code === "CASE_CLOSED",
    );
  });

  it("mewajibkan alasan tertulis minimal 10 karakter", () => {
    assert.throws(
      () =>
        validateFraudDecision({
          currentStatus: "OPEN",
          decision: "CONFIRMED",
          note: "  pendek  ",
          actorAdminRole: "SUPER_ADMIN",
        }),
      (error: unknown) => error instanceof FraudReviewError && error.code === "NOTE_REQUIRED",
    );

    assert.throws(
      () =>
        validateFraudDecision({
          currentStatus: "OPEN",
          decision: "CONFIRMED",
          note: "x".repeat(501),
          actorAdminRole: "SUPER_ADMIN",
        }),
      (error: unknown) => error instanceof FraudReviewError && error.code === "NOTE_TOO_LONG",
    );
  });
});

describe("kasus tinjauan tersimpan di database", () => {
  let owner: { id: string; username: string };
  let twin: { id: string; username: string };
  let reviewer: { id: string; username: string };
  let caseId = "";

  before(async () => {
    owner = await createUser({
      username: `afown${stamp}`,
      bank: "BCA",
      bankAccountNumber: "900900900",
    });
    twin = await createUser({
      username: `aftwin${stamp}`,
      bank: "BCA",
      bankAccountNumber: "900900900",
    });
    reviewer = await createUser({ username: `afrev${stamp}`, adminRole: "COMPLIANCE" });

    const result = await prisma.$transaction((tx) =>
      flagRegistrationInTransaction(tx, {
        userId: twin.id,
        bank: "BCA",
        bankAccountNumber: "900900900",
        referrerId: null,
        meta,
      }),
    );

    assert.deepEqual(result.signals, ["SHARED_BANK_ACCOUNT"]);
    assert.deepEqual(result.relatedUserIds, [owner.id]);

    const stored = await prisma.fraudReview.findUnique({
      where: { userId: twin.id },
      select: { id: true },
    });
    caseId = stored?.id ?? "";
  });

  it("menyimpan kasus terbuka beserta peristiwa keamanan dan jejak audit", async () => {
    assert.ok(caseId, "kasus harus tersimpan");

    const review = await prisma.fraudReview.findUnique({ where: { id: caseId } });
    assert.equal(review?.status, "OPEN");
    assert.deepEqual(review?.signals, ["SHARED_BANK_ACCOUNT"]);
    assert.deepEqual(review?.relatedUserIds, [owner.id]);
    assert.equal(review?.reviewerId, null);
    assert.equal(review?.reviewedAt, null);

    const event = await prisma.securityEvent.findFirst({
      where: { userId: twin.id, type: "FRAUD_FLAGGED" },
    });
    assert.equal(event?.severity, "WARNING");
    assert.match(event?.description ?? "", /Nomor rekening dipakai akun lain/);

    const audit = await prisma.auditLog.findFirst({
      where: { actorUserId: twin.id, action: FRAUD_AUDIT_ACTIONS.flagged },
    });
    assert.equal(audit?.entityType, "FraudReview");
    assert.equal(audit?.entityId, twin.id);
  });

  it("tidak menulis kasus atau peristiwa untuk pendaftaran bersih", async () => {
    const clean = await createUser({
      username: `afclean${stamp}`,
      bank: "BRI",
      bankAccountNumber: "700700700",
    });

    const result = await prisma.$transaction((tx) =>
      flagRegistrationInTransaction(tx, {
        userId: clean.id,
        bank: "BRI",
        bankAccountNumber: "700700700",
        referrerId: null,
        meta,
      }),
    );

    assert.deepEqual(result.signals, []);
    assert.equal(await prisma.fraudReview.count({ where: { userId: clean.id } }), 0);
    assert.equal(
      await prisma.securityEvent.count({ where: { userId: clean.id, type: "FRAUD_FLAGGED" } }),
      0,
    );
  });

  it("mendeteksi tiga akun dari satu alamat IP lewat query database nyata", async () => {
    const ip = "198.51.100.42";
    const first = await createUser({
      username: `afip1${stamp}`,
      bank: "OVO",
      bankAccountNumber: "401401401",
      registrationIp: ip,
    });
    const second = await createUser({
      username: `afip2${stamp}`,
      bank: "OVO",
      bankAccountNumber: "402402402",
      registrationIp: ip,
    });
    const third = await createUser({
      username: `afip3${stamp}`,
      bank: "OVO",
      bankAccountNumber: "403403403",
      registrationIp: ip,
    });

    const result = await evaluateRegistrationSignals({
      userId: third.id,
      bank: "OVO",
      bankAccountNumber: "403403403",
      referrerId: null,
      ipAddress: ip,
      queries: createPrismaSignalQueries(prisma, "OVO"),
    });

    assert.ok(result.signals.includes("SHARED_IP"), "sinyal SHARED_IP harus muncul");
    assert.deepEqual(result.relatedUserIds.sort(), [first.id, second.id].sort());
    assert.equal(result.relatedUserIds.includes(third.id), false);
  });

  it("menampilkan kasus pada antrean terbuka", async () => {
    const cases = await listFraudCases("OPEN");
    const entry = cases.find((row) => row.id === caseId);

    assert.ok(entry, "kasus harus muncul di antrean terbuka");
    assert.equal(entry.statusLabel, "Menunggu tinjauan");
    assert.deepEqual(entry.signalLabels, ["Nomor rekening dipakai akun lain"]);
    assert.deepEqual(entry.relatedUsers.map((user) => user.username), [owner.username]);
    assert.equal(entry.user.username, twin.username);
    assert.equal(entry.reviewerUsername, null);
  });

  it("menolak keputusan dari peran Keuangan tanpa mengubah kasus", async () => {
    const finance = await createUser({ username: `afin${stamp}`, adminRole: "FINANCE" });

    await assert.rejects(
      () =>
        reviewFraudCase({
          caseId,
          decision: "CLEARED",
          note: "Sudah diperiksa manual",
          actorUserId: finance.id,
          actorAdminRole: "FINANCE",
          meta,
        }),
      (error: unknown) => error instanceof FraudReviewError && error.code === "FORBIDDEN",
    );

    const stored = await prisma.fraudReview.findUnique({
      where: { id: caseId },
      select: { status: true, reviewerId: true },
    });
    assert.equal(stored?.status, "OPEN");
    assert.equal(stored?.reviewerId, null);
  });

  it("menutup kasus dengan Kepatuhan dan mencatat jejak audit", async () => {
    const result = await reviewFraudCase({
      caseId,
      decision: "CONFIRMED",
      note: "Rekening terbukti milik akun lain",
      actorUserId: reviewer.id,
      actorAdminRole: "COMPLIANCE",
      meta,
    });

    assert.equal(result.status, "CONFIRMED");

    const stored = await prisma.fraudReview.findUnique({ where: { id: caseId } });
    assert.equal(stored?.status, "CONFIRMED");
    assert.equal(stored?.reviewerId, reviewer.id);
    assert.equal(stored?.reviewNote, "Rekening terbukti milik akun lain");
    assert.ok(stored?.reviewedAt instanceof Date);

    const audit = await prisma.auditLog.findFirst({
      where: { actorUserId: reviewer.id, action: FRAUD_AUDIT_ACTIONS.confirmed },
    });
    assert.equal(audit?.entityId, caseId);

    const stillOpen = await listFraudCases("OPEN");
    assert.equal(stillOpen.some((row) => row.id === caseId), false);
  });

  it("menolak penutupan kasus yang sudah ditutup dan kasus yang tidak ada", async () => {
    await assert.rejects(
      () =>
        reviewFraudCase({
          caseId,
          decision: "CLEARED",
          note: "Percobaan kedua",
          actorUserId: reviewer.id,
          actorAdminRole: "COMPLIANCE",
          meta,
        }),
      (error: unknown) => error instanceof FraudReviewError && error.code === "CASE_CLOSED",
    );

    await assert.rejects(
      () =>
        reviewFraudCase({
          caseId: "00000000-0000-4000-8000-000000000000",
          decision: "CLEARED",
          note: "Kasus tidak ada",
          actorUserId: reviewer.id,
          actorAdminRole: "COMPLIANCE",
          meta,
        }),
      (error: unknown) => error instanceof FraudReviewError && error.code === "CASE_NOT_FOUND",
    );
  });
});

describe("alur pendaftaran nyata", () => {
  it("membuka kasus anti-fraud untuk akun kedua dengan nomor rekening sama", async () => {
    const first = await registerUser(registerInput("e", "880880880"), meta);
    track(first.userId);
    const second = await registerUser(registerInput("f", "880880880"), meta);
    track(second.userId);

    const review = await prisma.fraudReview.findUnique({ where: { userId: second.userId } });
    assert.equal(review?.status, "OPEN");
    assert.deepEqual(review?.signals, ["SHARED_BANK_ACCOUNT"]);
    assert.deepEqual(review?.relatedUserIds, [first.userId]);

    /** Akun pertama tetap bersih: hanya akun kedua yang masuk antrean. */
    assert.equal(await prisma.fraudReview.count({ where: { userId: first.userId } }), 0);

    /** Deteksi tidak memindahkan uang: saldo tetap nol dan tidak ada ledger baru. */
    const balance = await prisma.balance.findUnique({
      where: { userId: second.userId },
      select: { availableAmount: true, totalEarned: true },
    });
    assert.equal(balance?.availableAmount.toFixed(2), "0.00");
    assert.equal(balance?.totalEarned.toFixed(2), "0.00");
    assert.equal(await prisma.transaction.count({ where: { userId: second.userId } }), 0);
    assert.equal(
      await prisma.referralCommission.count({ where: { sourceUserId: second.userId } }),
      0,
    );
  });

  it("menyimpan alamat IP pendaftaran hanya bila proxy tepercaya dinyatakan", async () => {
    const previous = process.env.TRUST_PROXY_HEADERS;

    process.env.TRUST_PROXY_HEADERS = "1";
    try {
      const trusted = await registerUser(registerInput("g", "660660660"), meta);
      track(trusted.userId);
      const stored = await prisma.user.findUnique({
        where: { id: trusted.userId },
        select: { registrationIp: true },
      });
      assert.equal(stored?.registrationIp, meta.ipAddress);
    } finally {
      delete process.env.TRUST_PROXY_HEADERS;
    }

    try {
      const untrusted = await registerUser(registerInput("h", "550550550"), {
        ipAddress: "198.51.100.77",
        userAgent: "node-test",
      });
      track(untrusted.userId);
      const stored = await prisma.user.findUnique({
        where: { id: untrusted.userId },
        select: { registrationIp: true },
      });
      assert.equal(stored?.registrationIp, null);
    } finally {
      if (previous === undefined) delete process.env.TRUST_PROXY_HEADERS;
      else process.env.TRUST_PROXY_HEADERS = previous;
    }
  });
});

describe("integrasi rute, halaman, dan izin", () => {
  it("menautkan halaman tinjauan pada kerangka pembayaran dan halaman panel", () => {
    const shell = readProjectFile("src", "components", "payments", "payment-shell.tsx");
    const adminPage = readProjectFile("src", "app", "admin", "page.tsx");
    const consoleService = readProjectFile("src", "lib", "services", "admin-console-service.ts");

    // Kerangka permukaan anggota menautkan antrean ke halaman kapabilitas di panel.
    assert.match(shell, /"\/admin\/fraud"/);
    assert.match(shell, /showFraudReview/);
    // Dasbor panel hanya memuat penghitung kasus untuk peran dengan readFraud.
    assert.match(adminPage, /canReadFraud/);
    assert.match(adminPage, /Kasus anti-fraud terbuka/);
    assert.match(consoleService, /options\.canReadFraud \? await countOpenFraudCases\(\) : 0/);
  });

  it("membatasi halaman tinjauan pada izin readFraud dan reviewFraud", () => {
    const page = readProjectFile("src", "app", "admin", "fraud", "page.tsx");

    assert.match(page, /requireAdminConsole/);
    assert.match(page, /canAdmin\(admin\.adminRole, "readFraud"\)/);
    assert.match(page, /canAdmin\(admin\.adminRole, "reviewFraud"\)/);
    assert.match(page, /listFraudCases\("ALL"\)/);
    // Alamat lama tetap ada, tetapi hanya sebagai pengalihan ke halaman panel.
    assert.match(
      readProjectFile("src", "app", "fraud-review", "page.tsx"),
      /redirect\("\/admin\/fraud"\)/,
    );
  });

  it("melindungi rute keputusan dengan origin, batas laju, dan pemeriksaan izin", () => {
    const route = readProjectFile("src", "app", "api", "admin", "fraud", "route.ts");

    assert.match(route, /assertSameOrigin\(request\)/);
    assert.match(route, /rateLimit\(/);
    assert.match(route, /getAdminActor\(\)/);
    assert.match(route, /reviewFraudCase\(/);
    assert.match(route, /fraudReviewSchema\.safeParse/);
  });

  it("menyaring pendaftaran di dalam transaksi yang sama", () => {
    const auth = readProjectFile("src", "lib", "services", "auth-service.ts");

    assert.match(auth, /flagRegistrationInTransaction\(tx,/);
    assert.match(auth, /trustedIpAddress\(meta\)/);
  });

  it("tidak pernah memindahkan uang dari pendeteksi anti-fraud", () => {
    const service = readProjectFile("src", "lib", "services", "anti-fraud-service.ts");

    assert.doesNotMatch(service, /balance\.(update|upsert)/);
    assert.doesNotMatch(service, /ledger-service|createTransaction/);
    assert.doesNotMatch(service, /referralCommission\.(create|update)/);
    assert.doesNotMatch(service, /programFundsAmount/);
  });

  it("mengirim migrasi yang aditif untuk tabel dan kolom baru", () => {
    const migration = readProjectFile(
      "prisma",
      "migrations",
      "20261015120000_antifraud_signals",
      "migration.sql",
    );

    assert.match(migration, /CREATE TABLE "FraudReview"/);
    assert.match(migration, /ADD VALUE IF NOT EXISTS 'FRAUD_FLAGGED'/);
    assert.match(migration, /ADD COLUMN\s+"registrationIp" TEXT/);
    assert.doesNotMatch(migration, /\bDROP\b/);
  });

  it("mendokumentasikan model dan enum pada skema Prisma", () => {
    const schema = readProjectFile("prisma", "schema.prisma");

    assert.match(schema, /model FraudReview \{/);
    assert.match(schema, /enum FraudReviewStatus \{/);
    // `prisma format` menyelaraskan spasi antar kolom pada satu model, jadi
    // pemisah antar kolom dicocokkan secara longgar: yang diuji adalah tipe
    // nullable-nya, bukan perataan kosmetik berkas skema.
    assert.match(schema, /registrationIp\s+String\?/);
    assert.match(schema, /enum SecurityEventType \{[\s\S]*?FRAUD_FLAGGED/);
  });

  it("membuka baca untuk tiga peran dan keputusan hanya untuk Super Admin/Kepatuhan", () => {
    for (const role of ["SUPER_ADMIN", "FINANCE", "COMPLIANCE"] as const) {
      assert.equal(canAdmin(role, "readFraud"), true, `readFraud ${role}`);
    }
    for (const role of ["SUPPORT", "VIEWER"] as const) {
      assert.equal(canAdmin(role, "readFraud"), false, `readFraud ${role}`);
    }

    for (const role of ["SUPER_ADMIN", "COMPLIANCE"] as const) {
      assert.equal(canAdmin(role, "reviewFraud"), true, `reviewFraud ${role}`);
    }
    for (const role of ["FINANCE", "SUPPORT", "VIEWER"] as const) {
      assert.equal(canAdmin(role, "reviewFraud"), false, `reviewFraud ${role}`);
    }
    assert.equal(canAdmin(null, "reviewFraud"), false);
  });
});

