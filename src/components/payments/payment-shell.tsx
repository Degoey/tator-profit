import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Coins,
  LayoutDashboard,
  Layers,
  Receipt,
  ShieldAlert,
  ShieldCheck,
  Wallet,
} from "lucide-react";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { cn } from "@/lib/utils";

export type PaymentSection =
  | "/deposit"
  | "/withdrawal"
  | "/admin"
  | "/admin/fraud"
  | "/rewards"
  | "/transactions";

export interface PaymentShellProps {
  active: PaymentSection;
  title: string;
  description: string;
  isAdmin?: boolean;
  /** Renders the anti-fraud queue link; only administrators with `readFraud` set it. */
  showFraudReview?: boolean;
  children: ReactNode;
}

/**
 * Shared frame for the payment surfaces: sticky account sidebar + page header.
 * The global site header/footer stay untouched; this only adds the in-page nav.
 */
export function PaymentShell({
  active,
  title,
  description,
  isAdmin = false,
  showFraudReview = false,
  children,
}: PaymentShellProps) {
  const links: { href: string; label: string; icon: typeof Wallet }[] = [
    { href: "/dashboard", label: "Dasbor", icon: LayoutDashboard },
    { href: "/programs", label: "Program", icon: Layers },
    { href: "/rewards", label: "Imbalan", icon: Coins },
    { href: "/transactions", label: "Transaksi", icon: Receipt },
    { href: "/deposit", label: "Setor Dana", icon: ArrowDownToLine },
    { href: "/withdrawal", label: "Penarikan", icon: ArrowUpFromLine },
  ];

  if (isAdmin) {
    links.push({ href: "/admin", label: "Administrasi", icon: ShieldCheck });
  }

  if (showFraudReview) {
    // Antrean anti-fraud adalah halaman kapabilitas di Panel Admin; tidak ada lagi
    // halaman terpisah di permukaan anggota.
    links.push({ href: "/admin/fraud", label: "Tinjauan Anti-Fraud", icon: ShieldAlert });
  }

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <div className="mx-auto grid w-full max-w-7xl flex-1 gap-6 px-5 py-8 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <aside>
          <nav
            aria-label="Navigasi keuangan"
            className="flex gap-2 overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.03] p-3 lg:sticky lg:top-24 lg:flex-col lg:overflow-visible"
          >
            {links.map(({ href, label, icon: Icon }) => {
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
          <header className="rounded-2xl border border-white/10 bg-gradient-to-r from-[var(--color-neon)]/10 via-transparent to-transparent p-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--color-neon)]">
              Tatorprofit · Keuangan
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              {title}
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-white/60">{description}</p>
          </header>

          {children}
        </main>
      </div>

      <SiteFooter />
    </div>
  );
}

export interface PaymentKpi {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "gold" | "danger";
}

/** Responsive KPI strip driven by real database counts. */
export function PaymentKpis({
  items,
  label = "Ringkasan",
  columns = 4,
}: {
  items: PaymentKpi[];
  label?: string;
  columns?: 2 | 3 | 4;
}) {
  const toneStyles: Record<NonNullable<PaymentKpi["tone"]>, string> = {
    default: "text-[var(--color-neon)]",
    gold: "text-[var(--color-gold)]",
    danger: "text-red-300",
  };

  const gridClass =
    columns === 2
      ? "grid gap-3 sm:grid-cols-2"
      : columns === 3
        ? "grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
        : "grid gap-3 sm:grid-cols-2 xl:grid-cols-4";

  return (
    <section aria-label={label} className={gridClass}>
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded-2xl border border-white/10 bg-white/[0.03] p-5"
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">
            {item.label}
          </p>
          <p
            className={cn(
              "mt-3 text-2xl font-semibold tracking-tight",
              toneStyles[item.tone ?? "default"],
            )}
          >
            {item.value}
          </p>
          {item.hint ? <p className="mt-1.5 text-xs text-white/45">{item.hint}</p> : null}
        </div>
      ))}
    </section>
  );
}
