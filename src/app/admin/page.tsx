import { ShieldCheck } from "lucide-react";
import type { Metadata } from "next";

import { AdminAuditTrail } from "@/components/payments/admin-audit-trail";
import { AdminDepositReview } from "@/components/payments/admin-deposit-review";
import { AdminWithdrawalReview } from "@/components/payments/admin-withdrawal-review";
import { PaymentKpis, PaymentShell } from "@/components/payments/payment-shell";
import {
  DEPOSIT_REVIEW_ACTION_VALUES,
  WITHDRAWAL_REVIEW_ACTION_VALUES,
} from "@/components/payments/review-actions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { canAdmin, canReviewDepositAction } from "@/lib/auth/admin-permissions";
import { requireAdminCapability } from "@/lib/auth/current-user";
import { formatMoney } from "@/lib/money";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Administrasi" };

const ADMIN_ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  FINANCE: "Keuangan",
  SUPPORT: "Dukungan",
  COMPLIANCE: "Kepatuhan",
  VIEWER: "Pengamat",
};

export default async function AdminPage() {
  const admin = await requireAdminCapability("read");
  const canReviewWithdrawal = canAdmin(admin.adminRole, "reviewWithdrawal");

  /**
   * Capabilities are decided on the server, per action: FINANCE/SUPER_ADMIN may
   * run every review step, COMPLIANCE may only start/flag a deposit, and any
   * other role receives an empty list (the dialog then renders read-only).
   */
  const allowedDepositActions = DEPOSIT_REVIEW_ACTION_VALUES.filter((action) =>
    canReviewDepositAction(admin.adminRole, action),
  );
  const allowedWithdrawalActions: string[] = canReviewWithdrawal
    ? [...WITHDRAWAL_REVIEW_ACTION_VALUES]
    : [];

  const [
    usersActive,
    programsActive,
    membershipsPending,
    depositsPending,
    withdrawalsPending,
    rewardsTotal,
    commissionsTotal,
    depositsFlagged,
    withdrawalsRejected,
    approvedDepositSum,
    completedWithdrawalSum,
    deposits,
    withdrawals,
    auditRows,
    requestAuditEntries,
  ] = await Promise.all([
    prisma.user.count({ where: { status: "ACTIVE" } }),
    prisma.userProgram.count({ where: { status: "ACTIVE" } }),
    prisma.userProgram.count({ where: { status: "PENDING" } }),
    prisma.depositRequest.count({ where: { status: { in: ["PENDING", "UNDER_REVIEW"] } } }),
    prisma.withdrawalRequest.count({
      where: { status: { in: ["PENDING", "UNDER_REVIEW", "APPROVED", "PROCESSING"] } },
    }),
    prisma.reward.count(),
    prisma.referralCommission.count(),
    prisma.depositRequest.count({ where: { status: "FLAGGED" } }),
    prisma.withdrawalRequest.count({ where: { status: "REJECTED" } }),
    prisma.depositRequest.aggregate({ where: { status: "APPROVED" }, _sum: { amount: true } }),
    prisma.withdrawalRequest.aggregate({
      where: { status: "COMPLETED" },
      _sum: { amount: true },
    }),
    prisma.depositRequest.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        user: { select: { name: true, username: true, email: true } },
        userProgram: { include: { tier: true, program: true } },
      },
    }),
    prisma.withdrawalRequest.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        user: { select: { name: true, username: true, email: true, balance: true } },
      },
    }),
    prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { actor: { select: { username: true, name: true } } },
    }),
    prisma.auditLog.findMany({
      where: { entityType: { in: ["DepositRequest", "WithdrawalRequest"] } },
      orderBy: { createdAt: "desc" },
      take: 1000,
      select: {
        id: true,
        entityId: true,
        action: true,
        createdAt: true,
        actor: { select: { username: true } },
      },
    }),
  ]);

  /** Audit trail grouped by request id, so each review dialog can show its own history. */
  const requestAuditByEntityId = new Map<
    string,
    { id: string; action: string; actorUsername: string | null; createdAt: Date }[]
  >();
  for (const entry of requestAuditEntries) {
    if (!entry.entityId) continue;
    const list = requestAuditByEntityId.get(entry.entityId) ?? [];
    list.push({
      id: entry.id,
      action: entry.action,
      actorUsername: entry.actor?.username ?? null,
      createdAt: entry.createdAt,
    });
    requestAuditByEntityId.set(entry.entityId, list);
  }


  return (
    <PaymentShell
      active="/admin"
      isAdmin
      title="Administrasi keuangan"
      description="Tinjau deposit dan penarikan manual, pantau indikator nyata dari database, dan periksa jejak audit. Setiap tindakan tercatat dengan aktor dan waktu."
    >
      <section className="flex flex-wrap items-center gap-2">
        <Badge variant="gold">
          <ShieldCheck className="size-3.5" aria-hidden />
          {admin.adminRole ? ADMIN_ROLE_LABELS[admin.adminRole] ?? admin.adminRole : "Tanpa peran"}
        </Badge>
        <Badge variant={allowedDepositActions.length > 0 ? "default" : "muted"}>
          {allowedDepositActions.length === 4
            ? "Dapat meninjau deposit"
            : allowedDepositActions.length > 0
              ? "Deposit: tinjau & tandai saja"
              : "Deposit hanya baca"}
        </Badge>
        <Badge variant={canReviewWithdrawal ? "default" : "muted"}>
          {canReviewWithdrawal ? "Dapat meninjau penarikan" : "Penarikan hanya baca"}
        </Badge>
        <Badge variant="muted">@{admin.username}</Badge>
      </section>

      <PaymentKpis
        label="Indikator administrasi"
        items={[
          { label: "Pengguna aktif", value: String(usersActive) },
          { label: "Program aktif", value: String(programsActive) },
          { label: "Keanggotaan menunggu", value: String(membershipsPending), tone: "gold" },
          {
            label: "Deposit menunggu tinjauan",
            value: String(depositsPending),
            tone: "gold",
            hint: "Status menunggu atau sedang ditinjau",
          },
          {
            label: "Penarikan berjalan",
            value: String(withdrawalsPending),
            tone: "gold",
            hint: "Menunggu, ditinjau, disetujui, atau diproses",
          },
          { label: "Imbalan tercatat", value: String(rewardsTotal) },
          { label: "Komisi rujukan", value: String(commissionsTotal) },
          {
            label: "Ditandai / ditolak",
            value: String(depositsFlagged + withdrawalsRejected),
            tone: "danger",
            hint: `${depositsFlagged} deposit ditandai · ${withdrawalsRejected} penarikan ditolak`,
          },
        ]}
      />

      <PaymentKpis
        label="Nilai terkonfirmasi"
        columns={2}
        items={[
          {
            label: "Total deposit disetujui",
            value: formatMoney(approvedDepositSum._sum.amount ?? 0),
          },
          {
            label: "Total penarikan selesai",
            value: formatMoney(completedWithdrawalSum._sum.amount ?? 0),
            tone: "gold",
          },
        ]}
      />


      <Card id="deposit">
        <CardHeader>
          <CardTitle>Tinjauan deposit</CardTitle>
          <CardDescription>
            Setujui deposit untuk mengaktifkan keanggotaan dan mencatat dana program. Tindakan
            penolakan dan penandaan mewajibkan alasan.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AdminDepositReview
            allowedActions={allowedDepositActions}
            rows={deposits.map((row) => ({
              id: row.id,
              amount: row.amount.toFixed(2),
              currency: row.currency,
              paymentMethod: row.paymentMethod,
              paymentReference: row.paymentReference,
              status: row.status,
              rejectionReason: row.rejectionReason,
              reviewNote: row.reviewNote,
              flaggedReason: row.flaggedReason,
              proofFileName: row.proofFileName,
              proofMimeType: row.proofMimeType,
              proofSize: row.proofSize,
              userName: row.user.name,
              userUsername: row.user.username,
              userEmail: row.user.email,
              tierCode: row.userProgram.tier.code,
              programName: row.userProgram.program.name,
              membershipStatus: row.userProgram.status,
              createdAt: row.createdAt,
              reviewedAt: row.reviewedAt,
              auditHistory: requestAuditByEntityId.get(row.id) ?? [],
            }))}
          />
        </CardContent>
      </Card>

      <Card id="penarikan">
        <CardHeader>
          <CardTitle>Tinjauan penarikan</CardTitle>
          <CardDescription>
            Setujui, mulai proses transfer, tandai selesai, atau tolak permintaan penarikan. Dana
            ditahan dari saldo tersedia sampai status akhir.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AdminWithdrawalReview
            allowedActions={allowedWithdrawalActions}
            rows={withdrawals.map((row) => ({
              id: row.id,
              amount: row.amount.toFixed(2),
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
              auditHistory: requestAuditByEntityId.get(row.id) ?? [],
            }))}
          />
        </CardContent>
      </Card>


      <Card id="audit">
        <CardHeader>
          <CardTitle>Jejak audit</CardTitle>
          <CardDescription>
            50 catatan audit terbaru dari database: aktor, aksi, entitas, alamat IP, dan snapshot
            sebelum/sesudah.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AdminAuditTrail
            rows={auditRows.map((row) => ({
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
            }))}
          />
        </CardContent>
      </Card>
    </PaymentShell>
  );
}
