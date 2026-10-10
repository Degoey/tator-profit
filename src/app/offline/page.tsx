import { Smartphone } from "lucide-react";
import Link from "next/link";
import type { Metadata } from "next";

import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = {
  title: "Tidak ada koneksi",
  description: "Halaman cadangan saat perangkat tidak memiliki koneksi internet.",
};

/**
 * Offline fallback served by `public/sw.js` when a navigation fails.
 *
 * It is intentionally outside the authenticated area: the service worker must
 * be able to answer without a session, and it deliberately holds no data. An
 * administrator can never mistake this screen for live numbers.
 */
export default function OfflinePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-5 py-16">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-2xl border border-[var(--color-neon)]/40 bg-[var(--color-neon)]/10">
            <Smartphone className="size-6 text-[var(--color-neon)]" aria-hidden />
          </span>

          <h1 className="mt-5 text-xl font-semibold tracking-tight text-white">
            Perangkat sedang tanpa koneksi
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-white/60">
            Panel administrasi selalu menampilkan data langsung dari server, jadi halaman ini tidak
            menyimpan salinan angka apa pun. Sambungkan kembali internet lalu buka ulang aplikasi.
          </p>

          <Link
            href="/admin"
            className="mt-6 inline-flex h-11 items-center justify-center rounded-xl bg-[var(--color-neon)] px-5 text-sm font-semibold text-[#04120a] transition-all hover:brightness-110"
          >
            Coba lagi
          </Link>
        </div>
      </main>
    </div>
  );
}
