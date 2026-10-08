import type { Metadata } from "next";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Pengungkapan Risiko",
  description:
    "Pengungkapan risiko Tatorprofit: target imbalan bukan jaminan keuntungan, bukan produk investasi, tanpa garansi hasil finansial, dengan seluruh nilai program dalam USDT.",
};

export default function RiskDisclosurePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <main className="mx-auto w-full max-w-4xl flex-1 space-y-8 px-5 py-10">
        <section className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>Dokumen resmi</Badge>
            <Badge variant="muted">Wajib dibaca sebelum bergabung</Badge>
            <Badge variant="gold">Semua nilai dalam USDT</Badge>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Pengungkapan Risiko
          </h1>
          <p className="max-w-3xl text-sm leading-relaxed text-white/60">
            Halaman ini menjelaskan risiko yang perlu Anda pahami sebelum bergabung ke paket program
            di Tatorprofit. Bacalah dengan saksama dan pastikan Anda memahami seluruh isinya.
          </p>
          <Alert variant="danger" title="Pernyataan utama">
            Target imbalan bukan jaminan keuntungan. Tatorprofit bukan produk investasi dan tidak
            memberikan garansi hasil finansial dalam bentuk apa pun.
          </Alert>
        </section>

        <Card>
          <CardHeader>
            <CardTitle>1. Target imbalan bukan jaminan keuntungan</CardTitle>
            <CardDescription>
              Angka target hanya perhitungan, bukan janji penerimaan.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-relaxed text-white/70">
            <p>
              Seluruh angka imbalan yang ditampilkan pada halaman program adalah target yang dihitung
              dari nilai gabung dan tarif program yang berlaku. Target tersebut tidak menjamin bahwa
              Anda akan menerima imbalan sebesar itu, atau menerima imbalan sama sekali.
            </p>
            <p>
              Pencairan imbalan bergantung pada kualifikasi program, evaluasi periode siklus,
              ketersediaan dana program, dan persetujuan internal. Nilai yang benar-benar dibayarkan
              dapat berbeda dari target yang ditampilkan.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>2. Bukan produk investasi</CardTitle>
            <CardDescription>
              Platform ini adalah sistem pencatatan program imbalan, bukan pengelola dana.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-relaxed text-white/70">
            <p>
              Tatorprofit tidak menawarkan efek, reksa dana, kontrak investasi kolektif, atau produk
              investasi lain yang diawasi otoritas pasar modal. Tidak ada pengelolaan dana investasi,
              tidak ada imbal hasil yang dijanjikan, dan tidak ada jaminan modal kembali.
            </p>
            <p>
              Keikutsertaan Anda tidak menciptakan hubungan investasi, kepemilikan saham, atau
              kepemilikan aset apa pun pada Tatorprofit.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>3. Tidak ada garansi hasil finansial</CardTitle>
            <CardDescription>
              Hasil yang Anda terima dapat berbeda, lebih kecil, atau tidak ada sama sekali.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-relaxed text-white/70">
            <p>
              Tatorprofit tidak memberikan garansi atas hasil finansial, tidak menjamin keuntungan
              minimum, dan tidak menjanjikan pengembalian nilai gabung. Setiap pengajuan penarikan
              ditinjau secara manual dan dapat ditolak dengan alasan tertulis.
            </p>
            <p>
              Kinerja program pada masa lalu, simulasi, maupun contoh perhitungan pada halaman
              program tidak dapat dijadikan dasar untuk memperkirakan hasil di masa depan.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>4. Nilai program dalam USDT dan risiko pasar</CardTitle>
            <CardDescription>
              Seluruh nilai dinyatakan dalam USDT, bukan mata uang fiat.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-relaxed text-white/70">
            <p>
              Semua nilai program dicatat dalam USDT. Nilai USDT dapat berfluktuasi terhadap mata
              uang lain, sehingga jumlah yang Anda terima setelah penukaran dapat berbeda dari
              perhitungan awal dalam satuan USDT.
            </p>
            <p>
              Anda menanggung risiko pasar dan risiko likuiditas, termasuk kemungkinan keterlambatan
              pemrosesan atau perbedaan nilai saat dana dikonversi ke mata uang pilihan Anda.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>5. Risiko regulasi</CardTitle>
            <CardDescription>
              Aturan yang berlaku di wilayah Anda dapat berbeda dan berubah.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-relaxed text-white/70">
            <p>
              Perlakuan hukum atas aset kripto dan program imbalan berbeda di setiap yurisdiksi dan
              dapat berubah sewaktu-waktu. Perubahan regulasi dapat memengaruhi ketersediaan layanan,
              pemrosesan penarikan, atau kewajiban perpajakan Anda.
            </p>
            <p>
              Anda bertanggung jawab memastikan bahwa keikutsertaan Anda tidak melanggar peraturan
              yang berlaku di wilayah Anda, termasuk kewajiban pelaporan dan pembayaran pajak atas
              penerimaan yang Anda terima.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>6. Keputusan bergabung adalah tanggung jawab pengguna</CardTitle>
            <CardDescription>
              Pertimbangkan dengan cermat sebelum menentukan pilihan.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-relaxed text-white/70">
            <p>
              Keputusan untuk bergabung ke paket program sepenuhnya merupakan keputusan dan tanggung
              jawab Anda sendiri. Tatorprofit tidak memberikan nasihat keuangan, nasihat investasi,
              maupun nasihat hukum.
            </p>
            <p>
              Gunakan hanya dana yang siap Anda risikokan, dan bila perlu konsultasikan keputusan Anda
              dengan penasihat keuangan independen. Jangan bergabung atas dasar tekanan pihak lain
              atau janji keuntungan dari siapa pun.
            </p>
          </CardContent>
        </Card>

        <Alert variant="warning" title="Persetujuan pengguna">
          Dengan bergabung ke paket program, Anda menyatakan telah membaca, memahami, dan menerima
          seluruh pengungkapan risiko di halaman ini.
        </Alert>
      </main>

      <SiteFooter />
    </div>
  );
}
