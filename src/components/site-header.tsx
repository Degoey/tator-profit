import { LayoutDashboard, LogIn, ShieldCheck } from "lucide-react";
import Link from "next/link";

import { SiteNav, type SiteNavLink } from "@/components/site-nav";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/prisma";

export async function SiteHeader() {
  const user = await getCurrentUser();
  const unreadNotifications = user
    ? await prisma.notification.count({ where: { userId: user.id, readAt: null } })
    : 0;

  const links: SiteNavLink[] = user
    ? [
        { href: "/programs", label: "Program" },
        { href: "/rewards", label: "Imbalan" },
        { href: "/transactions", label: "Transaksi" },
        { href: "/deposit", label: "Setor Dana" },
        { href: "/withdrawal", label: "Tarik Dana" },
        { href: "/referral", label: "Rujukan" },
        { href: "/notifications", label: "Notifikasi", badge: unreadNotifications },
        { href: "/profile", label: "Profil" },
        { href: "/security", label: "Keamanan" },
        ...(user.role === "ADMIN" ? [{ href: "/admin", label: "Admin" }] : []),
      ]
    : [
        { href: "/programs", label: "Program" },
        { href: "/#market", label: "Papan Pasar" },
        { href: "/#tiers", label: "Pilihan Paket" },
        { href: "/#deposit", label: "Setor Dana" },
        { href: "/#program", label: "Ketentuan Program" },
        { href: "/referral-terms", label: "Ketentuan Rujukan" },
        { href: "/#referral", label: "Rujukan" },
      ];

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[color-mix(in_oklab,var(--color-ink)_88%,transparent)] backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-5">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-xl border border-[var(--color-neon)]/40 bg-[var(--color-neon)]/10">
            <ShieldCheck className="size-5 text-[var(--color-neon)]" aria-hidden />
          </span>
          <span className="text-base font-semibold tracking-tight text-white">
            Tator<span className="text-neon">profit</span>
          </span>
        </Link>

        <SiteNav links={links} />

        <div className="flex items-center gap-2.5">
          {user ? (
            <Button asChild size="sm">
              <Link href="/dashboard">
                <LayoutDashboard aria-hidden />
                Dasbor
              </Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link href="/login">
                  <LogIn aria-hidden />
                  Masuk
                </Link>
              </Button>
              <Button asChild size="sm" variant="gold">
                <Link href="/register">Buat Akun</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
