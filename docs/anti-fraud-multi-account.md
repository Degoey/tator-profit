# Anti-Fraud Multi-Akun dan Penyalahgunaan Rujukan (Bagian 13)

Dokumen ini menjelaskan deteksi yang benar-benar berjalan pada kode, batasnya, dan cara
memverifikasi ulang. Prinsip utamanya satu kalimat: **deteksi ini hanya membuka kasus untuk
ditinjau manusia.** Tidak ada saldo yang diubah, tidak ada komisi yang ditahan, dan tidak
ada akun yang diblokir secara otomatis.

Alasannya praktis. Kesamaan alamat IP bisa berarti satu keluarga, satu warnet, atau satu
kantor; nomor rekening yang sama bisa berarti pasangan yang memakai satu rekening bersama.
Menolak uang berdasarkan satu kecocokan akan menghukum pengguna sah. Karena itu pemeriksaan
ini mengumpulkan sinyal, menampilkannya kepada administrator dengan izin khusus, dan
menyimpan keputusannya di jejak audit.

## 1. Sinyal dan ambangnya

Semua ambang tinggal di satu berkas (`src/lib/config/anti-fraud.ts`) supaya kebijakan bisa
dibaca, diuji, dan diubah di satu tempat.

| Sinyal | Pemicu | Data pendukung minimal |
| --- | --- | --- |
| `SHARED_BANK_ACCOUNT` | Nomor rekening (bank/e-wallet) yang sama sudah dipakai akun lain | 2 akun dengan kode bank **dan** nomor yang sama |
| `SHARED_IP` | Beberapa akun mendaftar dari alamat IP yang sama | 3 akun dalam 24 jam |
| `SAME_IP_AS_REFERRER` | IP pendaftar identik dengan perujuk | 1 perujuk yang dicocokkan |
| `SAME_BANK_AS_REFERRER` | Rekening pendaftar identik dengan perujuk (kode bank sama) | 1 perujuk yang dicocokkan |
| `REFERRER_BURST` | Pendaftaran lewat satu perujuk dalam waktu singkat | 5 pendaftaran dalam 1 jam |

Catatan penting:

- Nomor rekening dibandingkan **bersama kode bank**, sehingga `12345` di BCA dan `12345` di
  DANA tidak dianggap sama.
- `SHARED_IP` tidak menandai dua akun (pasangan, orang tua dan anak) — butuh minimal tiga.
  Header `X-Forwarded-For` dikendalikan klien, jadi sinyal IP hanya dihitung bila operator
  menyatakan adanya reverse proxy tepercaya (`TRUST_PROXY_HEADERS=1`). Tanpa deklarasi itu
  alamat IP dianggap tidak diketahui dan tidak ada sinyal IP yang dibuat.
- Setiap sinyal yang muncul selalu menyertakan akun terkait (`relatedUserIds`), kecuali
  `REFERRER_BURST` yang menautkan perujuknya. Akun yang sedang diperiksa tidak pernah masuk
  ke daftar itu.

## 2. Alur saat pendaftaran

`registerUser` (`src/lib/services/auth-service.ts`) menjalankan penyaringan di dalam
**transaksi yang sama** dengan pembuatan akun, profil, saldo, dan baris rujukan
(`flagRegistrationInTransaction`). Jadi tidak mungkin ada akun yang tersimpan tanpa kasus
tinjauannya, dan sebaliknya.

Bila minimal satu sinyal muncul, tiga hal ditulis sekaligus:

1. satu baris `FraudReview` berstatus `OPEN` berisi daftar sinyal dan akun terkait;
2. satu `SecurityEvent` bertipe `FRAUD_FLAGGED` (severity `WARNING`) yang tampil di halaman
   `/security` milik member;
3. satu `AuditLog` dengan aksi `fraud.flagged`.

Bila tidak ada sinyal yang muncul, **tidak ada** yang ditulis: pendaftaran biasa tidak
meninggalkan baris tambahan.

`User.registrationIp` hanya diisi lewat `trustedIpAddress(meta)`. Kolom ini adalah satu-
satunya data yang disimpan untuk keperluan sinyal IP dan tidak pernah dikirim ke perujuk
maupun ke halaman member lain.

`FRAUD_FLAGGED` sengaja muncul di halaman `/security` milik member sendiri (label "Sinyal
anti-fraud terdeteksi") mengikuti prinsip transparansi yang sama dengan riwayat masuk
gagal. Isinya hanya nama sinyal milik akun itu sendiri: tidak ada ambang batas, tidak ada
data akun lain, dan tidak ada identitas pelapor.

## 3. Antrean tinjauan administrator

| Bagian | Berkas |
| --- | --- |
| Halaman `GET /fraud-review` | `src/app/fraud-review/page.tsx` |
| Rute keputusan `POST /api/admin/fraud` | `src/app/api/admin/fraud/route.ts` |
| Antarmuka antrean | `src/components/payments/admin-fraud-queue.tsx` |
| Service (deteksi, antrean, keputusan) | `src/lib/services/anti-fraud-service.ts` |

Kebijakan aksesnya:

- `readFraud` — SUPER_ADMIN, FINANCE, COMPLIANCE. Peran lain tidak memuat baris antrean
  sama sekali di server (bukan hanya disembunyikan di UI).
- `reviewFraud` — hanya SUPER_ADMIN dan COMPLIANCE. FINANCE boleh membaca untuk menilai
  risiko dana yang akan cair, tetapi tidak boleh menutup kasus.
- Setiap keputusan wajib berisi alasan tertulis minimal 10 karakter dan maksimal 500
  karakter, dan dihasilkan satu baris `AuditLog` (`fraud.review.cleared` atau
  `fraud.review.confirmed`) berisi status sebelum/sesudah.
- Kasus hanya bisa berpindah dari `OPEN` ke `CLEARED` atau `CONFIRMED`; penutupan kedua
  ditolak (`CASE_CLOSED`).
- Rute keputusan memakai pemeriksaan origin yang sama (`assertSameOrigin`), pembatasan laju
  per administrator, dan validasi Zod (`fraudReviewSchema`); izin diperiksa ulang di dalam
  service sehingga UI bukan satu-satunya penjaga.

Tim tindak lanjutnya tetap manusiawi: keputusan `CONFIRMED` hanya menandai akun untuk
ditindaklanjuti lewat kontrol yang sudah ada (`SUSPENDED`, peninjauan penarikan, peninjauan
deposit). Fitur ini tidak pernah memotong saldo dan tidak pernah membatalkan komisi.

## 4. Yang belum ada (batas jujur)

- Tidak ada analisis pola historis (mis. akun yang baru aktif setelah menerima komisi),
  pencocokan perangkat/peramban, atau pencocokan identitas.
- Tidak ada tindakan otomatis atas komisi: komisi tetap mengalir mengikuti ketentuan
  program, dan penyalahgunaan yang terbukti diselesaikan manual.
- Deteksi hanya berjalan **saat pendaftaran**. Perubahan nomor rekening setelah itu tidak
  memicu pemeriksaan ulang.
- Ini bukan KYC/AML dan bukan pengganti peninjauan manusia.

## 5. Verifikasi ulang

```powershell
npx tsc --noEmit   # tipe
npm run lint       # eslint
npm test           # termasuk tests/anti-fraud.test.ts (30 kasus)
```

Migrasi `prisma/migrations/20261015120000_antifraud_signals` bersifat aditif: tabel
`FraudReview`, kolom `User.registrationIp`, tiga indeks, dan nilai enum
`SecurityEventType.FRAUD_FLAGGED`. Tidak ada tabel atau baris yang dihapus.

