import { FileUp, LogIn, ShieldCheck, Wallet } from "lucide-react";
import Link from "next/link";

import { DepositAddressQr } from "@/components/payments/deposit-address-qr";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Public deposit section of the landing page (`/#deposit`).
 *
 * The wallet address and its QR are money-safety data: a visitor who scans the
 * wrong network loses the transfer, so the block renders the same
 * `DepositAddressQr` used on `/deposit` (one source of truth for the address,
 * the network label and the "jangan TRC20" warning) instead of repeating the
 * address here.
 *
 * Nothing personal is rendered: no balance, no membership and no history. The
 * calls to action point at the real surfaces (`/login?next=/deposit` and
 * `/register`), and depositing stays manual — the member transfers, then uploads
 * proof that an administrator reviews.
 */
const STEPS = [
  {
    icon: Wallet,
    title: "Transfer ke dompet BEP-20",
    body: "Pindai QR di samping atau salin alamatnya utuh, lalu kirim USDT melalui jaringan BEP-20 (BNB Smart Chain). Jangan memakai TRC20/TRON, ERC-20, atau jaringan lain.",
  },
  {
    icon: FileUp,
    title: "Unggah bukti transfer",
    body: "Masuk ke akun, buka halaman Setor Dana, pilih paket gabung yang menunggu konfirmasi, lalu unggah bukti transfer (PNG, JPG, atau PDF).",
  },
  {
    icon: ShieldCheck,
    title: "Ditinjau admin",
    body: "Sistem mencatat deposit berstatus sedang ditinjau dan menyimpannya di database. Keanggotaan aktif setelah admin memverifikasi bukti.",
  },
];

export function DepositSection() {
  return (
    <section id="deposit" className="border-b border-white/10 py-20">
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-5 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-4">
          <Badge variant="gold">
            <Wallet className="size-3.5" aria-hidden />
            Setor Dana
          </Badge>
          <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Alamat setor dana terbuka sejak awal, dengan jaringan BEP-20 yang benar.
          </h2>
          <p className="max-w-2xl text-sm leading-relaxed text-white/65">
            Setoran diproses manual: tidak ada gateway pembayaran dan tidak ada dana yang berpindah
            otomatis. Alamat dompet penerima beserta QR-nya ditampilkan pada halaman ini agar Anda
            dapat memeriksanya lebih dulu, lalu bukti transfer diunggah dari dalam akun.
          </p>

          <ul className="space-y-2.5">
            {STEPS.map((step) => (
              <li
                key={step.title}
                className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3"
              >
                <p className="flex items-center gap-2 text-sm font-semibold text-white">
                  <step.icon className="size-4 text-[var(--color-neon)]" aria-hidden />
                  {step.title}
                </p>
                <p className="mt-1.5 text-xs leading-relaxed text-white/55">{step.body}</p>
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button asChild>
              <Link href={`/login?next=${encodeURIComponent("/deposit")}`}>
                <LogIn aria-hidden />
                Masuk untuk setor dana
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/register">Buat akun baru</Link>
            </Button>
          </div>
          <p className="max-w-2xl text-xs leading-relaxed text-white/45">
            Halaman ini hanya menampilkan alamat dompet publik penerima deposit. Saldo, status
            keanggotaan, dan riwayat transaksi hanya tampil setelah Anda masuk ke akun sendiri.
          </p>
        </div>

        <Card className="card-glow h-fit">
          <CardHeader>
            <CardTitle>Dompet penerima deposit</CardTitle>
            <CardDescription>
              Pindai barcode untuk alamat yang sama dengan teks di bawahnya, atau salin alamatnya
              utuh tanpa mengubah huruf besar/kecil.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <DepositAddressQr />
            <p className="text-xs leading-relaxed text-white/45">
              Deposit selalu dicatat menunggu konfirmasi dana karena tidak ada gateway pembayaran
              otomatis: status berubah hanya setelah admin memverifikasi bukti transfer. Tidak ada
              jaminan waktu penyelesaian maupun hasil finansial.
            </p>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
