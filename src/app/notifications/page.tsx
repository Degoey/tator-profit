import { BellRing } from "lucide-react";
import type { Metadata } from "next";

import { NotificationList } from "@/components/notifications/notification-list";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = {
  title: "Notifikasi",
  description:
    "Pemberitahuan akun Tatorprofit Anda: status setoran, penarikan, imbalan, kredit saldo, dan peristiwa keamanan.",
};

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const user = await requireUser("/notifications");

  const rows = await prisma.notification.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, type: true, title: true, body: true, readAt: true, createdAt: true },
  });

  const unread = rows.filter((row) => !row.readAt).length;

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <main className="mx-auto w-full max-w-4xl flex-1 space-y-6 px-5 py-10">
        <section className="card-glow rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="gold">
              <BellRing className="size-3.5" aria-hidden />
              Notifikasi
            </Badge>
            {unread > 0 ? <Badge>{unread} belum dibaca</Badge> : <Badge variant="muted">Semua dibaca</Badge>}
          </div>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Notifikasi akun @{user.username}
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-white/60">
            Notifikasi dibuat di dalam transaksi yang sama dengan perubahan statusnya, sehingga tidak
            ada pemberitahuan yang muncul untuk perubahan yang gagal disimpan.
          </p>
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Kotak masuk</CardTitle>
            <CardDescription>100 notifikasi terbaru milik akun ini.</CardDescription>
          </CardHeader>
          <CardContent>
            <NotificationList rows={rows} />
          </CardContent>
        </Card>
      </main>

      <SiteFooter />
    </div>
  );
}
