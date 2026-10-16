import type { AdminDepositRow } from "@/components/payments/admin-deposit-review";
import type { AdminWithdrawalRow } from "@/components/payments/admin-withdrawal-review";
import type { AdminCommissionRow } from "@/components/payments/admin-commission-review";
import type { AdminMembershipRow } from "@/components/payments/admin-membership-review";
import type { AdminRewardRow } from "@/components/payments/admin-reward-review";
import type { AdminMemberRow } from "@/components/payments/admin-member-directory";
import type { AuditTrailRow } from "@/components/payments/admin-audit-trail";
import { prisma } from "@/lib/prisma";
import { listCommissionsForAdmin } from "@/lib/services/admin-commission-service";
import { countOpenFraudCases } from "@/lib/services/anti-fraud-service";
import { withdrawalAmounts } from "@/lib/withdrawal-fee";

/**
 * Kueri Panel Admin (peran biasa).
 *
 * Semua pembacaan untuk panel dikumpulkan di sini supaya halaman tetap tipis dan
 * aturan "jangan memuat yang tidak boleh dilihat" tinggal di satu tempat: fungsi
 * yang menerima `canReadProof` / `canReadAudit` mengembalikan `null` pada kolom
 * yang tidak boleh dibaca, bukan memuatnya lalu menyembunyikannya di UI.
 *
 * Tindakan yang memindahkan uang tidak ada di sini: panel hanya membaca, lalu
 * memanggil API lama (`/api/admin/*`) yang sudah memakai layanan ledger.
 */

/** Satu entri jejak audit untuk sebuah permintaan, dipakai dialog tinjauan. */
export interface AdminRequestAuditEntry {
  id: string;
  action: string;
  actorUsername: string | null;
  createdAt: Date;
}

/** Indeks jejak audit per id entitas (deposit, penarikan, komisi, keanggotaan, imbalan). */
export async function adminRequestAuditIndex(): Promise<Map<string, AdminRequestAuditEntry[]>> {
  const entries = await prisma.auditLog.findMany({
    where: {
      entityType: {
        in: ["DepositRequest", "WithdrawalRequest", "ReferralCommission", "UserProgram", "Reward"],
      },
    },
    orderBy: { createdAt: "desc" },
    take: 1000,
    select: {
      id: true,
      entityId: true,
      action: true,
      createdAt: true,
      actor: { select: { username: true } },
    },
  });

  const index = new Map<string, AdminRequestAuditEntry[]>();
  for (const entry of entries) {
    if (!entry.entityId) continue;
    const list = index.get(entry.entityId) ?? [];
    list.push({
      id: entry.id,
      action: entry.action,
      actorUsername: entry.actor?.username ?? null,
      createdAt: entry.createdAt,
    });
    index.set(entry.entityId, list);
  }
  return index;
}

/** Angka dasbor panel: setiap nilai adalah agregat langsung dari database. */
export async function adminConsoleOverview(options: { canReadFraud: boolean }) {
  const [
    usersTotal,
    usersActive,
    programsActive,
    membershipsActive,
    membershipsPending,
    depositsPending,
    withdrawalsPending,
    rewardsTotal,
    rewardsPaid,
    rewardsPending,
    commissionsTotal,
    commissionsPaid,
    commissionsPending,
    depositsFlagged,
    withdrawalsRejected,
    approvedDeposits,
    completedWithdrawals,
    adminActivityRows,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { status: "ACTIVE" } }),
    prisma.program.count({ where: { status: "ACTIVE" } }),
    prisma.userProgram.count({ where: { status: "ACTIVE" } }),
    prisma.userProgram.count({ where: { status: "PENDING" } }),
    prisma.depositRequest.count({ where: { status: { in: ["PENDING", "UNDER_REVIEW"] } } }),
    prisma.withdrawalRequest.count({
      where: { status: { in: ["PENDING", "UNDER_REVIEW", "APPROVED", "PROCESSING"] } },
    }),
    prisma.reward.count(),
    prisma.reward.aggregate({ where: { status: "PAID" }, _sum: { amount: true } }),
    prisma.reward.count({ where: { status: "PENDING" } }),
    prisma.referralCommission.count(),
    prisma.referralCommission.aggregate({
      where: { status: "PAID" },
      _sum: { commissionAmount: true },
    }),
    prisma.referralCommission.aggregate({
      where: { status: { in: ["PENDING", "APPROVED"] } },
      _sum: { commissionAmount: true },
    }),
    prisma.depositRequest.count({ where: { status: "FLAGGED" } }),
    prisma.withdrawalRequest.count({ where: { status: "REJECTED" } }),
    prisma.depositRequest.aggregate({ where: { status: "APPROVED" }, _sum: { amount: true } }),
    prisma.withdrawalRequest.aggregate({
      where: { status: "COMPLETED" },
      _sum: { amount: true },
    }),
    // "Aktivitas admin 24 jam" dihitung oleh database (NOW() - 24 jam) sehingga
    // komponen server tidak perlu memanggil fungsi waktu yang tidak murni.
    prisma.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
      FROM "AuditLog"
      WHERE "actorUserId" IS NOT NULL
        AND "createdAt" >= NOW() - INTERVAL '24 hours'
    `,
  ]);

  return {
    usersTotal,
    usersActive,
    programsActive,
    membershipsActive,
    membershipsPending,
    depositsPending,
    withdrawalsPending,
    rewardsTotal,
    rewardsPaid: rewardsPaid._sum.amount ?? 0,
    rewardsPending,
    commissionsTotal,
    commissionsPaid: commissionsPaid._sum.commissionAmount ?? 0,
    commissionsPending: commissionsPending._sum.commissionAmount ?? 0,
    depositsFlagged,
    withdrawalsRejected,
    approvedDeposits: approvedDeposits._sum.amount ?? 0,
    completedWithdrawals: completedWithdrawals._sum.amount ?? 0,
    adminActivity24h: adminActivityRows[0]?.count ?? 0,
    openFraudCases: options.canReadFraud ? await countOpenFraudCases() : 0,
  };
}

/** Antrean deposit (200 terbaru) dalam bentuk yang dipakai komponen tinjauan. */
export async function listDepositQueueForConsole(options: {
  canReadProof: boolean;
  auditIndex: Map<string, AdminRequestAuditEntry[]>;
}): Promise<AdminDepositRow[]> {
  const rows = await prisma.depositRequest.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      user: { select: { name: true, username: true, email: true } },
      userProgram: { include: { tier: true, program: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    amount: row.amount.toFixed(2),
    currency: row.currency,
    paymentMethod: row.paymentMethod,
    paymentReference: row.paymentReference,
    status: row.status,
    rejectionReason: row.rejectionReason,
    reviewNote: row.reviewNote,
    flaggedReason: row.flaggedReason,
    proofFileName: options.canReadProof ? row.proofFileName : null,
    proofMimeType: options.canReadProof ? row.proofMimeType : null,
    proofSize: options.canReadProof ? row.proofSize : null,
    userName: row.user.name,
    userUsername: row.user.username,
    userEmail: row.user.email,
    tierCode: row.userProgram.tier.code,
    programName: row.userProgram.program.name,
    membershipStatus: row.userProgram.status,
    createdAt: row.createdAt,
    reviewedAt: row.reviewedAt,
    auditHistory: options.auditIndex.get(row.id) ?? [],
  }));
}

/** Antrean penarikan (200 terbaru), lengkap dengan biaya dan saldo anggota. */
export async function listWithdrawalQueueForConsole(options: {
  auditIndex: Map<string, AdminRequestAuditEntry[]>;
}): Promise<AdminWithdrawalRow[]> {
  const rows = await prisma.withdrawalRequest.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      user: { select: { name: true, username: true, email: true, balance: true } },
    },
  });

  return rows.map((row) => {
    const amounts = withdrawalAmounts(row);
    return {
      id: row.id,
      amount: row.amount.toFixed(2),
      fee: amounts.fee,
      netAmount: amounts.netAmount,
      currency: row.currency,
      method: row.method,
      destination: row.destination,
      notes: row.notes,
      status: row.status,
      rejectionReason: row.rejectionReason,
      reviewNote: row.reviewNote,
      userName: row.user.name,
      userUsername: row.user.username,
      userEmail: row.user.email,
      availableAmount: (row.user.balance?.availableAmount ?? 0).toFixed(2),
      reservedAmount: (row.user.balance?.reservedAmount ?? 0).toFixed(2),
      createdAt: row.createdAt,
      reviewedAt: row.reviewedAt,
      processedAt: row.processedAt,
      completedAt: row.completedAt,
      proofFileName: row.proofFileName,
      proofMimeType: row.proofMimeType,
      proofSize: row.proofSize,
      auditHistory: options.auditIndex.get(row.id) ?? [],
    };
  });
}

/** Antrean komisi rujukan (100 terbaru) beserta riwayat audit tiap baris. */
export async function listCommissionQueueForConsole(options: {
  auditIndex: Map<string, AdminRequestAuditEntry[]>;
}): Promise<AdminCommissionRow[]> {
  const queue = await listCommissionsForAdmin({ take: 100 });
  return queue.rows.map((row) => ({
    ...row,
    auditHistory: options.auditIndex.get(row.id) ?? [],
  }));
}

/** 50 catatan audit terbaru; hanya dipanggil untuk peran dengan `readAudit`. */
export async function listAuditTrailForConsole(): Promise<AuditTrailRow[]> {
  const rows = await prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { actor: { select: { username: true, name: true } } },
  });

  return rows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt,
    actorName: row.actor?.name ?? null,
    actorUsername: row.actor?.username ?? null,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    before: row.before,
    after: row.after,
  }));
}

/**
 * Direktori anggota (hanya baca) untuk petugas.
 *
 * Saldo dibaca apa adanya dari `Balance` (tidak ada perhitungan ulang di UI) dan
 * dihitungkan bersama jumlah keanggotaan aktif/menunggu, supaya petugas dapat
 * menjawab pertanyaan anggota tanpa membuka Konsol Pemilik. Tidak ada tindakan
 * uang di sini: menambah saldo tetap milik pemilik (`creditBalance`).
 */
export async function listMemberDirectoryForConsole(): Promise<AdminMemberRow[]> {
  const rows = await prisma.user.findMany({
    where: { role: "USER" },
    orderBy: { createdAt: "desc" },
    take: 300,
    select: {
      id: true,
      name: true,
      username: true,
      email: true,
      phone: true,
      status: true,
      createdAt: true,
      lastLoginAt: true,
      balance: {
        select: {
          availableAmount: true,
          pendingAmount: true,
          programFundsAmount: true,
          totalEarned: true,
        },
      },
      userPrograms: { select: { status: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    username: row.username,
    email: row.email,
    phone: row.phone,
    status: row.status,
    createdAt: row.createdAt,
    lastLoginAt: row.lastLoginAt,
    availableAmount: (row.balance?.availableAmount ?? 0).toFixed(2),
    pendingAmount: (row.balance?.pendingAmount ?? 0).toFixed(2),
    programFundsAmount: (row.balance?.programFundsAmount ?? 0).toFixed(2),
    totalEarned: (row.balance?.totalEarned ?? 0).toFixed(2),
    activeMemberships: row.userPrograms.filter((item) => item.status === "ACTIVE").length,
    pendingMemberships: row.userPrograms.filter((item) => item.status === "PENDING").length,
  }));
}

/**
 * Antrean keanggotaan program untuk ditindak: seluruh status dimuat (termasuk
 * PENDING yang menunggu dana dikonfirmasi) karena halaman ini juga tempat
 * menelusuri keanggotaan lama, bukan hanya antrean tindakan.
 */
export async function listMembershipQueueForConsole(options: {
  auditIndex: Map<string, AdminRequestAuditEntry[]>;
}): Promise<AdminMembershipRow[]> {
  const rows = await prisma.userProgram.findMany({
    orderBy: [{ joinedAt: "desc" }, { id: "desc" }],
    take: 200,
    include: {
      user: { select: { name: true, username: true, email: true } },
      program: { select: { name: true, code: true } },
      tier: { select: { code: true, name: true } },
      cycle: { select: { cycleWeeks: true } },
      depositRequests: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { status: true, amount: true, currency: true },
      },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    userName: row.user.name,
    userUsername: row.user.username,
    userEmail: row.user.email,
    programName: row.program.name,
    programCode: row.program.code,
    tierCode: row.tier.code,
    tierName: row.tier.name,
    cycleWeeks: row.cycle?.cycleWeeks ?? row.cycleWeeks,
    weeklyRewardRate: row.weeklyRewardRate.toString(),
    maxCycleRewardRate: row.maxCycleRewardRate.toString(),
    joinAmount: row.joinAmount.toFixed(2),
    currency: row.currency,
    fundsConfirmedAmount: row.fundsConfirmedAmount.toFixed(2),
    fundsConfirmedAt: row.fundsConfirmedAt,
    status: row.status,
    cycleNumber: row.cycleNumber,
    weeksCompleted: row.weeksCompleted,
    referralCodeUsed: row.referralCodeUsed,
    joinedAt: row.joinedAt,
    activatedAt: row.activatedAt,
    completedAt: row.completedAt,
    suspendedAt: row.suspendedAt,
    cancelledAt: row.cancelledAt,
    notes: row.notes,
    latestDepositStatus: row.depositRequests[0]?.status ?? null,
    latestDepositAmount: row.depositRequests[0]
      ? row.depositRequests[0].amount.toFixed(2)
      : null,
    auditHistory: options.auditIndex.get(row.id) ?? [],
  }));
}

/**
 * Antrean imbalan anggota. Baris dimuat untuk semua status karena keputusan
 * `pay` dan `void` justru sering menyusul baris yang sudah APPROVED atau PAID.
 */
export async function listRewardQueueForConsole(options: {
  auditIndex: Map<string, AdminRequestAuditEntry[]>;
}): Promise<AdminRewardRow[]> {
  const rows = await prisma.reward.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 200,
    include: {
      user: { select: { name: true, username: true, email: true } },
      program: { select: { name: true } },
      tier: { select: { code: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    userName: row.user.name,
    userUsername: row.user.username,
    userEmail: row.user.email,
    programName: row.program.name,
    tierCode: row.tier.code,
    period: row.period,
    cycleNumber: row.cycleNumber,
    amount: row.amount.toFixed(2),
    currency: row.currency,
    rate: row.rate.toString(),
    status: row.status,
    scheduledFor: row.scheduledFor,
    approvedAt: row.approvedAt,
    paidAt: row.paidAt,
    createdAt: row.createdAt,
    notes: row.notes,
    auditHistory: options.auditIndex.get(row.id) ?? [],
  }));
}
