import { Receipt } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PaymentKpis, PaymentShell } from "@/components/payments/payment-shell";
import { TransactionHistory } from "@/components/dashboard/transaction-history";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/current-user";
import { formatMoney } from "@/lib/money";
import { getBalance, listTransactions } from "@/lib/services/ledger-service";

export const metadata: Metadata = {
  title: "Transaksi",
  description:
    "Buku besar akun Tatorprofit Anda: seluruh entri transaksi append-only dalam USDT beserta efek saldo dan nomor referensinya.",
};

export const dynamic = "force-dynamic";

export default async function TransactionsPage() {
  const user = await requireUser("/transactions");

  const [balance, transactions] = await Promise.all([
    getBalance(user.id),
    listTransactions(user.id, 200),
  ]);

  const rows = transactions.map((row) => ({
    id: row.id,
    type: row.type,
    status: row.status,
    bucket: row.bucket,
    amount: row.amount.toFixed(2),
    currency: row.currency,
    balanceAfter: row.balanceAfter.toFixed(2),
    reference: row.reference,
    description: row.description,
    postedAt: row.postedAt,
    createdAt: row.createdAt,
  }));

  return (
    <PaymentShell
      active="/transactions"
      isAdmin={user.role === "ADMIN"}
      title="Riwayat transaksi"
      description="Semua perubahan saldo berasal dari entri buku besar. Buku besar bersifat append-only: baris tidak pernah diubah atau dihapus, dan koreksi dicatat sebagai entri penyesuaian baru."
    >
      <PaymentKpis
        items={[
          {
            label: "Saldo tersedia",
            value: formatMoney(balance.availableAmount, balance.currency),
            hint: "Dapat dipakai untuk penarikan",
          },
          {
            label: "Menunggu persetujuan",
            value: formatMoney(balance.pendingAmount, balance.currency),
            hint: "Imbalan belum dibayar",
          },
          {
            label: "Dana program",
            value: formatMoney(balance.programFundsAmount, balance.currency),
            hint: "Dana gabung yang dikonfirmasi admin",
            tone: "gold",
          },
          {
            label: "Saldo ditahan",
            value: formatMoney(balance.reservedAmount, balance.currency),
            hint: "Diklaim penarikan yang belum selesai",
            tone: "gold",
          },
        ]}
      />

      <Alert variant="info" title="Cara membaca tabel ini">
        Kolom &quot;Efek saldo&quot; adalah nilai entri ledger, sedangkan &quot;Pos saldo&quot;
        adalah saldo setelah entri tersebut tercatat. Nomor referensi membuat setiap baris dapat
        ditelusuri ke peristiwa yang menghasilkannya.
      </Alert>

      <TransactionHistory transactions={rows} />

      <section className="flex flex-wrap gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <Button asChild variant="gold" size="sm">
          <Link href="/deposit">
            <Receipt aria-hidden />
            Setor dana manual
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href="/withdrawal">Ajukan penarikan</Link>
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link href="/rewards">Lihat imbalan</Link>
        </Button>
      </section>
    </PaymentShell>
  );
}
