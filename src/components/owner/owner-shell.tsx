import Link from "next/link";
import type { ReactNode } from "react";
import { Crown, LayoutDashboard, ScrollText, ShieldCheck, Users } from "lucide-react";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { cn } from "@/lib/utils";

/**
 * Kerangka Konsol Pemilik.
 *
 * Halaman pemilik sengaja tidak memakai `PaymentShell` supaya navigasinya terpisah
 * dari permukaan anggota dan administrasi umum — dari sini pemilik melihat seluruh
 * platform, bukan hanya satu modul keuangan.
 */
export type OwnerSection = "/owner" | "/owner/pengguna" | "/owner/audit" | "/owner/keamanan";

const OWNER_LINKS: { href: OwnerSection; label: string; icon: typeof Crown }[] = [
  { href: "/owner", label: "Ringkasan", icon: LayoutDashboard },
  { href: "/owner/pengguna", label: "Anggota", icon: Users },
  { href: "/owner/audit", label: "Jejak audit", icon: ScrollText },
  { href: "/owner/keamanan", label: "Keamanan", icon: ShieldCheck },
];

export interface OwnerShellProps {
  active: OwnerSection;
  title: string;
  description: string;
  ownerLabel: string;
  children: ReactNode;
}

export function OwnerShell({ active, title, description, ownerLabel, children }: OwnerShellProps) {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <div className="mx-auto grid w-full max-w-7xl flex-1 gap-6 px-5 py-8 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <aside>
          <nav
            aria-label="Navigasi konsol pemilik"
            className="flex gap-2 overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.03] p-3 lg:sticky lg:top-24 lg:flex-col lg:overflow-visible"
          >
            {OWNER_LINKS.map(({ href, label, icon: Icon }) => {
              const current = active === href;
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    "flex shrink-0 items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors",
                    current
                      ? "bg-[var(--color-neon)]/10 text-[var(--color-neon)]"
                      : "text-white/60 hover:bg-white/5 hover:text-white",
                  )}
                >
                  <Icon className="size-4" aria-hidden />
                  {label}
                </Link>
              );
            })}
          </nav>
        </aside>

        <main className="min-w-0 space-y-6">
          <header className="rounded-2xl border border-[var(--color-gold)]/25 bg-gradient-to-r from-[var(--color-gold)]/10 via-transparent to-transparent p-6">
            <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--color-gold)]">
              <Crown className="size-3.5" aria-hidden />
              Konsol Pemilik · {ownerLabel}
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">{title}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-white/60">{description}</p>
          </header>

          {children}
        </main>
      </div>

      <SiteFooter />
    </div>
  );
}
