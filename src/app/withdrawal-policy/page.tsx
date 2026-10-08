import type { Metadata } from "next";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { statusLabel } from "@/lib/status-labels";

export const metadata: Metadata = {
  title: "Kebijakan Penarikan",
  description:
    "Kebijakan penarikan Tatorprofit dalam USDT: alur status menunggu sampai selesai, saldo ditahan saat pengajuan, satu permintaan terbuka per akun, dan pemrosesan manual oleh admin.",
};

/** Withdrawal status flow exactly as implemented by the platform. */
const STATUS_FLOW: { status: string; body: string }[] = [
  {
    status: "PENDING",
    body: "Permintaan baru dicatat dan nilai penarikan langsung ditahan dari saldo tersedia.",
  },
  {
    status: "UNDER_REVIEW",
    body: "Admin mulai memeriksa permintaan, data tujuan, dan kelayakan akun.",
  },
  {
    status: "APPROVED",
    body: "Permintaan disetujui. Dana tetap tertahan sambil menunggu proses transfer.",
  },
  {
    status: "PROCESSING",
    body: "Admin sedang menjalankan transfer manual ke tujuan yang Anda daftarkan.",
  },
  {
    status: "COMPLETED",
    body: "Transfer dinyatakan selesai dan dana tertahan didebit permanen dari cadangan.",
  },
  {
    status: "REJECTED",
    body: "Permintaan ditolak dengan alasan tertulis; seluruh dana dikembalikan ke saldo tersedia.",
  },
];

export default function WithdrawalPolicyPage() {
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
            Kebijakan Penarikan
          </h1>
          <p className="max-w-3xl text-sm leading-relaxed text-white/60">
            Kebijakan ini menjelaskan bagaimana pengajuan penarikan saldo diproses di Tatorprofit:
            alur status, penahanan dana, batas satu permintaan terbuka per akun, dan pemrosesan
            manual oleh admin tanpa gateway otomatis.
          </p>
          <Alert variant="info" title="Ringkasan singkat">
            Saat Anda mengajukan penarikan, nilai tersebut ditahan dari saldo tersedia dan berstatus
            menunggu. Admin memprosesnya secara manual sampai berstatus selesai, atau menolaknya
            sehingga dana kembali ke saldo tersedia.
          </Alert>
        </section>

        <Card>
          <CardHeader>
            <CardTitle>1. Alur status penarikan</CardTitle>
            <CardDescription>
              Urutan status: menunggu, sedang ditinjau, disetujui, sedang diproses, selesai — atau
              ditolak.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3">
              {STATUS_FLOW.map((item) => (
                <li
                  key={item.status}
                  className="border-b border-white/8 pb-3 last:border-0 last:pb-0"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="muted">{statusLabel(item.status)}</Badge>
                    <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">
                      {item.status}
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm leading-relaxed text-white/60">{item.body}</p>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>2. Saldo ditahan saat pengajuan</CardTitle>
            <CardDescription>
              Nilai penarikan dipindahkan dari saldo tersedia ke cadangan (ditahan).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-relaxed text-white/70">
            <p>
              Ketika permintaan penarikan dibuat, sistem langsung memindahkan nilai tersebut dari
              saldo tersedia ke posisi dana tertahan. Pemindahan ini tercatat sebagai dua entri buku
              besar yang hanya bertambah, sehingga jumlah saldo tetap dapat ditelusuri.
            </p>
            <p>
              Selama dana tertahan, nilai tersebut tidak dapat dipakai untuk pengajuan penarikan lain.
              Dana hanya keluar dari cadangan ketika permintaan berstatus selesai, atau kembali ke
              saldo tersedia ketika permintaan ditolak.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>3. Satu permintaan terbuka per akun</CardTitle>
            <CardDescription>
              Setiap akun hanya boleh memiliki satu permintaan penarikan yang masih berjalan.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-relaxed text-white/70">
            <p>
              Permintaan dianggap masih berjalan selama berstatus menunggu, sedang ditinjau,
              disetujui, atau sedang diproses. Selama itu, pengajuan penarikan baru tidak dapat
              dibuat untuk akun yang sama.
            </p>
            <p>
              Batas ini menjaga agar dana yang tertahan selalu dapat dipetakan ke satu permintaan
              tertentu, sehingga riwayat penarikan tetap jelas dan mudah diaudit.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>4. Diproses manual tanpa gateway otomatis</CardTitle>
            <CardDescription>
              Tidak ada transfer otomatis; admin menjalankan pembayaran secara manual.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-relaxed text-white/70">
            <p>
              Tatorprofit tidak terhubung ke gateway pembayaran, dompet otomatis, atau penyedia
              transfer pihak ketiga. Pengajuan penarikan tidak pernah otomatis disetujui dan tidak
              pernah otomatis dibayarkan.
            </p>
            <p>
              Admin meninjau permintaan, memverifikasi data tujuan, lalu menjalankan transfer secara
              manual ke rekening atau alamat yang Anda daftarkan. Karena itu, waktu penyelesaian
              bergantung pada antrean peninjauan admin.
            </p>
            <p>
              Pastikan data tujuan penarikan benar dan atas nama Anda sendiri. Kesalahan data tujuan
              menjadi tanggung jawab pengguna.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>5. Saldo tidak boleh minus</CardTitle>
            <CardDescription>
              Nilai penarikan tidak dapat melebihi saldo tersedia.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-relaxed text-white/70">
            <p>
              Sistem menolak pengajuan yang melebihi saldo tersedia, dan saldo tidak pernah boleh
              bernilai negatif. Batas ini diperiksa saat pengajuan dibuat dan dijaga juga pada tingkat
              basis data.
            </p>
            <p>
              Nilai penarikan dicatat dalam USDT dengan dua angka di belakang koma. Pengajuan dengan
              nilai nol atau nilai yang tidak valid tidak akan diproses.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>6. Penolakan mengembalikan dana</CardTitle>
            <CardDescription>
              Dana yang ditolak kembali sepenuhnya ke saldo tersedia Anda.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-relaxed text-white/70">
            <p>
              Jika permintaan ditolak, seluruh nilai yang tertahan dibebaskan dari cadangan dan
              dikembalikan ke saldo tersedia akun Anda dalam satu proses yang utuh, sehingga tidak ada
              dana yang hilang atau tertinggal.
            </p>
            <p>
              Setiap penolakan wajib disertai alasan tertulis yang dapat Anda lihat pada detail
              riwayat penarikan. Setelah dana kembali ke saldo tersedia, Anda dapat mengajukan
              permintaan penarikan baru.
            </p>
          </CardContent>
        </Card>

        <Alert variant="warning" title="Ketentuan penarikan">
          Pengajuan penarikan hanya tersedia untuk akun aktif. Penarikan tidak otomatis disetujui dan
          diproses manual oleh admin sesuai kebijakan ini.
        </Alert>
      </main>

      <SiteFooter />
    </div>
  );
}
