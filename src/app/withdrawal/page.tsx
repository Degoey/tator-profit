import { Download } from "lucide-react";
import type { Metadata } from "next";

import { PaymentKpis, PaymentShell } from "@/components/payments/payment-shell";
import { WithdrawalForm } from "@/components/payments/withdrawal-form";
import { WithdrawalHistory } from "@/components/payments/withdrawal-history";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/current-user";
import { formatMoney } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { withdrawalAmounts } from "@/lib/withdrawal-fee";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Penarikan",
  description:
    "Ajukan penarikan saldo tersedia dan pantau proses transfer manual dari admin Tatorprofit.",
};

/** Statuses that keep a withdrawal request open (only one open request per account). */
const OPEN_WITHDRAWAL_STATUSES = ["PENDING", "UNDER_REVIEW", "APPROVED", "PROCESSING"];

export default async function WithdrawalPage() {
  const user = await requireUser("/withdrawal");

  const [balance, history] = await Promise.all([
    prisma.balance.findUnique({ where: { userId: user.id } }),
    prisma.withdrawalRequest.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
  ]);

  const currency = balance?.currency ?? user.balance.currency;
  const availableAmount = (balance?.availableAmount ?? 0).toFixed(2);
  const openRequests = history.filter((row) => OPEN_WITHDRAWAL_STATUSES.includes(row.status));

  return (
    <PaymentShell
      active="/withdrawal"
      isAdmin={user.role === "ADMIN"}
      title="Penarikan saldo"
      description="Ajukan pencairan dari saldo tersedia. Dana ditahan saat pengajuan dan transfer diproses manual oleh admin."
    >
      <PaymentKpis
        label="Ringkasan penarikan"
        items={[
          { label: "Saldo tersedia", value: formatMoney(availableAmount, currency) },
          {
            label: "Dana tertahan",
            value: formatMoney(balance?.reservedAmount ?? 0, currency),
            tone: "gold",
            hint: "Dana penarikan yang sedang berjalan",
          },
          { label: "Permintaan terbuka", value: String(openRequests.length), tone: "gold" },
          {
            label: "Penarikan selesai",
            value: String(history.filter((row) => row.status === "COMPLETED").length),
          },
        ]}
      />

      {openRequests.length > 0 ? (
        <Alert variant="warning" title="Penarikan masih berjalan">
          Satu permintaan penarikan masih terbuka. Tunggu sampai selesai atau ditolak sebelum
          mengajukan penarikan baru.
        </Alert>
      ) : (
        <WithdrawalForm availableAmount={availableAmount} currency={currency} />
      )}

      <Card>
        <CardHeader>
          <CardTitle>Riwayat penarikan</CardTitle>
          <p className="text-xs text-white/45">200 pengajuan terbaru · waktu UTC</p>
          <div className="mt-3">
            <Button asChild variant="outline" size="sm">
              <a href="/api/withdrawals/export">
                <Download aria-hidden />
                Unduh rekap CSV
              </a>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <WithdrawalHistory
            rows={history.map((row) => {
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
                proofFileName: row.proofFileName,
                proofMimeType: row.proofMimeType,
                proofSize: row.proofSize,
                createdAt: row.createdAt,
                reviewedAt: row.reviewedAt,
                processedAt: row.processedAt,
                completedAt: row.completedAt,
              };
            })}
          />
        </CardContent>
      </Card>

      <Alert variant="warning" title="Ketentuan program">
        Setiap penarikan dikenakan biaya 10% dari nominal penarikan. Jumlah yang diterima adalah
        nominal penarikan setelah dikurangi biaya. Penarikan diproses manual dan saldo yang tertahan
        tidak dapat dipakai untuk permintaan lain sampai statusnya selesai atau ditolak.
      </Alert>
    </PaymentShell>
  );
}
