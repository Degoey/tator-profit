import { ArrowUpFromLine, BadgeCheck, Lock, LogIn, Wallet } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney, toDecimal } from "@/lib/money";
import {
  WITHDRAWAL_FEE_LABEL,
  WITHDRAWAL_FEE_NOTICE,
  calculateWithdrawalFee,
} from "@/lib/withdrawal-fee";

/**
 * Public explanation of the withdrawal feature.
 *
 * Guests only ever see policy text and one illustrative example: the fee comes from
 * `calculateWithdrawalFee` (the same function the withdrawal form and the server use),
 * so the landing page can never advertise a rate the backend does not charge. No
 * balance, history or other personal data is rendered here, and the calls to action
 * point at the real signed-in surfaces (`/login?next=/withdrawal`, `/withdrawal-policy`).
 */
const EXAMPLE_GROSS = "100.00";
const EXAMPLE_CURRENCY = "USDT";

const RULES = [
  {
    icon: Wallet,
    title: "Hanya dari saldo tersedia",
    body: "Pengajuan dibatasi saldo tersedia pada akun aktif. Sistem menolak nominal yang melebihi saldo.",
  },
  {
    icon: Lock,
    title: "Dana ditahan saat pengajuan",
    body: "Nilai yang diajukan langsung dipindahkan ke dana tertahan dan kembali penuh ke saldo tersedia jika permintaan ditolak.",
  },
  {
    icon: BadgeCheck,
    title: "Satu permintaan terbuka per akun",
    body: "Permintaan baru dapat diajukan setelah permintaan sebelumnya selesai atau ditolak.",
  },
];

export function WithdrawalSection() {
  const example = calculateWithdrawalFee(toDecimal(EXAMPLE_GROSS));

  return (
    <section id="penarikan" className="border-b border-white/10 py-20">
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-5 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-4">
          <Badge variant="gold">
            <ArrowUpFromLine className="size-3.5" aria-hidden />
            Penarikan Dana
          </Badge>
          <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Penarikan dana tersedia di dalam akun, dengan biaya {WITHDRAWAL_FEE_LABEL} dari
            nominal bruto.
          </h2>
          <p className="max-w-2xl text-sm leading-relaxed text-white/65">
            Setelah akun Anda aktif dan memiliki saldo tersedia, halaman penarikan di dalam akun
            dapat dipakai untuk mengajukan pencairan dalam {EXAMPLE_CURRENCY}. Nominal bruto
            diterima apa adanya dari formulir, lalu server menghitung biaya {WITHDRAWAL_FEE_LABEL}{" "}
            dan nominal bersih secara otoritatif — angka pada formulir hanya pratinjau.
          </p>

          <ul className="space-y-2.5">
            {RULES.map((rule) => (
              <li
                key={rule.title}
                className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3"
              >
                <p className="flex items-center gap-2 text-sm font-semibold text-white">
                  <rule.icon className="size-4 text-[var(--color-neon)]" aria-hidden />
                  {rule.title}
                </p>
                <p className="mt-1.5 text-xs leading-relaxed text-white/55">{rule.body}</p>
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button asChild>
              <Link href={`/login?next=${encodeURIComponent("/withdrawal")}`}>
                <LogIn aria-hidden />
                Masuk untuk menarik dana
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/withdrawal-policy">Baca kebijakan penarikan</Link>
            </Button>
          </div>
          <p className="max-w-2xl text-xs leading-relaxed text-white/45">
            Halaman ini tidak menampilkan saldo, riwayat, atau data keuangan siapa pun. Ringkasan
            saldo dan riwayat penarikan hanya tampil setelah Anda masuk ke akun sendiri.
          </p>
        </div>

        <Card className="card-glow h-fit">
          <CardHeader>
            <CardTitle>Contoh perhitungan biaya</CardTitle>
            <CardDescription>
              Ilustrasi nominal bruto {formatMoney(example.amount.toString(), EXAMPLE_CURRENCY)}.
              Angka nyata dihitung sistem saat pengajuan dibuat.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <dl className="space-y-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-white/55">Nominal penarikan (bruto)</dt>
                <dd className="font-semibold text-white">
                  {formatMoney(example.amount.toString(), EXAMPLE_CURRENCY)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-white/55">Biaya penarikan ({WITHDRAWAL_FEE_LABEL})</dt>
                <dd className="font-semibold text-[var(--color-gold)]">
                  {formatMoney(example.fee.toString(), EXAMPLE_CURRENCY)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-white/10 pt-2">
                <dt className="text-white/55">Nominal bersih diterima</dt>
                <dd className="text-base font-semibold text-[var(--color-neon)]">
                  {formatMoney(example.netAmount.toString(), EXAMPLE_CURRENCY)}
                </dd>
              </div>
            </dl>
            <p className="text-xs leading-relaxed text-white/45">{WITHDRAWAL_FEE_NOTICE}</p>
            <p className="text-xs leading-relaxed text-white/45">
              Penarikan tidak otomatis disetujui dan tidak otomatis dibayarkan: admin memproses
              transfer secara manual, sehingga waktu penyelesaian mengikuti antrean peninjauan.
              Tidak ada jaminan waktu maupun hasil finansial.
            </p>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}