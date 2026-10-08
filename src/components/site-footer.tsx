import { ShieldCheck } from "lucide-react";
import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="border-t border-white/10 py-10">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-5 md:flex-row md:items-center md:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-lg border border-[var(--color-neon)]/40 bg-[var(--color-neon)]/10">
              <ShieldCheck className="size-4 text-[var(--color-neon)]" aria-hidden />
            </span>
            <span className="text-sm font-semibold text-white">
              Tator<span className="text-neon">profit</span>
            </span>
          </div>
          <p className="max-w-xl text-xs leading-relaxed text-white/45">
            Imbalan mengikuti ketentuan program dan bukan jaminan hasil. Nilai program dinyatakan
            dalam USDT. Platform ini tidak menyediakan gateway pembayaran atau klaim keuntungan
            otomatis.
          </p>
        </div>

        <nav className="flex flex-wrap items-center gap-5 text-xs text-white/55">
          <Link href="/#tiers" className="transition-colors hover:text-white">
            Pilihan Paket
          </Link>
          <Link href="/#program" className="transition-colors hover:text-white">
            Ketentuan Program
          </Link>
          <Link href="/register" className="transition-colors hover:text-white">
            Daftar
          </Link>
          <Link href="/login" className="transition-colors hover:text-white">
            Masuk
          </Link>
          <Link href="/terms" className="transition-colors hover:text-white">
            Syarat &amp; Ketentuan
          </Link>
          <Link href="/privacy" className="transition-colors hover:text-white">
            Kebijakan Privasi
          </Link>
          <Link href="/risk-disclosure" className="transition-colors hover:text-white">
            Pengungkapan Risiko
          </Link>
          <Link href="/withdrawal-policy" className="transition-colors hover:text-white">
            Kebijakan Penarikan
          </Link>
        </nav>
      </div>
    </footer>
  );
}
