"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import * as React from "react";

export interface SiteNavLink {
  href: string;
  label: string;
  /** Optional badge value (for example the unread notification count). */
  badge?: number;
}

/**
 * Primary navigation. The desktop list is only shown from `lg` up; below that the
 * links collapse into a disclosure button so no viewport (320px and above) loses
 * access to a page. The menu closes as soon as a link is chosen.
 */
export function SiteNav({ links }: { links: SiteNavLink[] }) {
  const [open, setOpen] = React.useState(false);
  const panelId = "navigasi-utama-seluler";

  return (
    <>
      <nav aria-label="Navigasi utama" className="hidden items-center gap-6 text-sm text-white/70 lg:flex">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="flex items-center gap-1.5 whitespace-nowrap transition-colors hover:text-white"
          >
            {link.label}
            {link.badge ? (
              <span className="rounded-full bg-[var(--color-neon)]/15 px-1.5 py-0.5 text-[11px] font-semibold text-[var(--color-neon)]">
                {link.badge}
              </span>
            ) : null}
          </Link>
        ))}
      </nav>

      <div className="lg:hidden">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={open ? "Tutup menu navigasi" : "Buka menu navigasi"}
          onClick={() => setOpen((value) => !value)}
          className="grid size-9 place-items-center rounded-lg border border-white/15 bg-white/5 text-white/80 transition-colors hover:border-[var(--color-neon)]/50 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-neon)]/60"
        >
          {open ? <X className="size-4" aria-hidden /> : <Menu className="size-4" aria-hidden />}
        </button>

        {open ? (
          <nav
            id={panelId}
            aria-label="Navigasi utama (seluler)"
            className="absolute inset-x-0 top-16 max-h-[calc(100vh-4rem)] overflow-y-auto border-b border-white/10 bg-[color-mix(in_oklab,var(--color-ink)_97%,transparent)] px-5 py-4 shadow-2xl backdrop-blur-xl"
          >
            <ul className="grid gap-1">
              {links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    onClick={() => setOpen(false)}
                    className="flex items-center justify-between rounded-lg px-3 py-2.5 text-sm text-white/75 transition-colors hover:bg-white/5 hover:text-white"
                  >
                    <span>{link.label}</span>
                    {link.badge ? (
                      <span className="rounded-full bg-[var(--color-neon)]/15 px-2 py-0.5 text-[11px] font-semibold text-[var(--color-neon)]">
                        {link.badge}
                      </span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </div>
    </>
  );
}
