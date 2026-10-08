import type { Metadata } from "next";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Kebijakan Privasi",
  description:
    "Kebijakan privasi Tatorprofit: data yang disimpan, tujuan pemakaian, penyimpanan kata sandi sebagai hash bcrypt, dan permintaan penghapusan data melalui admin.",
};

/** Data categories stored by the platform, mirrored from the database schema. */
const STORED_DATA: { label: string; body: string }[] = [
  {
    label: "Nama",
    body: "Nama tampilan pada profil, dipakai untuk identifikasi akun dan kebutuhan verifikasi manual.",
  },
  {
    label: "Nama pengguna",
    body: "Nama pengguna unik yang menjadi identitas masuk dan rujukan akun.",
  },
  {
    label: "Surel",
    body: "Alamat surel unik untuk masuk, verifikasi, dan komunikasi terkait akun.",
  },
  {
    label: "Nomor telepon",
    body: "Nomor telepon unik sebagai data kontak akun.",
  },
  {
    label: "Hash kata sandi",
    body: "Kata sandi disimpan sebagai hash bcrypt; kata sandi asli tidak pernah disimpan.",
  },
  {
    label: "Profil",
    body: "Kode rujukan, data wilayah (negara, kota, alamat, kode pos), zona waktu, dan pengaturan bahasa.",
  },
  {
    label: "Sesi",
    body: "Sesi masuk disimpan sebagai hash token, disertai alamat IP, user agent, dan waktu kedaluwarsa.",
  },
  {
    label: "Peristiwa keamanan",
    body: "Catatan peristiwa keamanan akun, termasuk waktu, alamat IP, dan user agent perangkat.",
  },
  {
    label: "Audit log",
    body: "Jejak tindakan penting pada akun, termasuk transaksi, peninjauan admin, dan perubahan status.",
  },
];

export default function PrivacyPage() {
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
            Kebijakan Privasi
          </h1>
          <p className="max-w-3xl text-sm leading-relaxed text-white/60">
            Kebijakan Privasi ini menjelaskan data apa yang disimpan Tatorprofit, untuk apa data
            tersebut dipakai, bagaimana data sensitif dilindungi, dan bagaimana Anda dapat mengajukan
            permintaan terkait data pribadi Anda.
          </p>
          <Alert variant="info" title="Ringkasan singkat">
            Kami menyimpan data akun dan catatan transaksi untuk menjalankan layanan pencatatan
            program imbalan. Kata sandi hanya disimpan sebagai hash bcrypt. Bukti transfer disimpan
            secara privat dan hanya dapat dibuka oleh admin berwenang.
          </Alert>
        </section>

        <Card>
          <CardHeader>
            <CardTitle>1. Data yang disimpan</CardTitle>
            <CardDescription>
              Data berikut tersimpan di database platform saat Anda memakai layanan ini.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3">
              {STORED_DATA.map((item) => (
                <div
                  key={item.label}
                  className="border-b border-white/8 pb-3 last:border-0 last:pb-0"
                >
                  <dt className="text-sm font-semibold text-white">{item.label}</dt>
                  <dd className="mt-1 text-sm leading-relaxed text-white/60">{item.body}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>2. Tujuan pemakaian data</CardTitle>
            <CardDescription>
              Data dipakai hanya untuk keperluan operasional berikut.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-relaxed text-white/70">
            <p>
              Pembuatan dan pengelolaan akun, autentikasi masuk, serta pemulihan akses. Pencatatan
              keanggotaan paket program, target imbalan, dan komisi rujukan dalam satuan USDT.
              Verifikasi manual setoran dan pemrosesan manual penarikan oleh admin.
            </p>
            <p>
              Pemeliharaan keamanan platform: pencatatan peristiwa keamanan, pembatasan laju
              permintaan, dan audit log atas tindakan yang memengaruhi saldo. Pemenuhan kewajiban
              hukum dan penanganan sengketa bila diperlukan.
            </p>
            <p>
              Kami tidak menjual data pribadi Anda dan tidak memakainya untuk keperluan di luar
              penyelenggaraan layanan ini.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>3. Penyimpanan kata sandi</CardTitle>
            <CardDescription>Kata sandi selalu disimpan sebagai hash bcrypt.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-relaxed text-white/70">
            <p>
              Kata sandi Anda tidak pernah disimpan dalam bentuk teks asli. Sistem menyimpan hash
              bcrypt beserta salt-nya, sehingga kata sandi tidak dapat dibaca kembali oleh siapa pun,
              termasuk admin.
            </p>
            <p>
              Proses masuk hanya membandingkan hash dari kata sandi yang Anda masukkan. Jika Anda
              lupa kata sandi, gunakan alur pemulihan kata sandi yang tersedia — bukan meminta admin
              membacakan kata sandi lama.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>4. Bukti transfer dan berkas unggahan</CardTitle>
            <CardDescription>
              Bukti pembayaran disimpan privat dan hanya dibuka admin berwenang.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-relaxed text-white/70">
            <p>
              Berkas bukti transfer disimpan di direktori privat di luar area publik website, dengan
              nama berkas acak yang tidak dapat memengaruhi lokasi penyimpanan. Hanya format PNG,
              JPEG, dan PDF yang diterima.
            </p>
            <p>
              Berkas tersebut tidak dapat diakses melalui tautan publik. Pembukaan berkas hanya
              dilakukan melalui rute terautentikasi dan hanya oleh admin berwenang yang memerlukan
              berkas itu untuk memverifikasi pengajuan Anda.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>5. Keamanan dan masa simpan data</CardTitle>
            <CardDescription>Perlindungan data dan jangka waktu penyimpanan.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-relaxed text-white/70">
            <p>
              Akses ke data dibatasi sesuai peran. Setiap tindakan admin atas setoran, penarikan,
              dan penyesuaian saldo tercatat pada audit log beserta waktu dan identitas pelakunya.
            </p>
            <p>
              Data akun disimpan selama akun aktif. Catatan finansial, riwayat pengajuan, dan audit
              log bersifat permanen sesuai Syarat &amp; Ketentuan, karena dibutuhkan untuk
              ketertelusuran saldo dan penyelesaian sengketa.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>6. Permintaan akses dan penghapusan data</CardTitle>
            <CardDescription>Permintaan penghapusan data diajukan melalui admin.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-relaxed text-white/70">
            <p>
              Anda dapat mengajukan permintaan untuk melihat, memperbarui, atau menghapus data
              pribadi Anda dengan menghubungi admin melalui kanal dukungan yang tersedia. Admin akan
              memverifikasi identitas pemilik akun sebelum memproses permintaan tersebut.
            </p>
            <p>
              Permintaan yang dapat dipenuhi mencakup perbaikan data profil dan penghapusan data
              profil opsional. Catatan finansial, riwayat pengajuan, dan audit log tidak dapat
              dihapus karena bersifat permanen; permintaan atas data tersebut akan ditanggapi dengan
              penjelasan tertulis.
            </p>
          </CardContent>
        </Card>

        <Alert variant="warning" title="Catatan penting">
          Jangan pernah mengirimkan kata sandi Anda kepada siapa pun, termasuk pihak yang mengaku
          sebagai admin. Admin tidak pernah meminta kata sandi Anda.
        </Alert>
      </main>

      <SiteFooter />
    </div>
  );
}
