import { KeyRound, ShieldCheck, UserCog } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { formatPaymentDate } from "@/components/payments/status-badge";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = {
  title: "Keamanan",
  description:
    "Ringkasan keamanan akun Tatorprofit: sesi aktif, peristiwa keamanan terakhir, dan cara mengganti kata sandi.",
};

export const dynamic = "force-dynamic";

const EVENT_LABELS: Record<string, string> = {
  LOGIN_SUCCESS: "Masuk berhasil",
  LOGIN_FAILED: "Percobaan masuk gagal",
  LOGOUT: "Keluar",
  PASSWORD_RESET_REQUESTED: "Permintaan reset kata sandi",
  PASSWORD_CHANGED: "Kata sandi diubah",
  SESSION_REVOKED: "Sesi dicabut",
  RATE_LIMITED: "Permintaan dibatasi",
  FRAUD_FLAGGED: "Sinyal anti-fraud terdeteksi",
};

const SEVERITY_VARIANTS: Record<string, "default" | "gold" | "muted" | "danger"> = {
  INFO: "muted",
  WARNING: "gold",
  CRITICAL: "danger",
};

/** Row shape of the raw session query; `active` is decided by PostgreSQL. */
interface SessionRow {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date;
  revokedAt: Date | null;
  active: boolean;
}

export default async function SecurityPage() {
  const user = await requireUser("/security");

  /**
   * Time dependent values (`expiresAt > NOW()`) are computed by PostgreSQL, exactly
   * like the admin dashboard does, so the server component itself never calls an
   * impure clock function during render.
   */
  const [sessions, events, activeSessionCount] = await Promise.all([
    prisma.$queryRaw<SessionRow[]>`
      SELECT
        "id",
        "ipAddress",
        "userAgent",
        "createdAt",
        "lastUsedAt",
        "expiresAt",
        "revokedAt",
        ("revokedAt" IS NULL AND "expiresAt" > NOW()) AS "active"
      FROM "Session"
      WHERE "userId" = ${user.id}::uuid
      ORDER BY "createdAt" DESC
      LIMIT 20
    `,
    prisma.securityEvent.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: {
        id: true,
        type: true,
        severity: true,
        description: true,
        createdAt: true,
        ipAddress: true,
      },
    }),
    prisma.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
      FROM "Session"
      WHERE "userId" = ${user.id}::uuid
        AND "revokedAt" IS NULL
        AND "expiresAt" > NOW()
    `,
  ]);

  const activeSessions = activeSessionCount[0]?.count ?? 0;

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 px-5 py-10">
        <section className="card-glow rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <Badge variant="gold">
            <ShieldCheck className="size-3.5" aria-hidden />
            Keamanan akun
          </Badge>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Keamanan akun @{user.username}
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-white/60">
            Halaman ini menampilkan data keamanan yang benar-benar tercatat di database: sesi masuk
            dan peristiwa keamanan akun Anda. Kata sandi disimpan sebagai hash bcrypt dan tidak dapat
            dibaca kembali oleh siapa pun, termasuk admin.
          </p>
        </section>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/60">
              Sesi aktif
            </p>
            <p className="mt-3 text-2xl font-semibold text-[var(--color-neon)]">
              {activeSessions}
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/60">
              Status akun
            </p>
            <p className="mt-3 text-2xl font-semibold text-white">{user.status}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/60">
              Autentikasi dua faktor
            </p>
            <p className="mt-3 text-sm font-semibold text-white/85">Belum tersedia</p>
          </div>
        </div>

        <Alert variant="warning" title="Batas yang jujur">
          Autentikasi dua faktor (2FA) belum diimplementasikan pada versi ini, sehingga tidak ada
          status keamanan tambahan yang ditampilkan. Jangan menganggap akun ini memiliki 2FA sampai
          fitur tersebut benar-benar tersedia dan teruji.
        </Alert>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserCog className="size-4 text-[var(--color-neon)]" aria-hidden />
              Sesi masuk
            </CardTitle>
            <CardDescription>
              20 sesi terakhir akun ini. Token sesi disimpan sebagai hash; nilai mentahnya tidak
              pernah disimpan maupun ditampilkan.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {sessions.length === 0 ? (
              <p className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-6 text-center text-sm text-white/60">
                Belum ada sesi tercatat.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
                  <caption className="sr-only">Sesi masuk akun, terbaru lebih dulu</caption>
                  <thead>
                    <tr className="text-[11px] uppercase tracking-[0.12em] text-white/50">
                      <th scope="col" className="border-b border-white/10 pb-2 pr-3 font-semibold">
                        Dibuat
                      </th>
                      <th scope="col" className="border-b border-white/10 pb-2 pr-3 font-semibold">
                        Terakhir dipakai
                      </th>
                      <th scope="col" className="border-b border-white/10 pb-2 pr-3 font-semibold">
                        Alamat IP
                      </th>
                      <th scope="col" className="border-b border-white/10 pb-2 pr-3 font-semibold">
                        Perangkat
                      </th>
                      <th scope="col" className="border-b border-white/10 pb-2 font-semibold">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.map((session) => {
                      const active = session.active;
                      return (
                        <tr key={session.id} className="align-top">
                          <td className="border-b border-white/8 py-3 pr-3 text-xs text-white/70">
                            {formatPaymentDate(session.createdAt)}
                          </td>
                          <td className="border-b border-white/8 py-3 pr-3 text-xs text-white/70">
                            {formatPaymentDate(session.lastUsedAt)}
                          </td>
                          <td className="border-b border-white/8 py-3 pr-3 font-mono text-[11px] text-white/60">
                            {session.ipAddress ?? "Tidak tercatat"}
                          </td>
                          <td className="max-w-[16rem] truncate border-b border-white/8 py-3 pr-3 text-[11px] text-white/55">
                            {session.userAgent ?? "Tidak tercatat"}
                          </td>
                          <td className="border-b border-white/8 py-3">
                            <Badge variant={active ? "default" : "muted"}>
                              {active ? "Aktif" : "Berakhir"}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Peristiwa keamanan</CardTitle>
            <CardDescription>
              25 peristiwa terakhir: masuk, keluar, reset kata sandi, dan pembatasan permintaan.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {events.length === 0 ? (
              <p className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-6 text-center text-sm text-white/60">
                Belum ada peristiwa keamanan tercatat.
              </p>
            ) : (
              <ul className="space-y-3">
                {events.map((event) => (
                  <li
                    key={event.id}
                    className="flex flex-wrap items-center justify-between gap-3 border-b border-white/8 pb-3 last:border-0 last:pb-0"
                  >
                    <div>
                      <p className="text-sm text-white/85">
                        {EVENT_LABELS[event.type] ?? event.type}
                      </p>
                      <p className="text-[11px] text-white/55">
                        {formatPaymentDate(event.createdAt)}
                        {event.ipAddress ? ` · ${event.ipAddress}` : ""}
                      </p>
                    </div>
                    <Badge variant={SEVERITY_VARIANTS[event.severity] ?? "muted"}>
                      {event.severity}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <section className="flex flex-wrap gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <Button asChild variant="gold" size="sm">
            <Link href="/forgot-password">
              <KeyRound aria-hidden />
              Ganti kata sandi
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/profile">Kelola profil</Link>
          </Button>
          <p className="w-full text-xs leading-relaxed text-white/60 sm:w-auto sm:flex-1">
            Mengganti kata sandi akan mencabut seluruh sesi aktif akun ini.
          </p>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
