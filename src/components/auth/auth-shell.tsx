import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { SiteFooter } from "@/components/site-footer";

export interface AuthShellProps {
  title: string;
  description: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export function AuthShell({ title, description, children, footer }: AuthShellProps) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-white/10">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-xl border border-[var(--color-neon)]/40 bg-[var(--color-neon)]/10">
              <ShieldCheck className="size-5 text-[var(--color-neon)]" aria-hidden />
            </span>
            <span className="text-base font-semibold tracking-tight text-white">
              Tator<span className="text-neon">profit</span>
            </span>
          </Link>
          <Link href="/" className="text-sm text-white/60 transition-colors hover:text-white">
            Kembali ke beranda
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-5 py-14">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight text-white">{title}</h1>
          <p className="text-sm leading-relaxed text-white/60">{description}</p>
        </div>

        <div className="card-glow mt-8 rounded-2xl border border-white/10 bg-white/[0.03] p-6 sm:p-8">
          {children}
        </div>

        {footer ? <div className="mt-6 text-sm text-white/50">{footer}</div> : null}
      </main>

      <SiteFooter />
    </div>
  );
}
