import type { Prisma } from "@prisma/client";

import { decimalToString } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import {
  listDepositsForAdmin,
  listWithdrawalsForAdmin,
  type AdminDepositRow,
  type AdminWithdrawalRow,
} from "@/lib/services/manual-payment-service";

/**
 * Model baca Konsol Pemilik.
 *
 * Semua angka di sini adalah agregat database sungguhan — tidak ada angka contoh
 * dan tidak ada nilai yang dibulatkan di sisi tampilan. Fungsi di modul ini
 * **hanya membaca**; setiap tindakan yang mengubah uang atau status tetap melalui
 * layanan yang sudah ada (`manual-payment-service`, `admin-credit-service`)
 * sehingga aturan ledger dan jejak auditnya tidak diduplikasi.
 */

export interface OwnerOverview {
  counts: {
    users: number;
    usersActive: number;
    usersNewToday: number;
    membershipsPending: number;
    membershipsActive: number;
    depositsAwaiting: number;
    withdrawalsInFlight: number;
    fraudOpen: number;
    securityWarnings24h: number;
    failedLogins24h: number;
  };
  sums: {
    available: string;
    reserved: string;
    pending: string;
    programFunds: string;
    totalEarned: string;
    depositsApproved: string;
    withdrawalsCompleted: string;
  };
  recentDeposits: AdminDepositRow[];
  recentWithdrawals: AdminWithdrawalRow[];
  recentAudit: OwnerAuditRow[];
}

export interface OwnerAuditRow {
  id: string;
  createdAt: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actorUserId: string | null;
  actorUsername: string | null;
  ipAddress: string | null;
  before: unknown;
  after: unknown;
}

export interface OwnerMemberRow {
  id: string;
  name: string;
  username: string;
  email: string;
  phone: string;
  status: string;
  role: string;
  adminRole: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  referralCode: string | null;
  membershipStatus: string | null;
  balance: {
    currency: string;
    available: string;
    reserved: string;
    pending: string;
    programFunds: string;
    totalEarned: string;
  };
}

export interface OwnerMemberDetail extends OwnerMemberRow {
  bank: string | null;
  bankAccountNumber: string | null;
  registrationIp: string | null;
  emailVerifiedAt: string | null;
  transactions: {
    id: string;
    createdAt: string;
    type: string;
    status: string;
    bucket: string;
    amount: string;
    currency: string;
    reference: string;
    description: string | null;
    balanceAfter: string;
  }[];
  sessions: {
    id: string;
    createdAt: string;
    lastUsedAt: string | null;
    expiresAt: string;
    revokedAt: string | null;
    ipAddress: string | null;
    userAgent: string | null;
    totpVerifiedAt: string | null;
  }[];
  securityEvents: {
    id: string;
    createdAt: string;
    type: string;
    severity: string;
    description: string | null;
    ipAddress: string | null;
  }[];
  deposits: AdminDepositRow[];
  withdrawals: AdminWithdrawalRow[];
}

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function money(value: Prisma.Decimal | null | undefined): string {
  return decimalToString(value ?? 0);
}

const EMPTY_BALANCE = {
  currency: "USDT",
  available: "0.00",
  reserved: "0.00",
  pending: "0.00",
  programFunds: "0.00",
  totalEarned: "0.00",
};

/** Ringkasan seluruh platform untuk halaman utama konsol pemilik. */
export async function ownerOverview(): Promise<OwnerOverview> {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [
    users,
    usersActive,
    usersNewToday,
    membershipsPending,
    membershipsActive,
    depositsAwaiting,
    withdrawalsInFlight,
    fraudOpen,
    securityWarnings24h,
    failedLogins24h,
    balanceSum,
    depositsApprovedSum,
    withdrawalsCompletedSum,
    recentDeposits,
    recentWithdrawals,
    recentAudit,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { status: "ACTIVE" } }),
    prisma.user.count({ where: { createdAt: { gte: startOfDay } } }),
    prisma.userProgram.count({ where: { status: "PENDING" } }),
    prisma.userProgram.count({ where: { status: "ACTIVE" } }),
    prisma.depositRequest.count({ where: { status: { in: ["PENDING", "UNDER_REVIEW"] } } }),
    prisma.withdrawalRequest.count({
      where: { status: { in: ["PENDING", "UNDER_REVIEW", "APPROVED", "PROCESSING"] } },
    }),
    prisma.fraudReview.count({ where: { status: "OPEN" } }),
    prisma.securityEvent.count({
      where: { createdAt: { gte: since24h }, severity: { in: ["WARNING", "CRITICAL"] } },
    }),
    prisma.securityEvent.count({
      where: { createdAt: { gte: since24h }, type: "LOGIN_FAILED" },
    }),
    prisma.balance.aggregate({
      _sum: {
        availableAmount: true,
        reservedAmount: true,
        pendingAmount: true,
        programFundsAmount: true,
        totalEarned: true,
      },
    }),
    prisma.depositRequest.aggregate({ where: { status: "APPROVED" }, _sum: { amount: true } }),
    prisma.withdrawalRequest.aggregate({
      where: { status: "COMPLETED" },
      _sum: { amount: true },
    }),
    listDepositsForAdmin({ take: 12 }),
    listWithdrawalsForAdmin({ take: 12 }),
    listOwnerAudit({ take: 12 }),
  ]);

  return {
    counts: {
      users,
      usersActive,
      usersNewToday,
      membershipsPending,
      membershipsActive,
      depositsAwaiting,
      withdrawalsInFlight,
      fraudOpen,
      securityWarnings24h,
      failedLogins24h,
    },
    sums: {
      available: money(balanceSum._sum.availableAmount),
      reserved: money(balanceSum._sum.reservedAmount),
      pending: money(balanceSum._sum.pendingAmount),
      programFunds: money(balanceSum._sum.programFundsAmount),
      totalEarned: money(balanceSum._sum.totalEarned),
      depositsApproved: money(depositsApprovedSum._sum.amount),
      withdrawalsCompleted: money(withdrawalsCompletedSum._sum.amount),
    },
    recentDeposits,
    recentWithdrawals,
    recentAudit: recentAudit.rows,
  };
}

/** Daftar anggota dengan saldo terkini; `search` mencocokkan nama/nama pengguna/surel/telepon. */
export async function listOwnerMembers(
  options: { search?: string; take?: number } = {},
): Promise<OwnerMemberRow[]> {
  const search = options.search?.trim();
  const rows = await prisma.user.findMany({
    where: search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { username: { contains: search, mode: "insensitive" } },
            { email: { contains: search, mode: "insensitive" } },
            { phone: { contains: search, mode: "insensitive" } },
          ],
        }
      : undefined,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: options.take ?? 200,
    select: {
      id: true,
      name: true,
      username: true,
      email: true,
      phone: true,
      status: true,
      role: true,
      adminRole: true,
      createdAt: true,
      lastLoginAt: true,
      profile: { select: { referralCode: true } },
      balance: {
        select: {
          currency: true,
          availableAmount: true,
          reservedAmount: true,
          pendingAmount: true,
          programFundsAmount: true,
          totalEarned: true,
        },
      },
      userPrograms: { orderBy: { joinedAt: "desc" }, take: 1, select: { status: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    username: row.username,
    email: row.email,
    phone: row.phone,
    status: row.status,
    role: row.role,
    adminRole: row.adminRole,
    createdAt: row.createdAt.toISOString(),
    lastLoginAt: iso(row.lastLoginAt),
    referralCode: row.profile?.referralCode ?? null,
    membershipStatus: row.userPrograms[0]?.status ?? null,
    balance: row.balance
      ? {
          currency: row.balance.currency,
          available: money(row.balance.availableAmount),
          reserved: money(row.balance.reservedAmount),
          pending: money(row.balance.pendingAmount),
          programFunds: money(row.balance.programFundsAmount),
          totalEarned: money(row.balance.totalEarned),
        }
      : { ...EMPTY_BALANCE },
  }));
}

/** Satu anggota selengkapnya: saldo, buku besar, sesi, peristiwa keamanan, dan antrean uangnya. */
export async function getOwnerMemberDetail(userId: string): Promise<OwnerMemberDetail | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      username: true,
      email: true,
      phone: true,
      bank: true,
      bankAccountNumber: true,
      status: true,
      role: true,
      adminRole: true,
      createdAt: true,
      lastLoginAt: true,
      registrationIp: true,
      emailVerifiedAt: true,
      profile: { select: { referralCode: true } },
      balance: {
        select: {
          currency: true,
          availableAmount: true,
          reservedAmount: true,
          pendingAmount: true,
          programFundsAmount: true,
          totalEarned: true,
        },
      },
      userPrograms: { orderBy: { joinedAt: "desc" }, take: 1, select: { status: true } },
      transactions: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 25,
        select: {
          id: true,
          createdAt: true,
          type: true,
          status: true,
          bucket: true,
          amount: true,
          currency: true,
          reference: true,
          description: true,
          balanceAfter: true,
        },
      },
      sessions: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 10,
        select: {
          id: true,
          createdAt: true,
          lastUsedAt: true,
          expiresAt: true,
          revokedAt: true,
          ipAddress: true,
          userAgent: true,
          totpVerifiedAt: true,
        },
      },
      securityEvents: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 15,
        select: {
          id: true,
          createdAt: true,
          type: true,
          severity: true,
          description: true,
          ipAddress: true,
        },
      },
    },
  });

  if (!user) return null;

  const [deposits, withdrawals] = await Promise.all([
    listDepositsForAdmin({ search: user.username, take: 15 }),
    listWithdrawalsForAdmin({ search: user.username, take: 15 }),
  ]);

  return {
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    phone: user.phone,
    bank: user.bank,
    bankAccountNumber: user.bankAccountNumber,
    status: user.status,
    role: user.role,
    adminRole: user.adminRole,
    createdAt: user.createdAt.toISOString(),
    lastLoginAt: iso(user.lastLoginAt),
    registrationIp: user.registrationIp,
    emailVerifiedAt: iso(user.emailVerifiedAt),
    referralCode: user.profile?.referralCode ?? null,
    membershipStatus: user.userPrograms[0]?.status ?? null,
    balance: user.balance
      ? {
          currency: user.balance.currency,
          available: money(user.balance.availableAmount),
          reserved: money(user.balance.reservedAmount),
          pending: money(user.balance.pendingAmount),
          programFunds: money(user.balance.programFundsAmount),
          totalEarned: money(user.balance.totalEarned),
        }
      : { ...EMPTY_BALANCE },
    transactions: user.transactions.map((row) => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      type: row.type,
      status: row.status,
      bucket: row.bucket,
      amount: money(row.amount),
      currency: row.currency,
      reference: row.reference,
      description: row.description,
      balanceAfter: money(row.balanceAfter),
    })),
    sessions: user.sessions.map((row) => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: iso(row.lastUsedAt),
      expiresAt: row.expiresAt.toISOString(),
      revokedAt: iso(row.revokedAt),
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      totpVerifiedAt: iso(row.totpVerifiedAt),
    })),
    securityEvents: user.securityEvents.map((row) => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      type: row.type,
      severity: row.severity,
      description: row.description,
      ipAddress: row.ipAddress,
    })),
    deposits,
    withdrawals,
  };
}

export interface OwnerAuditQuery {
  entityType?: string;
  action?: string;
  actor?: string;
  take?: number;
  skip?: number;
}

export interface OwnerAuditPage {
  rows: OwnerAuditRow[];
  total: number;
}

/** Jejak audit dengan saringan sederhana; total dihitung untuk penomoran halaman. */
export async function listOwnerAudit(query: OwnerAuditQuery = {}): Promise<OwnerAuditPage> {
  const take = Math.min(Math.max(query.take ?? 50, 1), 200);
  const skip = Math.max(query.skip ?? 0, 0);
  const action = query.action?.trim();
  const entityType = query.entityType?.trim();
  const actor = query.actor?.trim();

  const where: Prisma.AuditLogWhereInput = {
    ...(entityType ? { entityType } : {}),
    ...(action ? { action: { contains: action, mode: "insensitive" } } : {}),
    ...(actor
      ? {
          actor: {
            OR: [
              { username: { contains: actor, mode: "insensitive" } },
              { email: { contains: actor, mode: "insensitive" } },
            ],
          },
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take,
      skip,
      select: {
        id: true,
        createdAt: true,
        action: true,
        entityType: true,
        entityId: true,
        actorUserId: true,
        ipAddress: true,
        before: true,
        after: true,
        actor: { select: { username: true } },
      },
    }),
    prisma.auditLog.count({ where }),
  ]);

  return {
    total,
    rows: rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      actorUserId: row.actorUserId,
      actorUsername: row.actor?.username ?? null,
      ipAddress: row.ipAddress,
      before: row.before,
      after: row.after,
    })),
  };
}
