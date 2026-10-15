import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { OwnerCreditForm } from "@/components/owner/owner-credit-form";
import { OwnerShell } from "@/components/owner/owner-shell";
import { PaymentKpis } from "@/components/payments/payment-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOwnerPage } from "@/lib/auth/owner-guard";
import { formatMoney } from "@/lib/money";
import { getOwnerMemberDetail } from "@/lib/services/owner-console-service";
import { statusLabel } from "@/lib/status-labels";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Detail anggota" };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Satu anggota selengkapnya. Semuanya hanya-baca kecuali kartu kredit saldo:
 * kredit pun tetap memakai layanan kredit administrator sehingga ledger, jejak
 * audit, dan notifikasi anggota tidak diduplikasi di sini.
 */
export default async function OwnerMemberDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const owner = await requireOwnerPage("/owner/pengguna");
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();

  const member = await getOwnerMemberDetail(id);
  if (!member) notFound();

  return (
    <OwnerShell
      active="/owner/pengguna"
      title={member.name}
      description={`@${member.username} · ${member.email} · terdaftar ${new Date(member.createdAt).toLocaleString("id-ID")}`}
      ownerLabel={`@${owner.username}`}
    >
      <section className="flex flex-wrap items-center gap-2">
        <Link
          href="/owner/pengguna"
          className="text-xs text-white/60 underline-offset-4 hover:underline"
        >
          ← Kembali ke daftar anggota
        </Link>
        <Badge variant={member.status === "ACTIVE" ? "default" : "danger"}>
          {statusLabel(member.status)}
        </Badge>
        {member.role === "ADMIN" ? (
          <Badge variant="gold">
            {member.adminRole ? statusLabel(member.adminRole) : "Admin tanpa peran"}
          </Badge>
        ) : null}
        {member.membershipStatus ? (
          <Badge variant="muted">Keanggotaan {statusLabel(member.membershipStatus)}</Badge>
        ) : null}
        {member.referralCode ? <Badge variant="muted">Kode {member.referralCode}</Badge> : null}
      </section>

      <PaymentKpis
        label="Saldo anggota"
        items={[
          { label: "Tersedia", value: formatMoney(member.balance.available, member.balance.currency) },
          {
            label: "Tercadang",
            value: formatMoney(member.balance.reserved, member.balance.currency),
            tone: "gold",
            hint: "Dikunci penarikan berjalan",
          },
          {
            label: "Menunggu",
            value: formatMoney(member.balance.pending, member.balance.currency),
            hint: "Imbalan disetujui yang belum dibayar",
          },
          {
            label: "Dana program",
            value: formatMoney(member.balance.programFunds, member.balance.currency),
            hint: `Total imbalan tercatat ${formatMoney(member.balance.totalEarned, member.balance.currency)}`,
          },
        ]}
      />

      <Card>
        <CardHeader>
          <CardTitle>Identitas dan kontak</CardTitle>
          <CardDescription>Data yang tercatat pada akun ini.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-[0.14em] text-white/45">Nomor telepon</dt>
              <dd className="text-white/85">{member.phone}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.14em] text-white/45">Bank / e-wallet</dt>
              <dd className="text-white/85">
                {member.bank ? `${member.bank} · ${member.bankAccountNumber ?? "-"}` : "belum diisi"}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.14em] text-white/45">Masuk terakhir</dt>
              <dd className="text-white/85">
                {member.lastLoginAt
                  ? new Date(member.lastLoginAt).toLocaleString("id-ID")
                  : "belum pernah"}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.14em] text-white/45">Surel terverifikasi</dt>
              <dd className="text-white/85">
                {member.emailVerifiedAt
                  ? new Date(member.emailVerifiedAt).toLocaleString("id-ID")
                  : "belum"}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.14em] text-white/45">IP pendaftaran</dt>
              <dd className="text-white/85">{member.registrationIp ?? "tidak tercatat"}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Kredit saldo</CardTitle>
          <CardDescription>
            Tindakan uang dari konsol pemilik. Wajib memakai nomor referensi unik sebagai kunci
            idempotensi.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OwnerCreditForm userId={member.id} username={member.username} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Buku besar</CardTitle>
          <CardDescription>Dua puluh lima entri ledger terbaru; riwayat tidak pernah diubah.</CardDescription>
        </CardHeader>
        <CardContent>
          {member.transactions.length === 0 ? (
            <p className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-6 text-center text-sm text-white/50">
              Belum ada entri ledger.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full min-w-[46rem] border-collapse text-left text-sm">
                <caption className="sr-only">Buku besar anggota</caption>
                <thead>
                  <tr className="bg-white/[0.04] text-[11px] uppercase tracking-[0.12em] text-white/45">
                    <th scope="col" className="px-3.5 py-3 font-semibold">Waktu</th>
                    <th scope="col" className="px-3.5 py-3 font-semibold">Jenis</th>
                    <th scope="col" className="px-3.5 py-3 font-semibold">Jumlah</th>
                    <th scope="col" className="px-3.5 py-3 font-semibold">Bucket</th>
                    <th scope="col" className="px-3.5 py-3 font-semibold">Saldo sesudah</th>
                    <th scope="col" className="px-3.5 py-3 font-semibold">Referensi</th>
                  </tr>
                </thead>
                <tbody>
                  {member.transactions.map((row) => (
                    <tr key={row.id} className="border-t border-white/8 align-top">
                      <td className="px-3.5 py-3 text-xs text-white/50">
                        {new Date(row.createdAt).toLocaleString("id-ID")}
                      </td>
                      <td className="px-3.5 py-3 text-xs">
                        <span className="block text-white/85">{row.type}</span>
                        <span className="block text-white/45">{statusLabel(row.status)}</span>
                        {row.description ? (
                          <span className="block text-white/40">{row.description}</span>
                        ) : null}
                      </td>
                      <td className="px-3.5 py-3 text-xs font-semibold text-white">
                        {formatMoney(row.amount, row.currency)}
                      </td>
                      <td className="px-3.5 py-3 text-xs text-white/60">{row.bucket}</td>
                      <td className="px-3.5 py-3 text-xs text-white/70">
                        {formatMoney(row.balanceAfter, row.currency)}
                      </td>
                      <td className="px-3.5 py-3 font-mono text-[11px] text-white/40">
                        {row.reference}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Setoran dan penarikan</CardTitle>
          <CardDescription>
            Riwayat uang anggota ini. Persetujuan dijalankan dari{" "}
            <Link href="/owner" className="text-[var(--color-neon)] underline-offset-4 hover:underline">
              antrean di ringkasan
            </Link>
            .
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-white/45">
              Setoran
            </p>
            {member.deposits.length === 0 ? (
              <p className="text-sm text-white/50">Tidak ada permintaan setoran.</p>
            ) : (
              <ul className="space-y-2">
                {member.deposits.map((row) => (
                  <li
                    key={row.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 text-xs"
                  >
                    <span className="text-white/85">
                      {formatMoney(row.amount, row.currency)} · {row.paymentMethod}
                    </span>
                    <Badge variant={row.status === "APPROVED" ? "default" : row.status === "REJECTED" || row.status === "FLAGGED" ? "danger" : "gold"}>
                      {statusLabel(row.status)}
                    </Badge>
                    <span className="text-white/40">
                      {new Date(row.createdAt).toLocaleString("id-ID")} · {row.paymentReference}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-white/45">
              Penarikan
            </p>
            {member.withdrawals.length === 0 ? (
              <p className="text-sm text-white/50">Tidak ada permintaan penarikan.</p>
            ) : (
              <ul className="space-y-2">
                {member.withdrawals.map((row) => (
                  <li
                    key={row.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 text-xs"
                  >
                    <span className="text-white/85">
                      {formatMoney(row.amount, row.currency)} · netto{" "}
                      {formatMoney(row.netAmount, row.currency)} · {row.method}
                    </span>
                    <Badge variant={row.status === "COMPLETED" ? "default" : row.status === "REJECTED" ? "danger" : "gold"}>
                      {statusLabel(row.status)}
                    </Badge>
                    <span className="text-white/40">
                      {new Date(row.createdAt).toLocaleString("id-ID")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sesi dan peristiwa keamanan</CardTitle>
          <CardDescription>
            Sepuluh sesi terakhir dan lima belas peristiwa keamanan terakhir akun ini.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="space-y-2">
            {member.sessions.map((session) => (
              <li
                key={session.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 text-xs"
              >
                <span className="text-white/70">{session.ipAddress ?? "IP tidak tercatat"}</span>
                <span className="max-w-[22rem] truncate text-white/45" title={session.userAgent ?? ""}>
                  {session.userAgent ?? "Peramban tidak dikenal"}
                </span>
                <span className="text-white/40">
                  {session.revokedAt
                    ? `dicabut ${new Date(session.revokedAt).toLocaleString("id-ID")}`
                    : `dibuat ${new Date(session.createdAt).toLocaleString("id-ID")}`}
                  {session.totpVerifiedAt ? " · 2FA terverifikasi" : ""}
                </span>
              </li>
            ))}
          </ul>

          <ul className="space-y-2">
            {member.securityEvents.map((event) => (
              <li
                key={event.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 text-xs"
              >
                <span className="flex items-center gap-2">
                  <Badge
                    variant={
                      event.severity === "CRITICAL"
                        ? "danger"
                        : event.severity === "WARNING"
                          ? "gold"
                          : "muted"
                    }
                  >
                    {event.type}
                  </Badge>
                  <span className="text-white/70">{event.description ?? "-"}</span>
                </span>
                <span className="text-white/40">
                  {event.ipAddress ?? "IP tidak tercatat"} ·{" "}
                  {new Date(event.createdAt).toLocaleString("id-ID")}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </OwnerShell>
  );
}
