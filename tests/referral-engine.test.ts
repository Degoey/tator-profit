import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Prisma, type AdminRole } from "@prisma/client";
import { createTestPrismaClient } from "./helpers/prisma";

import { listCommissionsForAdmin } from "../src/lib/services/admin-commission-service";
import { getBalance } from "../src/lib/services/ledger-service";
import {
  notificationHref,
  notificationMetadataString,
} from "../src/lib/services/notification-service";
import { activateUserProgram, joinProgramTier } from "../src/lib/services/program-service";
import {
  ReferralError,
  getReferralNetwork,
  listReferralCommissions,
  postReferralCommissionsForTransaction,
  setReferralCommissionStatus,
} from "../src/lib/services/referral-service";

/**
 * Integration tests for the five-level referral engine against the real
 * PostgreSQL database.
 *
 * The whole scenario is a single deterministic chain
 *
 *   root -> g1 -> g2 -> g3 -> g4 -> joiner
 *
 * so a posted PROGRAM_FUNDS entry for `joiner` must pay g4 (level 1), g3 (2),
 * g2 (3), g1 (4) and root (5). The administrator settlement surface (queue,
 * capability checks, audit trail) is exercised on the very same rows at the end,
 * once their statuses are known. Tests share that chain and therefore run in
 * declaration order; the `after` hook removes every row it created, including
 * the append-only ledger entries (the purge flag is scoped to its own
 * transaction).
 */
const prisma = createTestPrismaClient();
const stamp = `${Date.now()}`.slice(-7);
const meta = { ipAddress: "198.18.8.8", userAgent: "node-test" };

let programId = "";
let tierId = "";
let adminId = "";
let rootId = "";
let g1Id = "";
let g2Id = "";
let g3Id = "";
let g4Id = "";
let joinerId = "";
let outsiderId = "";

/** root, g1, g2, g3, g4, joiner — the chain the whole file shares. */
const chainIds: string[] = [];
/** The beneficiaries a level-5 program event must pay, in level order 1..5. */
const expectedBeneficiaryOrder: string[] = [];
const createdUserIds: string[] = [];
let userCounter = 0;

async function createUser(
  label: string,
  role: "USER" | "ADMIN" = "USER",
  /** Administrators default to FINANCE; pass another role to test the boundary. */
  adminRole: AdminRole | null = role === "ADMIN" ? "FINANCE" : null,
) {
  userCounter += 1;
  const username = `${label}_${stamp}`;
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

/** Records the referral edge `referrerId -> referredUserId` directly in the database. */
async function link(referrerId: string, referredUserId: string, code: string) {
  return prisma.referral.create({
    data: { referrerId, referredUserId, level: 1, codeUsed: code, status: "ACTIVE" },
    select: { id: true },
  });
}

/** Captures the rejection instead of throwing, so the message can be inspected. */
async function captureError(run: () => Promise<unknown>): Promise<Error> {
  try {
    await run();
  } catch (error) {
    return error as Error;
  }
  throw new assert.AssertionError({ message: "operasi seharusnya ditolak" });
}

before(async () => {
  try {
    await setupScenario();
  } catch (error) {
    console.error("SETUP GAGAL:", error);
    throw error;
  }
});

async function setupScenario() {
  const program = await prisma.program.create({
    data: {
      code: `TEST-REF-${stamp}`,
      name: "Program uji jaringan rujukan",
      currency: "USDT",
      weeklyRewardRate: new Prisma.Decimal("0.1000"),
      cycleWeeks: 4,
      maxCycleRewardRate: new Prisma.Decimal("0.4000"),
      status: "ACTIVE",
      isDefault: false,
      tiers: {
        create: [
          {
            code: `USDT-100-REF-${stamp}`,
            name: "Uji rujukan USDT 100",
            joinAmount: new Prisma.Decimal("100.00"),
            sortOrder: 1,
          },
        ],
      },
    },
    select: { id: true, tiers: { select: { id: true } } },
  });

  programId = program.id;
  tierId = program.tiers[0]!.id;

  const admin = await createUser("admin-ref", "ADMIN");
  const root = await createUser("root");
  const g1 = await createUser("g1");
  const g2 = await createUser("g2");
  const g3 = await createUser("g3");
  const g4 = await createUser("g4");
  const joiner = await createUser("joiner");
  const outsider = await createUser("outsider");

  adminId = admin.id;
  rootId = root.id;
  g1Id = g1.id;
  g2Id = g2.id;
  g3Id = g3.id;
  g4Id = g4.id;
  outsiderId = outsider.id;
  joinerId = joiner.id;
  chainIds.push(root.id, g1.id, g2.id, g3.id, g4.id, joiner.id);
  expectedBeneficiaryOrder.push(g4.id, g3.id, g2.id, g1.id, root.id);

  await link(root.id, g1.id, `REF-G1-${stamp}`);
  await link(g1.id, g2.id, `REF-G2-${stamp}`);
  await link(g2.id, g3.id, `REF-G3-${stamp}`);
  await link(g3.id, g4.id, `REF-G4-${stamp}`);
  await link(g4.id, joiner.id, `REF-JOINER-${stamp}`);
}

after(async () => {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL tatorprofit.allow_ledger_purge = 'on'");
    await tx.referralCommission.deleteMany({
      where: {
        OR: [
          { beneficiaryUserId: { in: createdUserIds } },
          { sourceUserId: { in: createdUserIds } },
        ],
      },
    });
    await tx.referral.deleteMany({
      where: {
        OR: [{ referrerId: { in: createdUserIds } }, { referredUserId: { in: createdUserIds } }],
      },
    });
    await tx.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  await prisma.programTier.deleteMany({ where: { programId } });
  await prisma.program.delete({ where: { id: programId } });
  await prisma.$disconnect();
});

describe("mesin komisi rujukan lima tingkat (database)", () => {
  it("membayar lima generasi dengan persentase benar dari satu transaksi sumber", async () => {
    const join = await joinProgramTier(joinerId, tierId, meta);
    const activation = await activateUserProgram({
      userProgramId: join.userProgramId,
      actorUserId: adminId,
      meta,
    });

    assert.equal(activation.status, "ACTIVE");
    assert.equal(activation.referralCommissionsCreated, 5);

    const rows = await prisma.referralCommission.findMany({
      where: { sourceUserId: joinerId },
      orderBy: [{ level: "asc" }],
      select: {
        level: true,
        beneficiaryUserId: true,
        baseAmount: true,
        rate: true,
        commissionAmount: true,
        currency: true,
        status: true,
        sourceTransactionId: true,
        sourceReference: true,
      },
    });

    assert.equal(rows.length, 5);
    assert.deepEqual(
      rows.map((row) => row.level),
      [1, 2, 3, 4, 5],
    );
    assert.deepEqual(
      rows.map((row) => row.beneficiaryUserId),
      expectedBeneficiaryOrder,
      "generasi 1 sampai 5 harus menerima sesuai urutan upline",
    );
    assert.deepEqual(
      rows.map((row) => row.commissionAmount.toFixed(2)),
      ["10.00", "2.00", "1.00", "1.00", "1.00"],
    );
    assert.deepEqual(
      rows.map((row) => row.rate.toFixed(4)),
      ["0.1000", "0.0200", "0.0100", "0.0100", "0.0100"],
    );
    assert.ok(rows.every((row) => row.baseAmount.toFixed(2) === "100.00"));
    assert.ok(rows.every((row) => row.status === "PENDING"));
    assert.ok(rows.every((row) => row.currency === "USDT"));
    assert.equal(
      new Set(rows.map((row) => row.sourceTransactionId)).size,
      1,
      "semua komisi harus menunjuk satu transaksi sumber yang sama",
    );
    assert.ok(
      rows.every((row) => row.sourceReference === `program:${join.userProgramId}:funds`),
      "referensi sumber harus menunjuk entri buku besar dana program",
    );

    // Setiap penerima komisi diberi tahu bahwa komisinya tercatat; akun di luar
    // rantai tidak menerima apa pun. Notifikasi ditulis di transaksi aktivasi
    // yang sama, jadi tidak mungkin ada pesan tanpa baris komisinya.
    const notices = await prisma.notification.findMany({
      where: { userId: { in: [...expectedBeneficiaryOrder, outsiderId] }, type: "REFERRAL" },
      select: { userId: true, title: true, body: true, metadata: true },
    });

    assert.equal(notices.length, 5, "satu notifikasi untuk setiap generasi yang dibayar");
    assert.equal(new Set(notices.map((notice) => notice.userId)).size, 5);

    for (const notice of notices) {
      const row = rows.find((candidate) => candidate.beneficiaryUserId === notice.userId);
      assert.ok(row, "notifikasi hanya boleh dikirim ke penerima komisi");
      assert.equal(notice.title, `Komisi rujukan tercatat: tingkat ${row.level}`);
      assert.ok(
        notice.body.includes(`Komisi rujukan tingkat ${row.level} sebesar USDT ${row.commissionAmount.toFixed(2)}`),
        `notifikasi harus menyebut nominal komisi (isi: ${notice.body})`,
      );
      assert.equal(
        notificationMetadataString(notice.metadata, "status"),
        "PENDING",
        "notifikasi pencatatan menandai status menunggu",
      );
      assert.equal(
        notificationHref(notice.metadata),
        "/referral",
        "notifikasi harus menautkan halaman komisi member",
      );
    }
  });

  it("tidak mencatat komisi dua kali ketika peristiwa sumber diputar ulang", async () => {
    const source = await prisma.transaction.findFirstOrThrow({
      where: { userId: joinerId, type: "PROGRAM_JOIN", bucket: "PROGRAM_FUNDS", status: "POSTED" },
      select: { id: true },
    });

    const replay = await prisma.$transaction((tx) =>
      postReferralCommissionsForTransaction(tx, { transactionId: source.id }),
    );

    assert.equal(replay.status, "DUPLICATE");
    assert.equal(replay.created.length, 0);
    assert.equal(
      await prisma.referralCommission.count({ where: { sourceTransactionId: source.id } }),
      5,
    );
    assert.equal(
      await prisma.notification.count({
        where: { userId: { in: expectedBeneficiaryOrder }, type: "REFERRAL" },
      }),
      5,
      "pemutaran ulang tidak boleh mengirim pesan kedua ke member",
    );
  });

  it("mengaktifkan ulang keanggotaan tanpa menggandakan komisi", async () => {
    const again = await activateUserProgram({
      userProgramId: (
        await prisma.userProgram.findFirstOrThrow({
          where: { userId: joinerId },
          select: { id: true },
        })
      ).id,
      actorUserId: adminId,
      meta,
    }).catch((error: unknown) => error as Error);

    assert.ok(
      again instanceof Error,
      "keanggotaan yang sudah aktif harus ditolak, bukan membuat komisi baru",
    );
    assert.equal(await prisma.referralCommission.count({ where: { sourceUserId: joinerId } }), 5);
  });

  it("permintaan gabung dan keanggotaan MENUNGGU tidak menghasilkan komisi", async () => {
    const candidate = await createUser("pending");
    await link(g4Id, candidate.id, `REF-PENDING-${stamp}`);

    const join = await joinProgramTier(candidate.id, tierId, meta);
    assert.equal(join.status, "PENDING");

    const entries = await prisma.transaction.findMany({
      where: { userId: candidate.id },
      select: { id: true, type: true, bucket: true, status: true },
    });

    assert.ok(entries.length > 0, "permintaan gabung harus tercatat di buku besar");
    for (const entry of entries) {
      const result = await prisma.$transaction((tx) =>
        postReferralCommissionsForTransaction(tx, { transactionId: entry.id }),
      );
      assert.equal(
        result.status,
        "INELIGIBLE",
        `entri ${entry.type}/${entry.bucket}/${entry.status} tidak boleh menghasilkan komisi`,
      );
    }

    assert.equal(
      await prisma.referralCommission.count({ where: { sourceUserId: candidate.id } }),
      0,
    );
  });

  it("menolak rujukan yang merujuk diri sendiri atau membentuk siklus", async () => {
    const selfError = await captureError(() => link(rootId, rootId, `REF-SELF-${stamp}`));
    assert.ok(
      /cycle/i.test(selfError.message),
      `database harus menolak rujukan diri sendiri (pesan: ${selfError.message})`,
    );

    // g1 sudah menjadi turunan root, jadi root tidak boleh dirujuk oleh g1.
    const cycleError = await captureError(() => link(g1Id, rootId, `REF-CYCLE-${stamp}`));
    assert.ok(
      /cycle/i.test(cycleError.message),
      `database harus menolak siklus rujukan (pesan: ${cycleError.message})`,
    );

    assert.equal(
      await prisma.referral.count({ where: { referrerId: g1Id, referredUserId: rootId } }),
      0,
    );
    assert.equal(await prisma.referral.count({ where: { referrerId: rootId, referredUserId: rootId } }), 0);
  });
});


describe("siklus hidup dan pembatasan akses komisi rujukan (database)", () => {
  it("menolak perubahan status komisi oleh akun non-administrator", async () => {
    const commission = await prisma.referralCommission.findFirstOrThrow({
      where: { beneficiaryUserId: g4Id },
      select: { id: true },
    });

    for (const action of ["APPROVE", "PAY", "REJECT", "VOID"] as const) {
      const error = await captureError(() =>
        setReferralCommissionStatus({
          commissionId: commission.id,
          action,
          actorUserId: outsiderId,
          reason: action === "REJECT" || action === "VOID" ? "Uji wewenang" : undefined,
          meta,
        }),
      );

      assert.ok(error instanceof ReferralError, `aksi ${action} harus ditolak`);
      assert.equal((error as ReferralError).status, 403);
      assert.equal((error as ReferralError).code, "FORBIDDEN");
    }

    const unchanged = await prisma.referralCommission.findUniqueOrThrow({
      where: { id: commission.id },
      select: { status: true },
    });
    assert.equal(unchanged.status, "PENDING");
    assert.equal(
      await prisma.notification.count({
        where: {
          userId: g4Id,
          type: "REFERRAL",
          title: { startsWith: "Komisi rujukan " },
          NOT: { title: { startsWith: "Komisi rujukan tercatat" } },
        },
      }),
      0,
      "percobaan tanpa wewenang tidak boleh menghasilkan kabar apa pun",
    );
  });

  it("administrator menyetujui lalu membayar komisi sehingga saldo bertambah sekali", async () => {
    const commission = await prisma.referralCommission.findFirstOrThrow({
      where: { beneficiaryUserId: g3Id, level: 2 },
      select: { id: true, commissionAmount: true },
    });

    const approved = await setReferralCommissionStatus({
      commissionId: commission.id,
      action: "APPROVE",
      actorUserId: adminId,
      meta,
    });
    assert.equal(approved.status, "APPROVED");
    assert.equal(
      await prisma.notification.count({
        where: {
          userId: g3Id,
          type: "REFERRAL",
          title: { startsWith: "Komisi rujukan dibayar" },
        },
      }),
      0,
      "persetujuan belum memindahkan uang sehingga belum ada kabar pembayaran",
    );

    const before = await getBalance(g3Id);
    const paid = await setReferralCommissionStatus({
      commissionId: commission.id,
      action: "PAY",
      actorUserId: adminId,
      meta,
    });
    const after = await getBalance(g3Id);

    assert.equal(paid.status, "PAID");
    assert.equal(paid.payoutReference, `referral-commission:${commission.id}:payout`);
    assert.equal(
      after.availableAmount.minus(before.availableAmount).toFixed(2),
      commission.commissionAmount.toFixed(2),
      "saldo harus bertambah tepat sebesar nilai komisi",
    );

    // Kabar pembayaran ditulis di transaksi yang sama dengan pemindahan saldo.
    const paidNotice = await prisma.notification.findFirstOrThrow({
      where: { userId: g3Id, type: "REFERRAL", title: "Komisi rujukan dibayar: tingkat 2" },
      select: { body: true, metadata: true },
    });
    assert.ok(
      paidNotice.body.includes(`USDT ${commission.commissionAmount.toFixed(2)}`),
      "notifikasi pembayaran harus menyebut nominal yang benar",
    );
    assert.equal(notificationMetadataString(paidNotice.metadata, "status"), "PAID");
    assert.equal(
      notificationMetadataString(paidNotice.metadata, "payoutReference"),
      paid.payoutReference,
      "notifikasi menunjuk referensi pembayaran yang sama dengan hasil pembayaran",
    );
    assert.equal(notificationHref(paidNotice.metadata), "/referral");

    const terminal = await captureError(() =>
      setReferralCommissionStatus({
        commissionId: commission.id,
        action: "PAY",
        actorUserId: adminId,
        meta,
      }),
    );
    assert.ok(terminal instanceof ReferralError);
    assert.equal((terminal as ReferralError).code, "INVALID_COMMISSION_STATUS");

    const settled = await getBalance(g3Id);
    assert.equal(settled.availableAmount.toFixed(2), after.availableAmount.toFixed(2));
  });

  it("mewajibkan alasan saat komisi ditolak atau dibatalkan", async () => {
    const commission = await prisma.referralCommission.findFirstOrThrow({
      where: { beneficiaryUserId: g2Id, level: 3 },
      select: { id: true, level: true },
    });

    const noReason = await captureError(() =>
      setReferralCommissionStatus({
        commissionId: commission.id,
        action: "REJECT",
        actorUserId: adminId,
        meta,
      }),
    );
    assert.ok(noReason instanceof ReferralError);
    assert.equal((noReason as ReferralError).code, "REASON_REQUIRED");

    const rejected = await setReferralCommissionStatus({
      commissionId: commission.id,
      action: "REJECT",
      actorUserId: adminId,
      reason: "Data program tidak sesuai",
      meta,
    });
    assert.equal(rejected.status, "REJECTED");

    // Komisi yang ditolak juga diberitahukan, lengkap dengan alasan wajibnya.
    const rejectedNotice = await prisma.notification.findFirstOrThrow({
      where: {
        userId: g2Id,
        type: "REFERRAL",
        title: `Komisi rujukan ditolak: tingkat ${commission.level}`,
      },
      select: { body: true, metadata: true },
    });
    assert.ok(rejectedNotice.body.includes("Alasan: Data program tidak sesuai"));
    assert.equal(notificationMetadataString(rejectedNotice.metadata, "status"), "REJECTED");
    assert.equal(
      notificationMetadataString(rejectedNotice.metadata, "reason"),
      "Data program tidak sesuai",
      "alasan tersimpan di metadata, bukan hanya di badan teks",
    );
    assert.equal(notificationHref(rejectedNotice.metadata), "/referral");

    const stillPending = await prisma.referralCommission.findFirstOrThrow({
      where: { beneficiaryUserId: g4Id },
      select: { status: true },
    });
    assert.equal(stillPending.status, "PENDING");
  });

  it("setiap akun hanya membaca komisi yang menjadi miliknya", async () => {
    const rootRows = await listReferralCommissions(rootId);
    const g4Rows = await listReferralCommissions(g4Id);
    const outsiderRows = await listReferralCommissions(outsiderId);

    assert.equal(rootRows.length, 1);
    assert.equal(rootRows[0]?.level, 5);
    assert.equal(rootRows[0]?.sourceUserId, joinerId);
    assert.equal(rootRows[0]?.status, "PENDING");
    assert.equal(rootRows[0]?.commissionAmount, "1.00");

    assert.equal(g4Rows.length, 1);
    assert.equal(g4Rows[0]?.level, 1);
    assert.equal(g4Rows[0]?.commissionAmount, "10.00");
    assert.equal(g4Rows[0]?.rate, "0.1000");
    assert.equal(g4Rows[0]?.sourceTransactionId.length > 0, true);

    assert.deepEqual(outsiderRows, []);
  });

  it("pohon jaringan membaca lima generasi langsung dari database", async () => {
    const network = await getReferralNetwork({ id: rootId, username: "" });

    assert.equal(network.total, 6);
    assert.deepEqual(network.counts, [1, 1, 1, 1, 2]);
    assert.equal(network.truncated, false);
    assert.equal(network.root.children[0]?.username.startsWith("g1_"), true);
    assert.equal(network.root.children[0]?.children[0]?.level, 2);
    assert.equal(network.root.children[0]?.children[0]?.children[0]?.children[0]?.children[0]?.level, 5);
  });

  it("antrean administrator memuat komisi dengan filter status dan pencarian", async () => {
    const pending = await listCommissionsForAdmin({ search: `_${stamp}`, status: "PENDING" });

    assert.equal(pending.total, 3, "tingkat 1, 4, dan 5 masih menunggu penyelesaian");
    assert.equal(pending.rows.length, 3);
    assert.ok(pending.rows.every((row) => row.status === "PENDING"));
    assert.ok(pending.rows.every((row) => row.currency === "USDT"));
    assert.ok(
      pending.rows.every((row) => row.payoutReference === null),
      "komisi yang belum dibayar tidak punya referensi pembayaran",
    );

    const g1Row = pending.rows.find((row) => row.beneficiaryUsername === `g1_${stamp}`);
    assert.ok(g1Row, "antrean harus memuat komisi tingkat 4 milik g1");
    assert.equal(g1Row.level, 4);
    assert.equal(g1Row.beneficiaryName, "Uji g1");
    assert.equal(g1Row.sourceUsername, `joiner_${stamp}`);
    assert.equal(g1Row.commissionAmount, "1.00");
    assert.equal(g1Row.baseAmount, "100.00");
    assert.equal(g1Row.rate, "0.0100");

    const paidRow = await listCommissionsForAdmin({ search: `g3_${stamp}`, status: "PAID" });
    assert.equal(paidRow.total, 1);
    assert.equal(paidRow.rows[0]?.beneficiaryUsername, `g3_${stamp}`);
    assert.equal(
      paidRow.rows[0]?.payoutReference,
      `referral-commission:${(await prisma.referralCommission.findFirstOrThrow({
        where: { beneficiaryUserId: g3Id, level: 2 },
        select: { id: true },
      })).id}:payout`,
      "baris yang dibayar menunjuk entri ledger pembayarannya",
    );

    const rejected = await listCommissionsForAdmin({ search: `g2_${stamp}` });
    assert.equal(rejected.total, 1, "pencarian kata kunci membatasi hasil pada satu penerima");
    assert.equal(rejected.rows[0]?.status, "REJECTED");

    // Paginasi: total selalu jumlah baris yang cocok, bukan jumlah baris halaman.
    const firstPage = await listCommissionsForAdmin({ search: `_${stamp}`, take: 2 });
    const secondPage = await listCommissionsForAdmin({ search: `_${stamp}`, take: 2, skip: 2 });
    assert.equal(firstPage.total, 5);
    assert.equal(firstPage.rows.length, 2);
    assert.equal(secondPage.rows.length, 2);
    assert.equal(
      new Set([...firstPage.rows, ...secondPage.rows].map((row) => row.id)).size,
      4,
      "halaman tidak boleh mengulang baris yang sama",
    );
  });

  it("administrator tanpa capability manageFinance tidak dapat menyelesaikan komisi", async () => {
    const support = await createUser("admin-support", "ADMIN", "SUPPORT");
    const noRole = await createUser("admin-tanpa-peran", "ADMIN", null);

    const commission = await prisma.referralCommission.findFirstOrThrow({
      where: { beneficiaryUserId: g4Id, level: 1 },
      select: { id: true },
    });

    const actors: [string, string][] = [
      ["SUPPORT", support.id],
      ["tanpa peran admin", noRole.id],
    ];

    for (const [label, actorUserId] of actors) {
      for (const action of ["APPROVE", "PAY", "REJECT"] as const) {
        const error = await captureError(() =>
          setReferralCommissionStatus({
            commissionId: commission.id,
            action,
            actorUserId,
            reason: action === "REJECT" ? "Uji wewenang komisi" : undefined,
            meta,
          }),
        );

        assert.ok(error instanceof ReferralError, `${label}/${action} harus ditolak`);
        assert.equal((error as ReferralError).code, "FORBIDDEN", `${label}/${action}`);
        assert.equal((error as ReferralError).status, 403, `${label}/${action}`);
      }
    }

    const unchanged = await prisma.referralCommission.findUniqueOrThrow({
      where: { id: commission.id },
      select: { status: true },
    });
    assert.equal(unchanged.status, "PENDING", "percobaan tanpa wewenang tidak boleh mengubah status");
  });

  it("SUPER_ADMIN menyetujui komisi dan jejak auditnya memuat aktor", async () => {
    const superAdmin = await createUser("admin-super", "ADMIN", "SUPER_ADMIN");
    const commission = await prisma.referralCommission.findFirstOrThrow({
      where: { beneficiaryUserId: g4Id, level: 1 },
      select: { id: true },
    });

    const approved = await setReferralCommissionStatus({
      commissionId: commission.id,
      action: "APPROVE",
      actorUserId: superAdmin.id,
      meta,
    });
    assert.equal(approved.status, "APPROVED");
    assert.equal(approved.payoutReference, null, "persetujuan belum memindahkan uang");

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: "ReferralCommission", entityId: commission.id },
      orderBy: { createdAt: "desc" },
      select: { action: true, actorUserId: true, before: true, after: true },
    });
    assert.equal(audit.action, "referral.commission.approve");
    assert.equal(audit.actorUserId, superAdmin.id, "jejak audit menunjuk administrator pelakunya");
    assert.equal(
      (audit.before as { status?: string } | null)?.status,
      "PENDING",
      "snapshot sebelum aksi tersimpan",
    );
    assert.equal((audit.after as { status?: string } | null)?.status, "APPROVED");
  });
});
