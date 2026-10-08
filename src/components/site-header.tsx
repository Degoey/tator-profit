import { LayoutDashboard, LogIn, ShieldCheck } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth/current-user";

export async function SiteHeader() {
  const user = await getCurrentUser();

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[color-mix(in_oklab,var(--color-ink)_88%,transparent)] backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-xl border border-[var(--color-neon)]/40 bg-[var(--color-neon)]/10">
            <ShieldCheck className="size-5 text-[var(--color-neon)]" aria-hidden />
          </span>
          <span className="text-base font-semibold tracking-tight text-white">
            Tator<span className="text-neon">profit</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-7 text-sm text-white/70 md:flex">
          <Link href="/programs" className="transition-colors hover:text-white">
            Program
          </Link>
          <Link href="/#tiers" className="transition-colors hover:text-white">
            Pilihan Paket
          </Link>
          {user ? (
            <>
              <Link href="/deposit" className="transition-colors hover:text-white">
                Setor Dana
              </Link>
              <Link href="/withdrawal" className="transition-colors hover:text-white">
                Tarik Dana
              </Link>
              {user.role === "ADMIN" ? (
                <Link href="/admin" className="transition-colors hover:text-white">
                  Admin
                </Link>
              ) : null}
            </>
          ) : (
            <>
              <Link href="/#program" className="transition-colors hover:text-white">
                Ketentuan Program
              </Link>
              <Link href="/#referral" className="transition-colors hover:text-white">
                Rujukan
              </Link>
            </>
          )}
        </nav>


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
