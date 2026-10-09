import { Share2 } from "lucide-react";
import type { Metadata } from "next";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { REFERRAL_LEVEL_RATES } from "@/lib/config/referral";
import { formatRate } from "@/lib/money";

export const metadata: Metadata = {
  title: "Ketentuan Rujukan",
  description:
    "Ketentuan Program rujukan Tatorprofit: lima tingkat komisi (10%, 2%, 1%, 1%, 1%), komisi hanya dari transaksi program yang memenuhi syarat, dan risiko program.",
};

export default function ReferralTermsPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <main className="mx-auto w-full max-w-4xl flex-1 space-y-8 px-5 py-10">
        <section className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>Dokumen resmi</Badge>
            <Badge variant="muted">Berlaku untuk seluruh pengguna</Badge>
            <Badge variant="gold">Semua nilai dalam USDT</Badge>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Ketentuan Rujukan
          </h1>
          <p className="max-w-3xl text-sm leading-relaxed text-white/60">
            Ketentuan ini menjelaskan bagaimana Program rujukan Tatorprofit bekerja: struktur lima
            tingkat, syarat kelayakan komisi, dan risiko yang perlu Anda pahami. Ketentuan ini bagian
            dari Ketentuan Program yang berlaku di platform.
          </p>
          <Alert variant="info" title="Ringkasan singkat">
            Komisi rujukan hanya lahir dari peristiwa transaksi program yang memenuhi syarat dan sudah
            tercatat di buku besar. Pendaftaran saja tidak menghasilkan komisi, dan tidak ada jumlah
            komisi yang dijamin.
          </Alert>
        </section>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Share2 className="size-4 text-[var(--color-neon)]" aria-hidden />
              1. Struktur lima tingkat
            </CardTitle>
            <CardDescription>
              Tarif komisi diambil dari konfigurasi terpusat platform, bukan dari input pengguna.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-3 sm:grid-cols-2">
              {REFERRAL_LEVEL_RATES.map((entry) => (
                <li
                  key={entry.level}
                  className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-sm"
                >
                  <span className="text-white/80">
                    Tingkat {entry.level} · {entry.label}
                  </span>
                  <span className="font-semibold text-[var(--color-neon)]">
                    {formatRate(entry.rate)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>2. Kelayakan Reward rujukan</CardTitle>
            <CardDescription>Syarat yang harus dipenuhi sebelum komisi tercatat.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-relaxed text-white/70">
            <p>
              Komisi hanya dihitung dari transaksi program yang memenuhi syarat: dana program yang
              sudah dikonfirmasi admin dan tercatat di buku besar. Setiap komisi menyimpan sumber
              transaksinya, sehingga tidak ada komisi tanpa jejak peristiwa.
            </p>
            <p>
              Satu akun penerima hanya dibayar satu kali untuk satu peristiwa sumber, dan tingkat di
              luar satu sampai lima tidak memperoleh komisi. Akun yang ditangguhkan tidak termasuk
              jaringan yang memenuhi syarat.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>3. Hubungan rujukan bersifat tetap</CardTitle>
            <CardDescription>Dicatat satu kali dan tidak dapat diubah sendiri.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-relaxed text-white/70">
            <p>
              Hubungan rujukan dicatat saat pendaftaran dan menjadi bagian riwayat akun. Perubahan
              hubungan resmi hanya dapat dilakukan melalui proses admin yang tercatat pada jejak
              audit.
            </p>
            <p>
              Kode rujukan tidak boleh diperjualbelikan, disebarkan dengan klaim keuntungan pasti,
              atau dipakai untuk membentuk lingkaran rujukan. Sistem menolak hubungan yang membentuk
              lingkaran.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>4. Risiko Program</CardTitle>
            <CardDescription>Baca sebelum mengikuti Program rujukan.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-relaxed text-white/70">
            <p>
              Program rujukan bukan sumber penghasilan tetap dan bukan jaminan pendapatan. Nilai
              komisi bergantung pada aktivitas jaringan Anda dan pada kelayakan transaksi yang
              benar-benar terjadi.
            </p>
            <p>
              Tidak ada klaim &quot;profit pasti&quot;, &quot;100% dijamin&quot;, atau &quot;tanpa
              risiko&quot; pada dokumen ini maupun pada materi promosi mana pun. Jangan memakai dana
              yang tidak siap Anda risikokan.
            </p>
          </CardContent>
        </Card>

        <Alert variant="warning" title="Batas dokumen ini">
          Dokumen ini menjelaskan ketentuan teknis dan operasional platform. Dokumen ini bukan nasihat
          hukum, bukan nasihat investasi, dan tidak menggantikan peninjauan hukum profesional. Untuk
          keputusan yang bersifat legal, pajak, atau keuangan, mintalah pendapat penasihat profesional
          independen.
        </Alert>
      </main>

      <SiteFooter />
    </div>
  );
}
