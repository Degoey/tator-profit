import type { AdminDepositRow } from "@/components/payments/admin-deposit-review";
import type { AdminWithdrawalRow } from "@/components/payments/admin-withdrawal-review";
import type { AdminCommissionRow } from "@/components/payments/admin-commission-review";
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

/** Indeks jejak audit per id entitas (deposit, penarikan, komisi). */
export async function adminRequestAuditIndex(): Promise<Map<string, AdminRequestAuditEntry[]>> {
  const entries = await prisma.auditLog.findMany({
    where: {
      entityType: { in: ["DepositRequest", "WithdrawalRequest", "ReferralCommission"] },
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
