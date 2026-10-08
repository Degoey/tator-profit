import type { Metadata } from "next";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Syarat & Ketentuan",
  description:
    "Syarat dan ketentuan penggunaan platform pencatatan program imbalan Tatorprofit: nilai dalam USDT, target imbalan bukan jaminan hasil, dan pemrosesan manual oleh admin.",
};

export default function TermsPage() {
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
            Syarat &amp; Ketentuan
          </h1>
          <p className="max-w-3xl text-sm leading-relaxed text-white/60">
            Syarat &amp; Ketentuan ini mengatur penggunaan platform Tatorprofit. Dengan membuat akun,
            bergabung ke sebuah paket program, atau memakai layanan apa pun di platform ini, Anda
            dianggap telah membaca dan menyetujui seluruh ketentuan di bawah.
          </p>
          <Alert variant="info" title="Ringkasan singkat">
            Tatorprofit adalah platform pencatatan program imbalan. Seluruh nilai dinyatakan dalam
            USDT. Target imbalan mengikuti ketentuan program dan bukan jaminan hasil. Tidak ada
            gateway pembayaran otomatis: setoran dan penarikan diproses manual oleh admin.
          </Alert>
        </section>

        <Card>
          <CardHeader>
            <CardTitle>1. Ruang lingkup layanan</CardTitle>
            <CardDescription>
              Tatorprofit adalah platform pencatatan program imbalan, bukan lembaga keuangan.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-relaxed text-white/70">
            <p>
              Tatorprofit menyediakan pencatatan keanggotaan paket program, perhitungan target
              imbalan sesuai konfigurasi program, serta buku besar saldo yang dapat diaudit. Platform
              ini bukan bank, bukan penyelenggara transfer dana, bukan pengelola dana investasi, dan
              tidak menyediakan perdagangan aset.
            </p>
            <p>
              Seluruh pencatatan dilakukan oleh sistem berdasarkan data yang dikonfirmasi admin.
              Pengguna bertanggung jawab memastikan setiap informasi yang diberikan akurat, termasuk
              identitas, tujuan penarikan, dan bukti pembayaran yang diunggah.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>2. Seluruh nilai dalam USDT</CardTitle>
            <CardDescription>
              Nilai program dicatat dan ditampilkan dalam satuan USDT.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-relaxed text-white/70">
            <p>
              Semua nilai program — nilai gabung paket, target imbalan, komisi rujukan, saldo, dan
              nilai penarikan — dinyatakan dalam USDT. Tidak ada mata uang lain yang dipakai sebagai
              satuan pencatatan di dalam platform ini.
            </p>
            <p>
              Nilai disimpan sebagai angka desimal dengan dua angka di belakang koma, sehingga
              perhitungan imbalan tidak bergantung pada pembulatan angka pecahan biner.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>3. Target imbalan bukan jaminan hasil</CardTitle>
            <CardDescription>
              Target imbalan mengikuti ketentuan program, kualifikasi, dan aturan yang berlaku.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-relaxed text-white/70">
            <p>
              Angka target imbalan yang ditampilkan adalah hasil perhitungan dari nilai gabung dan
              tarif program yang berlaku. Angka tersebut adalah target, bukan janji, bukan jaminan,
              dan bukan kepastian penerimaan.
            </p>
            <p>
              Pencairan imbalan bergantung pada kualifikasi program, evaluasi periode siklus, dan
              persetujuan internal. Tatorprofit tidak menjamin hasil finansial dalam bentuk apa pun.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>4. Tidak ada gateway pembayaran otomatis</CardTitle>
            <CardDescription>Setoran dan penarikan diproses manual oleh admin.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-relaxed text-white/70">
            <p>
              Platform ini tidak terhubung ke gateway pembayaran, dompet otomatis, atau penyedia
              transfer pihak ketiga. Pengajuan setoran dilakukan dengan mengunggah bukti pembayaran
              yang kemudian diverifikasi admin, dan penarikan ditransfer manual oleh admin ke tujuan
              yang Anda daftarkan.
            </p>
            <p>
              Karena pemrosesan bersifat manual, waktu penyelesaian bergantung pada antrean
              peninjauan admin. Status setiap pengajuan dapat Anda pantau pada halaman deposit dan
              penarikan.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>5. Satu akun per pengguna</CardTitle>
            <CardDescription>
              Setiap pengguna hanya boleh memiliki satu akun pada platform ini.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-relaxed text-white/70">
            <p>
              Satu akun hanya boleh dimiliki dan dikendalikan oleh satu orang. Pembuatan akun ganda,
              penggunaan identitas orang lain, serta pemakaian bersama satu akun oleh beberapa orang
              tidak diperbolehkan.
            </p>
            <p>
              Nama pengguna, surel, dan nomor telepon bersifat unik dan terikat pada satu akun.
              Kerahasiaan kata sandi sepenuhnya menjadi tanggung jawab pemilik akun.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>6. Data finansial bersifat permanen</CardTitle>
            <CardDescription>
              Koreksi dilakukan dengan transaksi penyesuaian, bukan penghapusan data.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-relaxed text-white/70">
            <p>
              Buku besar platform bersifat permanen dan hanya bertambah. Catatan transaksi, riwayat
              setoran, riwayat penarikan, dan audit log tidak dapat dihapus, termasuk oleh admin.
            </p>
            <p>
              Jika terjadi kekeliruan pencatatan, koreksi dilakukan dengan menambahkan transaksi
              penyesuaian baru yang tercatat lengkap pada audit log — bukan dengan mengubah atau
              menghapus entri sebelumnya. Dengan cara ini, setiap perubahan saldo tetap dapat
              ditelusuri.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>7. Kewajiban dan tanggung jawab pengguna</CardTitle>
            <CardDescription>Perilaku yang diharapkan dari setiap pengguna.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-relaxed text-white/70">
            <p>
              Anda wajib menjaga kerahasiaan kredensial akun, tidak mengunggah bukti pembayaran
              palsu, tidak memakai platform untuk tujuan yang melanggar hukum, dan mematuhi
              peraturan yang berlaku di wilayah Anda masing-masing.
            </p>
            <p>
              Pelanggaran terhadap ketentuan ini dapat menyebabkan pembatasan, penangguhan, atau
              penutupan akses akun, dengan catatan finansial dan audit tetap disimpan sesuai
              ketentuan di atas.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>8. Perubahan ketentuan</CardTitle>
            <CardDescription>Syarat dapat diperbarui sewaktu-waktu.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-relaxed text-white/70">
            <p>
              Tatorprofit dapat memperbarui Syarat &amp; Ketentuan ini dari waktu ke waktu agar
              sesuai dengan ketentuan program dan peraturan yang berlaku. Versi terbaru selalu
              tersedia pada halaman ini.
            </p>
            <p>
              Dengan terus memakai layanan setelah pembaruan dipublikasikan, Anda dianggap
              menyetujui versi terbaru dari Syarat &amp; Ketentuan ini.
            </p>
          </CardContent>
        </Card>
      </main>

      <SiteFooter />
    </div>
  );
}
