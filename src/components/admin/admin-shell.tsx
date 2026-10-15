import Link from "next/link";
import type { ReactNode } from "react";
import { ShieldCheck, UserCog } from "lucide-react";

import { InstallAppButton } from "@/components/pwa/install-app-button";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ADMIN_ROLE_LABELS } from "@/lib/config/admin-roles";
import { adminConsoleLinksFor, type AdminConsolePath } from "@/lib/config/admin-console";
import { cn } from "@/lib/utils";
import type { AdminRole } from "@prisma/client";

/**
 * Kerangka Panel Admin (peran biasa).
 *
 * Dipisahkan dari `PaymentShell` (permukaan anggota) dan dari `OwnerShell`
 * (konsol pemilik) supaya navigasinya sendiri: hanya halaman yang benar-benar
 * boleh dibuka peran ini yang ditampilkan. Penyaringan di sini bukan penjagaan —
 * setiap halaman tetap memutuskan kapabilitasnya sendiri di server — tetapi
 * panel tidak boleh menawarkan pintu yang pasti tertutup.
 */
export interface AdminShellProps {
  active: AdminConsolePath;
  title: string;
  description: string;
  /** Peran admin pelaksana; `null` tidak pernah sampai ke sini (ditolak layout). */
  adminRole: AdminRole | null;
  username: string;
  /**
   * True bila akun ini juga pemilik platform: kapabilitas pemilik saja (kredit
   * saldo, ubah peran admin) tidak dirender di panel ini, hanya ditunjuk.
   */
  isOwner?: boolean;
  children: ReactNode;
}

export function AdminShell({
  active,
  title,
  description,
  adminRole,
  username,
  isOwner = false,
  children,
}: AdminShellProps) {
  const links = adminConsoleLinksFor(adminRole);

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <div className="mx-auto grid w-full max-w-7xl flex-1 gap-6 px-5 py-8 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <aside>
          <nav
            aria-label="Navigasi panel admin"
            className="flex gap-2 overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.03] p-3 lg:sticky lg:top-24 lg:flex-col lg:overflow-visible"
          >
            {links.map(({ href, label }) => {
              const current = active === href;
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    "flex shrink-0 items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors",
                    current
                      ? "bg-[var(--color-admin)]/10 text-[var(--color-admin)]"
                      : "text-white/60 hover:bg-white/5 hover:text-white",
                  )}
                >
                  <ShieldCheck className="size-4" aria-hidden />
                  {label}
                </Link>
              );
            })}
          </nav>
        </aside>

        <main className="min-w-0 space-y-6">
          <header className="rounded-2xl border border-[var(--color-admin)]/25 bg-gradient-to-r from-[var(--color-admin)]/10 via-transparent to-transparent p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--color-admin)]">
                  <UserCog className="size-3.5" aria-hidden />
                  Panel Admin · @{username}
                </p>
                <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                  {title}
                </h1>
                <p className="mt-2 max-w-3xl text-sm leading-relaxed text-white/60">{description}</p>
              </div>
              {/* Tombol pasang aplikasi: Chromium memakai prompt asli, Safari iOS
                  menampilkan langkah "Tambahkan ke Layar Utama". */}
              <InstallAppButton label="Pasang aplikasi admin" />
            </div>
          </header>

          <section className="flex flex-wrap items-center gap-2">
            <Badge variant="gold">
              {adminRole ? (ADMIN_ROLE_LABELS[adminRole] ?? adminRole) : "Tanpa peran"}
            </Badge>
            <Badge variant="muted">@{username}</Badge>
          </section>

          {isOwner ? (
            <Alert variant="info" title="Kapabilitas pemilik tidak ada di panel ini">
              Menambah saldo USDT dan mengubah peran admin tetap milik Konsol Pemilik. Buka{" "}
              <Link
                href="/owner"
                className="text-[var(--color-neon)] underline-offset-4 hover:underline"
              >
                Konsol Pemilik
              </Link>{" "}
              untuk dua tindakan itu.
            </Alert>
          ) : null}

          {children}
        </main>
      </div>

      <SiteFooter />
    </div>
  );
}
