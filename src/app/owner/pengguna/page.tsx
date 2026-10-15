import Link from "next/link";
import type { Metadata } from "next";

import { OwnerShell } from "@/components/owner/owner-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { requireOwnerPage } from "@/lib/auth/owner-guard";
import { formatMoney } from "@/lib/money";
import { listOwnerMembers } from "@/lib/services/owner-console-service";
import { statusLabel } from "@/lib/status-labels";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Anggota" };

/**
 * Daftar anggota beserta saldo terkini. Pencarian dijalankan di server
 * (`?q=`), jadi satu halaman tidak pernah memuat seluruh tabel pengguna ke
 * peramban.
 */
export default async function OwnerMembersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const owner = await requireOwnerPage("/owner/pengguna");
  const params = await searchParams;
  const search = (params.q ?? "").trim();
  const members = await listOwnerMembers({ search: search.length > 0 ? search : undefined });

  return (
    <OwnerShell
      active="/owner/pengguna"
      title="Anggota"
      description="Daftar akun dengan saldo, status keanggotaan, dan waktu masuk terakhir. Klik satu anggota untuk melihat buku besar, sesi, peristiwa keamanan, serta antrean setoran dan penarikan miliknya."
      ownerLabel={`@${owner.username}`}
    >
      <Card>
        <CardHeader>
          <CardTitle>Pencarian anggota</CardTitle>
          <CardDescription>
            Mencocokkan nama, nama pengguna, surel, atau nomor telepon. Maksimal 200 baris terbaru.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1.5">
              <label
                htmlFor="owner-member-search"
                className="block text-xs font-semibold uppercase tracking-[0.14em] text-white/45"
              >
                Kata kunci
              </label>
              <Input
                id="owner-member-search"
                name="q"
                defaultValue={search}
                placeholder="nama, @pengguna, surel, atau nomor telepon"
              />
            </div>
            <Button type="submit">Cari</Button>
            {search ? (
              <Link
                href="/owner/pengguna"
                className="text-xs text-white/60 underline-offset-4 hover:underline"
              >
                Bersihkan
              </Link>
            ) : null}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{search ? `Hasil untuk “${search}”` : "Anggota terbaru"}</CardTitle>
          <CardDescription>{members.length} akun ditampilkan.</CardDescription>
        </CardHeader>
        <CardContent>
          {members.length === 0 ? (
            <p className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-6 text-center text-sm text-white/50">
              Tidak ada akun yang cocok.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full min-w-[52rem] border-collapse text-left text-sm">
                <caption className="sr-only">Daftar anggota</caption>
                <thead>
                  <tr className="bg-white/[0.04] text-[11px] uppercase tracking-[0.12em] text-white/45">
                    <th scope="col" className="px-3.5 py-3 font-semibold">Anggota</th>
                    <th scope="col" className="px-3.5 py-3 font-semibold">Status</th>
                    <th scope="col" className="px-3.5 py-3 font-semibold">Saldo tersedia</th>
                    <th scope="col" className="px-3.5 py-3 font-semibold">Tercadang</th>
                    <th scope="col" className="px-3.5 py-3 font-semibold">Dana program</th>
                    <th scope="col" className="px-3.5 py-3 font-semibold">Terdaftar</th>
                    <th scope="col" className="px-3.5 py-3 font-semibold">Masuk terakhir</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((member) => (
                    <tr key={member.id} className="border-t border-white/8 align-top">
                      <td className="px-3.5 py-3 text-xs">
                        <Link
                          href={`/owner/pengguna/${member.id}`}
                          className="font-medium text-[var(--color-neon)] underline-offset-4 hover:underline"
                        >
                          {member.name}
                        </Link>
                        <span className="block text-white/45">
                          @{member.username} · {member.email}
                        </span>
                        <span className="block text-white/35">{member.phone}</span>
                      </td>
                      <td className="px-3.5 py-3">
                        <span className="flex flex-col gap-1">
                          <Badge variant={member.status === "ACTIVE" ? "default" : "danger"}>
                            {statusLabel(member.status)}
                          </Badge>
                          {member.role === "ADMIN" ? (
                            <Badge variant="gold">
                              {member.adminRole ? statusLabel(member.adminRole) : "Admin tanpa peran"}
                            </Badge>
                          ) : null}
                          {member.membershipStatus ? (
                            <Badge variant="muted">
                              Keanggotaan {statusLabel(member.membershipStatus)}
                            </Badge>
                          ) : null}
                        </span>
                      </td>
                      <td className="px-3.5 py-3 text-xs font-semibold text-white">
                        {formatMoney(member.balance.available, member.balance.currency)}
                      </td>
                      <td className="px-3.5 py-3 text-xs text-[var(--color-gold)]">
                        {formatMoney(member.balance.reserved, member.balance.currency)}
                      </td>
                      <td className="px-3.5 py-3 text-xs text-white/70">
                        {formatMoney(member.balance.programFunds, member.balance.currency)}
                      </td>
                      <td className="px-3.5 py-3 text-xs text-white/50">
                        {new Date(member.createdAt).toLocaleDateString("id-ID")}
                      </td>
                      <td className="px-3.5 py-3 text-xs text-white/50">
                        {member.lastLoginAt
                          ? new Date(member.lastLoginAt).toLocaleString("id-ID")
                          : "belum pernah"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </OwnerShell>
  );
}
