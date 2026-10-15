import Link from "next/link";
import type { Metadata } from "next";

import { OwnerReviewPanel, type OwnerPaymentRow } from "@/components/owner/owner-review-panel";
import { OwnerShell } from "@/components/owner/owner-shell";
import { PaymentKpis } from "@/components/payments/payment-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOwnerPage } from "@/lib/auth/owner-guard";
import { formatMoney } from "@/lib/money";
import { ownerOverview } from "@/lib/services/owner-console-service";
import { statusLabel } from "@/lib/status-labels";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Konsol Pemilik" };

/**
 * Ringkasan pemilik: angka nyata dari database, antrean uang yang menunggu
 * keputusan, dan jejak audit terakhir. Setiap tindakan uang tetap melewati
 * konfirmasi eksplisit dan dijalankan layanan yang sama seperti panel
 * administrasi, sehingga aturan ledger tidak bercabang dua.
 */
export default async function OwnerDashboardPage() {
  const owner = await requireOwnerPage("/owner");
  const overview = await ownerOverview();

  const depositRows: OwnerPaymentRow[] = overview.recentDeposits.map((row) => ({
    id: row.id,
    status: row.status,
    amount: row.amount,
    currency: row.currency,
    username: row.username,
    userEmail: row.userEmail,
    createdAt: row.createdAt,
    reference: row.paymentReference,
    detail: `${row.paymentMethod} · keanggotaan ${statusLabel(row.membershipStatus)}`,
    note: row.flaggedReason ?? row.rejectionReason,
  }));

  const withdrawalRows: OwnerPaymentRow[] = overview.recentWithdrawals.map((row) => ({
    id: row.id,
    status: row.status,
    amount: row.amount,
    currency: row.currency,
    username: row.username,
    userEmail: row.userEmail,
    createdAt: row.createdAt,
    reference: row.reservedReference ?? `WD-${row.id.slice(0, 8)}`,
    detail: `${row.method} → ${row.destination} · biaya ${formatMoney(row.fee, row.currency)} · netto ${formatMoney(row.netAmount, row.currency)}`,
    note: row.rejectionReason ?? row.notes,
  }));

  return (
    <OwnerShell
      active="/owner"
      title="Ringkasan pemilik"
      description="Seluruh angka di halaman ini adalah agregat langsung dari database produksi. Antrean uang di bawah dapat ditinjau dari sini, dengan konfirmasi eksplisit dan jejak audit untuk setiap tindakan."
      ownerLabel={`@${owner.username}`}
    >
      <section className="flex flex-wrap items-center gap-2">
        <Badge variant="gold">Pemilik</Badge>
        <Badge variant="muted">@{owner.username}</Badge>
        <Badge variant="muted">{owner.email}</Badge>
        <Link
          href="/admin"
          className="text-xs font-semibold text-[var(--color-neon)] underline-offset-4 hover:underline"
        >
          Buka panel administrasi lengkap
        </Link>
      </section>

      <PaymentKpis
        label="Uang di platform"
        items={[
          {
            label: "Saldo tersedia anggota",
            value: formatMoney(overview.sums.available),
            hint: "Jumlah bucket AVAILABLE seluruh anggota",
          },
          {
            label: "Dana tercadang",
            value: formatMoney(overview.sums.reserved),
            tone: "gold",
            hint: "Penarikan berjalan yang sudah mengunci saldo",
          },
          {
            label: "Dana program",
            value: formatMoney(overview.sums.programFunds),
            hint: "Setoran yang sudah disetujui",
          },
          {
            label: "Total imbalan tercatat",
            value: formatMoney(overview.sums.totalEarned),
            hint: "Akumulasi imbalan yang pernah dibukukan",
          },
        ]}
      />

      <PaymentKpis
        label="Antrean yang menunggu keputusan"
        columns={3}
        items={[
          {
            label: "Setoran menunggu",
            value: String(overview.counts.depositsAwaiting),
            tone: "gold",
            hint: "Status menunggu atau sedang ditinjau",
          },
          {
            label: "Penarikan berjalan",
            value: String(overview.counts.withdrawalsInFlight),
            tone: "gold",
            hint: "Menunggu sampai diproses",
          },
          {
            label: "Kasus anti-fraud terbuka",
            value: String(overview.counts.fraudOpen),
            tone: overview.counts.fraudOpen > 0 ? "danger" : "default",
            hint: "Sinyal multi-akun yang belum ditutup",
          },
        ]}
      />

      <PaymentKpis
        label="Perhatian keamanan"
        columns={4}
        items={[
          {
            label: "Peringatan keamanan 24 jam",
            value: String(overview.counts.securityWarnings24h),
            tone: overview.counts.securityWarnings24h > 0 ? "gold" : "default",
            hint: "Peristiwa WARNING/CRITICAL",
          },
          {
            label: "Login gagal 24 jam",
            value: String(overview.counts.failedLogins24h),
            tone: overview.counts.failedLogins24h > 0 ? "gold" : "default",
            hint: "Termasuk percobaan kode 2FA yang salah",
          },
          {
            label: "Total pengguna",
            value: String(overview.counts.users),
            hint: `${overview.counts.usersActive} berstatus aktif`,
          },
          {
            label: "Pendaftar hari ini",
            value: String(overview.counts.usersNewToday),
            hint: `${overview.counts.membershipsActive} keanggotaan aktif · ${overview.counts.membershipsPending} menunggu`,
          },
        ]}
      />

      <Card>
        <CardHeader>
          <CardTitle>Antrean setoran</CardTitle>
          <CardDescription>
            Menyetujui setoran mengaktifkan keanggotaan, membuat imbalan periode pertama, dan
            menghitung komisi rujukan dalam satu transaksi. Menolak atau menandai tidak pernah
            menambah saldo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OwnerReviewPanel
            kind="deposit"
            rows={depositRows}
            emptyMessage="Belum ada permintaan setoran."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Antrean penarikan</CardTitle>
          <CardDescription>
            Dana anggota dikunci sejak pengajuan. Biaya 10% selalu dihitung ulang server dari nominal
            bruto, dan hanya status selesai yang mendebit cadangan secara permanen.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OwnerReviewPanel
            kind="withdrawal"
            rows={withdrawalRows}
            emptyMessage="Belum ada permintaan penarikan."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Jejak audit terakhir</CardTitle>
          <CardDescription>
            Dua belas catatan terbaru.{" "}
            <Link href="/owner/audit" className="text-[var(--color-neon)] underline-offset-4 hover:underline">
              Lihat seluruh jejak audit
            </Link>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {overview.recentAudit.length === 0 ? (
            <p className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-6 text-center text-sm text-white/50">
              Belum ada catatan audit.
            </p>
          ) : (
            <ul className="space-y-2">
              {overview.recentAudit.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 text-xs"
                >
                  <span className="font-mono text-white/85">{row.action}</span>
                  <span className="text-white/50">
                    {row.actorUsername ? `@${row.actorUsername}` : "sistem"} · {row.entityType}
                    {row.entityId ? ` · ${row.entityId.slice(0, 8)}` : ""}
                  </span>
                  <span className="text-white/40">
                    {new Date(row.createdAt).toLocaleString("id-ID")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </OwnerShell>
  );
}
