import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { AdminShell } from "@/components/admin/admin-shell";
import { PaymentKpis } from "@/components/payments/payment-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { canAdmin } from "@/lib/auth/admin-permissions";
import { requireAdminConsole } from "@/lib/auth/current-user";
import { adminConsoleLinksFor } from "@/lib/config/admin-console";
import { isOwnerAccount } from "@/lib/config/owner";
import { formatMoney } from "@/lib/money";
import { adminConsoleOverview } from "@/lib/services/admin-console-service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ringkasan admin" };

/**
 * Dasbor Panel Admin.
 *
 * Setiap angka adalah agregat langsung dari database, dan setiap blok hanya
 * dimuat bila peran ini memang berhak: penghitung anti-fraud tidak diambil untuk
 * peran tanpa `readFraud`, dan kapabilitas milik pemilik (kredit saldo, ubah
 * peran admin) tidak dirender di sini sama sekali — hanya ditunjuk ke Konsol
 * Pemilik.
 */
export default async function AdminConsoleDashboardPage() {
  const admin = await requireAdminConsole("/admin");
  const canReadFraud = canAdmin(admin.adminRole, "readFraud");
  const canReadAudit = canAdmin(admin.adminRole, "readAudit");
  const overview = await adminConsoleOverview({ canReadFraud });
  const links = adminConsoleLinksFor(admin.adminRole).filter((link) => link.href !== "/admin");

  return (
    <AdminShell
      active="/admin"
      title="Ringkasan admin"
      description="Antrean uang yang menunggu keputusan dan nilai terkonfirmasi, diambil langsung dari database. Setiap tindakan tetap dicatat dengan aktor dan waktu."
      adminRole={admin.adminRole}
      username={admin.username}
      isOwner={isOwnerAccount(admin)}
    >
      <PaymentKpis
        label="Indikator administrasi"
        items={[
          { label: "Total pengguna", value: String(overview.usersTotal) },
          { label: "Pengguna aktif", value: String(overview.usersActive) },
          { label: "Program aktif", value: String(overview.programsActive) },
          {
            label: "Keanggotaan aktif",
            value: String(overview.membershipsActive),
            hint: `${overview.membershipsPending} keanggotaan menunggu konfirmasi dana`,
          },
          {
            label: "Deposit menunggu tinjauan",
            value: String(overview.depositsPending),
            tone: "gold",
            hint: "Status menunggu atau sedang ditinjau",
          },
          {
            label: "Penarikan berjalan",
            value: String(overview.withdrawalsPending),
            tone: "gold",
            hint: "Menunggu, ditinjau, disetujui, atau diproses",
          },
          {
            label: "Imbalan tercatat",
            value: String(overview.rewardsTotal),
            hint: `Dibayar ${formatMoney(overview.rewardsPaid)}`,
          },
          {
            label: "Imbalan menunggu keputusan",
            value: String(overview.rewardsPending),
            tone: "gold",
            hint: "Sudah dicatat, belum masuk saldo anggota",
          },
          {
            label: "Komisi rujukan",
            value: String(overview.commissionsTotal),
            hint: `Dibayar ${formatMoney(overview.commissionsPaid)}`,
          },
          {
            label: "Komisi menunggu penyelesaian",
            value: formatMoney(overview.commissionsPending),
            tone: "gold",
            hint: "Menunggu atau disetujui, belum masuk saldo anggota",
          },
          ...(canReadFraud
            ? [
                {
                  label: "Kasus anti-fraud terbuka",
                  value: String(overview.openFraudCases),
                  tone: "danger" as const,
                  hint: "Sinyal multi-akun menunggu tinjauan manusia",
                },
              ]
            : []),
        ]}
      />

      <PaymentKpis
        label="Nilai terkonfirmasi"
        columns={2}
        items={[
          {
            label: "Total deposit disetujui",
            value: formatMoney(overview.approvedDeposits),
          },
          {
            label: "Total penarikan selesai",
            value: formatMoney(overview.completedWithdrawals),
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
            value: String(overview.depositsFlagged + overview.withdrawalsRejected),
            tone: "danger",
            hint: `${overview.depositsFlagged} deposit ditandai · ${overview.withdrawalsRejected} penarikan ditolak`,
          },
          {
            label: "Aktivitas admin 24 jam",
            value: String(overview.adminActivity24h),
            hint: "Catatan audit dengan aktor administrator",
          },
          {
            label: "Antrean deposit & penarikan",
            value: String(overview.depositsPending + overview.withdrawalsPending),
            tone: "gold",
            hint: "Permintaan yang belum selesai ditinjau",
          },
        ]}
      />

      <Card>
        <CardHeader>
          <CardTitle>Halaman yang boleh Anda buka</CardTitle>
          <CardDescription>
            Daftar ini mengikuti peran admin Anda: halaman yang tidak boleh dibuka tidak ditawarkan
            sama sekali, dan setiap halaman memutuskan sendiri di server apa yang boleh dimuat.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {links.length === 0 ? (
            <p className="text-sm text-white/60">
              Peran Anda hanya dapat membuka dasbor ini. Hubungi Super Admin bila tugas Anda
              memerlukan antrean uang atau jejak audit.
            </p>
          ) : (
            links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="flex items-start justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3.5 transition-colors hover:border-[var(--color-admin)]/40 hover:bg-white/[0.04]"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-white">{link.label}</span>
                  <span className="mt-1 block text-xs leading-relaxed text-white/55">
                    {link.summary}
                  </span>
                </span>
                <ArrowRight className="mt-0.5 size-4 shrink-0 text-[var(--color-admin)]" aria-hidden />
              </Link>
            ))
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Badge variant={canReadAudit ? "default" : "muted"}>
              {canReadAudit ? "Jejak audit tersedia" : "Jejak audit tidak tersedia"}
            </Badge>
            <Badge variant={canReadFraud ? "default" : "muted"}>
              {canReadFraud ? "Antrean anti-fraud tersedia" : "Anti-fraud tidak tersedia"}
            </Badge>
          </div>
        </CardContent>
      </Card>
    </AdminShell>
  );
}
