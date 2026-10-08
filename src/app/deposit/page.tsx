import type { Metadata } from "next";

import { DepositForm } from "@/components/payments/deposit-form";
import { DepositHistory } from "@/components/payments/deposit-history";
import { PaymentKpis, PaymentShell } from "@/components/payments/payment-shell";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Deposit",
  description:
    "Kirim bukti pembayaran untuk keanggotaan program yang menunggu, dan pantau status verifikasi admin.",
};

/** Deposit statuses that keep the membership occupied (only one open deposit per membership). */
const OPEN_DEPOSIT_STATUSES = ["PENDING", "UNDER_REVIEW", "FLAGGED"];

export default async function DepositPage() {
  const user = await requireUser("/deposit");

  const [memberships, history] = await Promise.all([
    prisma.userProgram.findMany({
      where: { userId: user.id, status: "PENDING" },
      orderBy: { joinedAt: "desc" },
      include: { tier: true, program: true },
    }),
    prisma.depositRequest.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { userProgram: { include: { tier: true, program: true } } },
    }),
  ]);

  const openDeposits = history.filter((row) => OPEN_DEPOSIT_STATUSES.includes(row.status));
  const blockedMembershipIds = new Set(openDeposits.map((row) => row.userProgramId));
  const selectableMemberships = memberships.filter((row) => !blockedMembershipIds.has(row.id));

  return (
    <PaymentShell
      active="/deposit"
      isAdmin={user.role === "ADMIN"}
      title="Deposit program"
      description="Gabung paket terlebih dahulu, lalu kirim bukti pembayaran untuk verifikasi manual admin. Deposit bukan penambahan saldo penarikan."
    >
      <PaymentKpis
        label="Ringkasan deposit"
        items={[
          { label: "Keanggotaan menunggu", value: String(memberships.length) },
          { label: "Deposit terbuka", value: String(openDeposits.length), tone: "gold" },
          {
            label: "Disetujui",
            value: String(history.filter((row) => row.status === "APPROVED").length),
          },
          {
            label: "Ditandai",
            value: String(history.filter((row) => row.status === "FLAGGED").length),
            tone: "danger",
          },
        ]}
      />

      {openDeposits.length > 0 ? (
        <Alert variant="info" title="Deposit masih berjalan">
          Keanggotaan dengan deposit terbuka tidak dapat menerima pengajuan kedua. Tunggu verifikasi
          admin; riwayat dan catatan tersedia di bawah.
        </Alert>
      ) : null}

      <DepositForm
        currency={user.balance.currency}
        allBlocked={memberships.length > 0 && selectableMemberships.length === 0}
        memberships={selectableMemberships.map((row) => ({
          id: row.id,
          tierName: row.tier.name,
          tierCode: row.tier.code,
          programName: row.program.name,
          joinAmount: row.joinAmount.toFixed(2),
          currency: row.currency,
          cycleWeeks: row.cycleWeeks,
        }))}
      />

      <Card>
        <CardHeader>
          <CardTitle>Riwayat deposit</CardTitle>
          <p className="text-xs text-white/45">200 pengajuan terbaru · waktu UTC</p>
        </CardHeader>
        <CardContent>
          <DepositHistory
            rows={history.map((row) => ({
              id: row.id,
              amount: row.amount.toFixed(2),
              currency: row.currency,
              paymentMethod: row.paymentMethod,
              paymentReference: row.paymentReference,
              status: row.status,
              rejectionReason: row.rejectionReason,
              reviewNote: row.reviewNote,
              flaggedReason: row.flaggedReason,
              tierCode: row.userProgram.tier.code,
              programName: row.userProgram.program.name,
              hasProof: Boolean(row.proofStorageKey),
              createdAt: row.createdAt,
              reviewedAt: row.reviewedAt,
            }))}
          />
        </CardContent>
      </Card>

      <Alert variant="warning" title="Ketentuan program">
        Imbalan mengikuti ketentuan, kualifikasi, dan aturan yang berlaku. Pengajuan deposit tidak
        otomatis mengaktifkan keanggotaan.
      </Alert>
    </PaymentShell>
  );
}
