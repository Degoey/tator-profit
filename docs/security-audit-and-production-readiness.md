# Audit Keamanan dan Kesiapan Produksi (Bagian 7/7)

Dokumen ini merangkum audit keamanan yang benar-benar dijalankan pada tahap 7/7,
perbaikan yang diterapkan, batas audit, serta daftar persyaratan yang masih harus
dipenuhi sebelum menerima dana publik.

Semua klaim di sini merujuk pada kode yang ada di repositori ini. Audit ini adalah
pemeriksaan manual berbasis pembacaan kode dan pengujian yang tersedia; audit ini
**bukan** pengujian penetrasi independen dan **tidak** menyimpulkan bahwa aplikasi
"sepenuhnya aman".

## 1. Cakupan yang diaudit

| Area | Bukti yang diperiksa |
| --- | --- |
| Autentikasi | `src/lib/services/auth-service.ts`, `src/lib/auth/password.ts`, `src/app/api/auth/*` |
| Sesi & cookie | `src/lib/auth/session.ts`, `src/lib/auth/tokens.ts` |
| Otorisasi admin | `src/lib/auth/admin-permissions.ts`, `src/lib/auth/admin-guard.ts`, `src/lib/auth/current-user.ts` |
| Otorisasi transaksi | `src/lib/services/manual-payment-service.ts`, `admin-credit-service.ts`, `reward-service.ts`, `program-service.ts` |
| IDOR | `src/app/api/deposits/[id]/proof/route.ts`, `src/app/api/withdrawals/[id]/proof/route.ts`, `src/app/api/referral/route.ts`, seluruh route `/api/*` |
| Validasi input | `src/lib/validation.ts`, `src/lib/payment-validation.ts`, `src/lib/payment-proof.ts` |
| Unggahan berkas | `src/lib/payment-proof.ts` (tipe, ekstensi, magic byte, ukuran) |
| Rate limit | `src/lib/rate-limit.ts`, route `login`, `register`, `forgot-password`, `reset-password` |
| CSRF / origin | `src/lib/request-origin.ts` dan seluruh route mutasi |
| Ledger & audit | `src/lib/services/ledger-service.ts`, `src/lib/security.ts`, migrasi trigger |
| Rahasia | `.gitignore`, `git ls-files`, `.env.example` |

## 2. Temuan dan perbaikan pada tahap ini

1. **Rate limit dapat dipalsukan lewat `X-Forwarded-For`.** Sebelumnya alamat klien
   selalu diambil dari header tersebut, sehingga penyerang dapat mengganti nilainya
   pada setiap permintaan untuk menghindari batas login/pendaftaran.
   *Perbaikan:* header itu kini hanya dipercaya bila operator menyalakan
   `TRUST_PROXY_HEADERS=1` (berarti ada reverse proxy tepercaya yang menimpanya).
   Tambahan pertahanan: login juga dibatasi per akun (`login-id:<identifier>`), yang
   tidak dapat dipalsukan dengan header apa pun.
2. **Peta rate limit tidak dibatasi.** Penyerang dapat menumbuhkan jumlah kunci tanpa
   batas. *Perbaikan:* `MAX_BUCKETS = 10.000`; saat penuh, bucket kedaluwarsa
   dibersihkan lebih dulu, dan bila masih penuh permintaan ditolak sementara
   (fail closed) alih-alih menumbuhkan memori.
3. **Token reset kata sandi dikembalikan oleh API** setiap kali `NODE_ENV !==
   "production"`, yang juga mencakup staging/preview. *Perbaikan:* token hanya
   dikembalikan bila pengalih lokal eksplisit `ALLOW_DEV_RESET_TOKEN=1` menyala dan
   `NODE_ENV` bukan `production`. Secara default API tidak pernah mengembalikan
   kredensial reset.
4. **Tidak ada halaman UI untuk menyelesaikan reset kata sandi.** *Perbaikan:*
   halaman `/reset-password` beserta formulirnya ditambahkan dan dihubungkan dari
   `/forgot-password`, sehingga alur pemulihan akun tidak lagi berhenti di pesan
   "gunakan API".
5. **Badan JSON tidak dibatasi.** *Perbaikan:* `readJsonBody` menolak payload di atas
   64 KiB (memeriksa `Content-Length` dan panjang isi sebenarnya) sebelum parsing,
   sehingga permintaan besar tidak dapat memaksa alokasi memori.
6. **Sebagian endpoint mutasi belum memeriksa origin.** *Perbaikan:* pemeriksaan
   same-origin kini juga diterapkan pada `/api/auth/login`, `/api/auth/register`,
   `/api/auth/forgot-password`, `/api/auth/reset-password`, `/api/auth/logout`, dan
   `PATCH /api/profile` — semua route mutasi kini memakai satu kebijakan yang sama.
7. **Kemampuan `manageUsers` belum punya antarmuka.** *Perbaikan:* kartu "Peran
   administrator" pada `/admin`, hanya dimuat untuk SUPER_ADMIN (daftar administrator
   tidak pernah dimuat untuk peran lain).
8. **Sebagian label UI belum konsisten Bahasa Indonesia dan navigasi seluler belum
   ada.** *Perbaikan:* menu navigasi seluler (disclosure) ditambahkan sehingga seluruh
   halaman terjangkau pada 320–1023 px, label "Deposit" menjadi "Setor Dana", dan
   teks kontras rendah dinaikkan agar terbaca.


## 3. Kontrol yang diverifikasi sudah benar

- Kata sandi di-hash bcrypt (12 salt rounds); hash tidak pernah dikembalikan API.
- Sesi disimpan di database dengan token acak 256-bit; hanya HMAC-SHA256 dari token
  yang disimpan; cookie `httpOnly`, `SameSite=Lax`, `Secure` di produksi.
- Reset kata sandi mencabut seluruh sesi dan token hanya sekali pakai.
- Peran admin dibaca ulang dari database **di dalam** transaksi finansial; peran null
  gagal tertutup (fail closed); SUPER_ADMIN tidak dapat menurunkan dirinya sendiri.
- IDOR: bukti setoran hanya dapat diunduh pemiliknya atau peran dengan `readProof`;
  endpoint rujukan menolak seluruh parameter kueri; semua permintaan pengguna memakai
  `session.userId`.
- Unggahan bukti: MIME + ekstensi + magic byte harus cocok, ukuran dihitung dari
  aliran byte (bukan `Content-Length`), nama berkas dipilih server, disimpan di luar
  `public/`, diunduh sebagai `attachment` dengan `nosniff` dan `CSP: sandbox`. Berlaku
  untuk bukti setoran (`/api/deposits/[id]/proof`) dan bukti transfer penarikan
  (`/api/withdrawals/[id]/proof`), keduanya memeriksa kepemilikan atau izin `readProof`.
- Uang tidak pernah melewati `float`: validasi string desimal + `Prisma.Decimal`
  dengan skala 2/4 desimal dan pembulatan half-up.
- Ledger append-only dijaga trigger database; saldo hanya berubah lewat
  `postLedgerEntry`.
- Idempotensi: `Transaction.reference` unik, indeks unik imbalan per
  keanggotaan+siklus+periode, indeks unik komisi per peristiwa sumber+penerima, indeks
  parsial satu setoran/penarikan terbuka per akun.
- Tidak ada SQL yang dirakit dari string; `$queryRaw` memakai tagged template
  berparameter (halaman `/admin` dan `/security`).
- Tidak ada `dangerouslySetInnerHTML`; tidak ada rahasia di dalam repositori
  (`.env` diabaikan Git, `storage/` di luar direktori publik).


## 4. Batas audit ini

Audit ini **tidak** mencakup dan tidak dapat menyimpulkan hal-hal berikut:

- Pengujian penetrasi eksternal, fuzzing, atau pengujian beban.
- Keamanan infrastruktur (VPS, jaringan, WAF, TLS, DNS) — tidak ada di repositori.
- Ketahanan pada penyedia email/SMS, karena keduanya belum terintegrasi.
- Kepatuhan hukum (KYC/AML, pajak, perlindungan konsumen) — belum ditinjau.
- Autentikasi dua faktor **belum diimplementasikan**; halaman `/security` menyatakan ini
  secara eksplisit dan tidak menampilkan status keamanan palsu.
- Audit CVE otomatis atas dependensi pihak ketiga.

Risiko teknis yang masih terbuka:

1. Rate limiter tersimpan di memori satu proses; untuk beberapa instans diperlukan
   penyimpanan bersama (mis. Redis) agar batasnya benar-benar global.
2. `recordSecurityEvent`/`recordAuditLog` menelan kegagalan penulisan, sehingga
   peristiwa di luar transaksi dapat hilang tanpa terlihat. Audit di dalam transaksi
   finansial tidak terpengaruh.
3. Header CSP dan HSTS untuk halaman HTML belum dipasang (diputuskan sebagai tanggung
   jawab lapisan deployment, lihat `next.config.ts`).
4. `AUTH_TOKEN_SECRET` masih memiliki nilai pengembangan bawaan saat tidak
   dikonfigurasi di luar produksi. Produksi menolak berjalan tanpa secret minimal 32
   karakter; staging harus diperlakukan sama ketatnya.


## 5. Kesiapan produksi: yang masih harus dipenuhi

Aplikasi ini **belum** siap menerima dana publik. Daftar berikut harus diselesaikan
lebih dulu:

1. **Pembayaran dan pencairan nyata.** Belum ada gateway pembayaran, dompet otomatis,
   atau integrasi transfer. Setoran dan penarikan masih manual sepenuhnya.
2. **Peninjauan hukum dan kepatuhan.** Syarat & Ketentuan, kebijakan privasi,
   pengungkapan risiko, ketentuan rujukan, dan kebijakan penarikan sudah tersedia dalam
   Bahasa Indonesia, tetapi belum ditinjau penasihat hukum.
3. **KYC/AML.** Belum ada verifikasi identitas, penyaringan sanksi, atau pemantauan
   transaksi mencurigakan.
4. **Pencegahan penipuan.** Belum ada deteksi multi-akun, penyalahgunaan rujukan, atau
   analisis pola anomali.
5. **Infrastruktur produksi.** Belum ada konfigurasi TLS/HSTS/CSP, WAF, pembatasan
   jaringan database, atau pemisahan lingkungan yang terverifikasi.
6. **Pengelolaan secret.** Diperlukan penyimpanan secret terkelola (bukan berkas
   `.env`), rotasi berkala, dan pemisahan kunci per lingkungan.
7. **Backup dan pemulihan.** Backup manual sudah tersedia (lihat laporan tahap 6/7);
   belum ada backup terjadwal, retensi, atau uji pemulihan berkala.
8. **Monitoring dan penanganan insiden.** Belum ada metrik, alert, atau prosedur
   eskalasi.
9. **Privasi dan pengelolaan data.** Belum ada alur resmi untuk permintaan ekspor dan
   penghapusan data pengguna.
10. **Pengujian keamanan lanjutan.** Diperlukan pengujian penetrasi independen dan audit
    dependensi otomatis.
11. **Dukungan pengguna dan penyelesaian sengketa.** Belum ada kanal dukungan resmi,
    SLA, atau prosedur banding atas keputusan admin.

Selama butir 1–7 belum selesai, platform ini hanya boleh dipakai untuk pengujian
internal dengan data uji, bukan untuk uang sungguhan.
