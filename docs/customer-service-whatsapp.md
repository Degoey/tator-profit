# Customer Service WhatsApp (Bagian 8/8)

Layanan pelanggan Tatorprofit berjalan **hanya melalui WhatsApp**. Dokumen ini menjelaskan
konfigurasi, lokasi tombol, isi pesan awal, batas privasi, serta apa yang sengaja **tidak**
dibangun.

Semua pernyataan di bawah merujuk pada kode di repositori ini: `src/lib/config/support.ts`,
`src/components/support/*`, `tests/customer-service.test.ts`, dan tiga permukaan yang
memasang tombolnya.

## 1. Ringkasan keputusan

| Keputusan | Alasan |
| --- | --- |
| WhatsApp saja | Percakapan berjalan di aplikasi yang sudah dipakai pengguna, dengan riwayat milik pengguna sendiri. |
| Tanpa sistem tiket | Tidak ada nomor tiket, status tiket, antrean, SLA, atau penugasan agen yang perlu dirawat. |
| Tanpa live chat | Tidak ada koneksi realtime, soket, maupun widget pihak ketiga. |
| Tanpa riwayat percakapan | Tidak ada tabel pesan, lampiran, atau transkrip di dalam aplikasi. |
| Satu sumber kebenaran | Nomor, validasi, dan pesan awal hanya didefinisikan sekali di `src/lib/config/support.ts`. |
| Satu tombol per halaman | Setiap permukaan memasang tepat satu tombol agar tidak ada ajakan ganda yang membingungkan. |

## 2. Konfigurasi nomor

Satu variabel lingkungan publik mengisi seluruh permukaan:

```bash
# .env (contoh format, ganti dengan nomor sungguhan)
NEXT_PUBLIC_WHATSAPP_CS_NUMBER="6281234567890"
```

Aturan format:

- Hanya angka; tanda `+`, spasi, tanda hubung, dan tanda kurung boleh ditulis tetapi dibuang
  saat normalisasi.
- Format internasional: kode negara lebih dulu, panjang 8-15 digit, dan tidak dimulai angka `0`.
- Nomor lokal Indonesia `0812-3456-7890` otomatis dinormalkan menjadi `6281234567890`.
- Nilai yang tidak masuk akal (`62xxxxxxxxxx`, `62812`, `abc`, kosong) dianggap **tidak
  dikonfigurasi**: tidak ada tautan yang dibentuk.

Perilaku saat nomor tidak valid atau belum diisi:

| Lingkungan | Yang dirender |
| --- | --- |
| Pengembangan (`NODE_ENV !== "production"`) | Keterangan konfigurasi yang menyebut nama variabel dan contoh format, tanpa tautan. |
| Produksi | Tidak ada apa pun: tombol dan kartu bantuan disembunyikan. |

Konsekuensinya aplikasi tidak pernah menghasilkan tautan `wa.me` kosong, salah nomor, atau
nomor contoh. Setelah nomor diisi, jalankan ulang proses build/start agar nilai baru terbaca.

## 3. Lokasi tombol

| Permukaan | Berkas | Komponen | Penanda |
| --- | --- | --- | --- |
| Beranda (hero, deretan aksi) | `src/app/page.tsx` | `WhatsAppCustomerServiceButton` (`size="lg"`, `variant="ghost"`) | `data-customer-service="beranda"` |
| Dasbor (deretan aksi cepat) | `src/app/dashboard/page.tsx` | `WhatsAppCustomerServiceButton` (`size="sm"`, `variant="ghost"`) | `data-customer-service="dasbor"` |
| Profil (kartu bantuan) | `src/app/profile/page.tsx` | `CustomerServiceCard` berisi tombolnya | `data-customer-service="profil"` |

Ketiganya memanggil `getCustomerServiceConfig({ topic, username })` di server lalu meneruskan
`link` dan `fallback` sebagai prop. Komponennya sendiri tidak pernah membaca database, tidak
memanggil API, dan tidak menyimpan keadaan apa pun: `href` yang tidak valid berarti tidak ada
tautan.

## 4. Pesan awal

Pesan dibentuk oleh `buildCustomerServiceMessage` dan di-URL-encode ke dalam tautan:

```text
Halo Customer Service Tatorprofit, saya membutuhkan bantuan.
Aplikasi: Tatorprofit
Kategori bantuan: Bantuan umum
Nama pengguna: demo_member
Terima kasih.
```

- Baris `Nama pengguna` hanya muncul di permukaan yang sudah login (dasbor dan profil).
- Kategori bantuan bawaan adalah `Bantuan umum`; profil memakai `Akun & keamanan`.
- Pesan **tidak pernah** memuat kata sandi, OTP, token, atau PIN.
- Pesan hanya mengisi kolom ketik WhatsApp. Pengguna tetap menekan tombol kirim sendiri:
  tidak ada pesan yang terkirim otomatis.

Kategori yang ditampilkan pada kartu bantuan didefinisikan di `SUPPORT_TOPICS`: Bantuan umum,
Setoran dana, Penarikan dana, Paket program & keanggotaan, Imbalan & target, Rujukan & komisi,
Akun & keamanan.

## 5. Keamanan dan privasi

- Tautan dibuka di tab baru dengan `rel="noopener noreferrer"`.
- Nomor customer service bersifat publik karena ikut terkirim ke peramban. Jangan memakai nomor
  pribadi atau nomor yang juga dipakai untuk menerima OTP.
- Tidak ada data percakapan yang dikirim ke server Tatorprofit, sehingga tidak ada transkrip
  yang bisa bocor dari basis data.
- Kartu bantuan mengingatkan pengguna untuk tidak pernah mengirim kata sandi, OTP, atau token
  kepada siapa pun, termasuk Customer Service.
- Validasi nomor menolak nilai kosong, berhuruf, terlalu pendek, dan awalan nol ganda (`620…`),
  sehingga salah tulis konfigurasi tidak pernah menghasilkan tautan rusak.

## 6. Yang sengaja tidak dibuat

Agar tidak ada salah paham saat meninjau repositori ini:

- Tidak ada sistem tiket: tidak ada model tiket, status tiket, prioritas, maupun lampiran.
- Tidak ada live chat, soket, atau widget dukungan pihak ketiga.
- Tidak ada riwayat percakapan, daftar pesan, atau kotak pesan internal.
- Tidak ada API baru untuk customer service: tidak ada route `/api/support/*`.
- Tidak ada panel agen, penugasan petugas, atau jam operasional di dalam aplikasi.
- Tidak ada formulir kontak di dalam aplikasi: satu-satunya kanal adalah WhatsApp.

## 7. Cara menguji

Otomatis:

```bash
npm test          # termasuk tests/customer-service.test.ts (17 pengujian)
npm run lint
npm run typecheck
npm run build
```

`tests/customer-service.test.ts` menguji normalisasi nomor (termasuk `08…` menjadi `62…` dan
penolakan `620…`), pesan yang tidak memuat rahasia, tautan `wa.me` dengan pesan ter-URL-encode,
perilaku tanpa konfigurasi (`notice` pada pengembangan, `hidden` pada produksi), serta hasil
render server tombol dan kartu bantuan.

Manual di peramban:

1. Isi `NEXT_PUBLIC_WHATSAPP_CS_NUMBER` dengan nomor uji Anda sendiri, lalu jalankan `npm run dev`.
2. Buka `/` (beranda), `/dashboard`, dan `/profile`. Pastikan masing-masing menampilkan tepat
   satu tombol "Hubungi Customer Service".
3. Klik tombolnya: tab baru terbuka ke `wa.me` dengan pesan awal yang sudah terisi dan siap
   diedit. Tidak ada pesan yang terkirim sebelum Anda menekan kirim.
4. Hapus nilai variabel lingkungan lalu mulai ulang: pada pengembangan muncul keterangan
   konfigurasi tanpa tautan, dan pada produksi (`npm run build && npm start`) tidak ada tombol
   maupun kartu bantuan yang tampil.

## 8. Batasan yang diketahui

- Mengganti nomor berarti mengubah variabel lingkungan dan menjalankan ulang proses; nomor tidak
  dapat diatur dari antarmuka admin.
- Tidak ada penjadwalan jam operasional, sapaan otomatis, atau pengalihan ke agen lain di dalam
  aplikasi: semuanya berjalan di WhatsApp.
- Identitas agen tidak diverifikasi aplikasi; keaslian kanal bergantung pada kerahasiaan nomor
  yang dipublikasikan.
- Tombol pada dasbor dan profil hanya tampil untuk pengguna yang sudah masuk, sedangkan tombol
  beranda tampil untuk semua pengunjung.

