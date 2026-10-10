import { Download, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";

import { AdminAuditTrail } from "@/components/payments/admin-audit-trail";
import { AdminCreditForm, CreditPermissionNote } from "@/components/payments/admin-credit-form";
import { AdminDepositReview } from "@/components/payments/admin-deposit-review";
import { AdminRoleManager } from "@/components/payments/admin-role-manager";
import { AdminWithdrawalReview } from "@/components/payments/admin-withdrawal-review";
import { PaymentKpis, PaymentShell } from "@/components/payments/payment-shell";
import {
  DEPOSIT_REVIEW_ACTION_VALUES,
  WITHDRAWAL_REVIEW_ACTION_VALUES,
} from "@/components/payments/review-actions";
import { InstallAppButton } from "@/components/pwa/install-app-button";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { canAdmin, canReviewDepositAction } from "@/lib/auth/admin-permissions";
import { requireAdminCapability } from "@/lib/auth/current-user";
import { formatMoney } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { listAdministrators } from "@/lib/services/admin-role-service";
import { withdrawalAmounts } from "@/lib/withdrawal-fee";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Administrasi" };

const ADMIN_ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  FINANCE: "Keuangan",
  SUPPORT: "Dukungan",
  COMPLIANCE: "Kepatuhan",
  VIEWER: "Pengamat",
};

/** Reads one string field out of a stored JSON payload without trusting its shape. */
function metaString(metadata: unknown, key: string): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

export default async function AdminPage() {
  const admin = await requireAdminCapability("read");
  const canReviewWithdrawal = canAdmin(admin.adminRole, "reviewWithdrawal");
  /**
   * Credit and audit are separate capabilities, decided here on the server: the
   * UI only mirrors what this page is allowed to load and render.
   */
  const canCredit = canAdmin(admin.adminRole, "creditBalance");
  const canReadAudit = canAdmin(admin.adminRole, "readAudit");
  /** Role administration is SUPER_ADMIN only; other roles never load the list. */
  const canManageUsers = canAdmin(admin.adminRole, "manageUsers");

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
  ] = await Promise.all([
    prisma.user.count({ where: { status: "ACTIVE" } }),
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
  ]);

  /**
   * The audit trail is limited to SUPER_ADMIN, FINANCE and COMPLIANCE: a role
   * without `readAudit` never loads the rows, so nothing leaks through the server
   * rendered payload either.
   */
  const auditRows = canReadAudit
    ? await prisma.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { actor: { select: { username: true, name: true } } },
      })
    : [];

  /**
   * Administrator accounts are only loaded for a SUPER_ADMIN; every other role
   * receives an empty list, so the capability cannot be exercised through the UI
   * and the rows never reach the server rendered payload.
   */
  const administrators = canManageUsers ? await listAdministrators() : [];
  const requestAuditEntries = canReadAudit
    ? await prisma.auditLog.findMany({
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
      })
    : [];

  /**
   * Remaining dashboard counters (Tahap 2). Every number below is a real
   * database aggregate; the credit history is only loaded for a role that may
   * credit balances.
   */
  const [
    totalUsers,
    programsActiveCount,
    membershipsActive,
    rewardsPaidSum,
    commissionsPaidSum,
    adminActivityRows,
    creditsCount,
    creditsSum,
    adminCredits,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.program.count({ where: { status: "ACTIVE" } }),
    prisma.userProgram.count({ where: { status: "ACTIVE" } }),
    prisma.reward.aggregate({ where: { status: "PAID" }, _sum: { amount: true } }),
    prisma.referralCommission.aggregate({
      where: { status: "PAID" },
      _sum: { commissionAmount: true },
    }),
    // "Aktivitas admin 24 jam" dihitung oleh database (NOW() - 24 jam) sehingga
    // komponen server tidak perlu memanggil fungsi waktu yang tidak murni.
    prisma.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
      FROM "AuditLog"
      WHERE "actorUserId" IS NOT NULL
        AND "createdAt" >= NOW() - INTERVAL '24 hours'
    `,
    prisma.transaction.count({ where: { type: "ADMIN_CREDIT" } }),
    prisma.transaction.aggregate({ where: { type: "ADMIN_CREDIT" }, _sum: { amount: true } }),
    canCredit
      ? prisma.transaction.findMany({
          where: { type: "ADMIN_CREDIT" },
          orderBy: { createdAt: "desc" },
          take: 100,
          select: {
            id: true,
            amount: true,
            currency: true,
            balanceBefore: true,
            balanceAfter: true,
            createdAt: true,
            metadata: true,
            user: { select: { name: true, username: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  const adminActivity = adminActivityRows[0]?.count ?? 0;

  const creditRows = adminCredits.map((row) => ({
    id: row.id,
    reference: metaString(row.metadata, "externalReference") ?? "—",
    amount: row.amount.toFixed(2),
    currency: row.currency,
    reason: metaString(row.metadata, "reason") ?? "—",
    actorUsername: metaString(row.metadata, "actorUsername"),
    targetName: row.user.name,
    targetUsername: row.user.username,
    balanceBefore: row.balanceBefore.toFixed(2),
    balanceAfter: row.balanceAfter.toFixed(2),
    creditedAt: row.createdAt,
  }));


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
        <CreditPermissionNote allowed={canCredit} />
        <Badge variant={canReadAudit ? "default" : "muted"}>
          {canReadAudit ? "Dapat membaca jejak audit" : "Jejak audit tidak tersedia"}
        </Badge>
        <Badge variant="muted">@{admin.username}</Badge>
        {/*
          Offers the installable app to an administrator only, because the
          manifest start_url is `/admin`. No capability is granted here: the
          installed window authenticates with the same cookie and the same
          server-side permission checks.
        */}
        <InstallAppButton />
      </section>

      <PaymentKpis
        label="Indikator administrasi"
        items={[
          { label: "Total pengguna", value: String(totalUsers) },
          { label: "Pengguna aktif", value: String(usersActive) },
          {
            label: "Program aktif",
            value: String(programsActiveCount),
            hint: "Program berstatus aktif di database",
          },
          {
            label: "Keanggotaan aktif",
            value: String(membershipsActive),
            hint: `${membershipsPending} keanggotaan menunggu konfirmasi dana`,
          },
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
          {
            label: "Imbalan tercatat",
            value: String(rewardsTotal),
            hint: `Dibayar ${formatMoney(rewardsPaidSum._sum.amount ?? 0)}`,
          },
          {
            label: "Komisi rujukan",
            value: String(commissionsTotal),
            hint: `Dibayar ${formatMoney(commissionsPaidSum._sum.commissionAmount ?? 0)}`,
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


      <PaymentKpis
        label="Kepatuhan dan aktivitas"
        columns={3}
        items={[
          {
            label: "Transaksi mencurigakan",
            value: String(depositsFlagged + withdrawalsRejected),
            tone: "danger",
            hint: `${depositsFlagged} deposit ditandai · ${withdrawalsRejected} penarikan ditolak`,
          },
          {
            label: "Aktivitas admin 24 jam",
            value: String(adminActivity),
            hint: "Catatan audit dengan aktor administrator",
          },
          {
            label: "Kredit saldo admin",
            value: formatMoney(creditsSum._sum.amount ?? 0),
            tone: "gold",
            hint: `${creditsCount} entri ledger ADMIN_CREDIT`,
          },
        ]}
      />

      <Card id="kredit">
        <CardHeader>
          <CardTitle>Kredit saldo administrator</CardTitle>
          <CardDescription>
            Kredit saldo yang eksplisit dan tercatat. Hanya SUPER_ADMIN dan FINANCE yang dapat memberi
            kredit; setiap kredit menulis entri ledger ADMIN_CREDIT, jejak audit, dan notifikasi dalam
            satu transaksi database. Nomor referensi berfungsi sebagai kunci idempotensi sehingga
            kredit tidak pernah berulang.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AdminCreditForm
            canCredit={canCredit}
            adminUsername={admin.username}
            currency="USDT"
            rows={creditRows}
          />
        </CardContent>
      </Card>

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
            ditahan dari saldo tersedia sampai status akhir. Saat menandai selesai Anda dapat
            melampirkan bukti transfer, dan pengguna menerima 90% (biaya 10%).
          </CardDescription>
          <div className="mt-3">
            <Button asChild variant="outline" size="sm">
              <a href="/api/withdrawals/export?scope=admin">
                <Download aria-hidden />
                Ekspor rekap CSV
              </a>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <AdminWithdrawalReview
            allowedActions={allowedWithdrawalActions}
            rows={withdrawals.map((row) => {
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
                auditHistory: requestAuditByEntityId.get(row.id) ?? [],
              };
            })}
          />
        </CardContent>
      </Card>


      <Card id="audit">
        <CardHeader>
          <CardTitle>Jejak audit</CardTitle>
          <CardDescription>
            {canReadAudit
              ? "50 catatan audit terbaru dari database: aktor, aksi, entitas, alamat IP, dan snapshot sebelum/sesudah."
              : "Jejak audit hanya tersedia untuk peran SUPER_ADMIN, FINANCE, dan COMPLIANCE."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {canReadAudit ? (
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
          ) : (
            <Alert variant="warning" title="Akses terbatas">
              Peran Anda tidak diizinkan membaca jejak audit. Hubungi SUPER_ADMIN bila catatan ini
              diperlukan untuk tugas Anda.
            </Alert>
          )}
        </CardContent>
      </Card>
      {canManageUsers ? (
        <AdminRoleManager
          administrators={administrators.map((row) => ({
            id: row.id,
            username: row.username,
            name: row.name,
            email: row.email,
            status: row.status,
            adminRole: row.adminRole,
            createdAt: row.createdAt,
          }))}
        />
      ) : null}
    </PaymentShell>
  );
}
