# Administrasi, RBAC, dan Jejak Audit (Bagian 6/7)

Dokumen ini merangkum kebijakan yang benar-benar dijalankan kode pada tahap 6/7.
Semua pemeriksaan otorisasi dilakukan **di server** (`src/lib/auth/admin-permissions.ts`,
`src/lib/auth/admin-guard.ts`, dan di dalam service transaksi); UI hanya mencerminkan
keputusan server tersebut.

## 1. Peran administrator dan izinnya

`User.role = ADMIN` hanya berarti "akun ini boleh masuk ke /admin". Apa yang boleh
dilakukan ditentukan `User.adminRole`, yang **null secara default** sehingga administrator
baru tidak punya kemampuan finansial sampai diberikan secara eksplisit (fail closed).

| Izin | SUPER_ADMIN | FINANCE | COMPLIANCE | SUPPORT | VIEWER |
| --- | --- | --- | --- | --- | --- |
| `read` (antrean deposit/penarikan) | ya | ya | ya | ya | ya |
| `readProof` (bukti pembayaran privat) | ya | ya | ya | ya | **tidak** |
| `readAudit` (jejak audit) | ya | ya | ya | tidak | tidak |
| `reviewDeposit` (setujui/tolak setoran) | ya | ya | tidak¹ | tidak | tidak |
| `reviewWithdrawal` (tinjau penarikan) | ya | ya | tidak | tidak | tidak |
| `manageFinance` (program/imbalan) | ya | ya | tidak | tidak | tidak |
| `creditBalance` (kredit saldo) | ya | ya | tidak | tidak | tidak |
| `manageUsers` (ubah peran admin) | ya | tidak | tidak | tidak | tidak |
| `readFraud` (antrean anti-fraud) | ya | ya | ya | tidak | tidak |
| `reviewFraud` (putuskan kasus anti-fraud) | ya | **tidak** | ya | tidak | tidak |

¹ COMPLIANCE boleh memindahkan setoran ke `UNDER_REVIEW` atau `FLAGGED` saja
(`canReviewDepositAction`); menyetujui/menolak uang tetap milik SUPER_ADMIN/FINANCE.

VIEWER hanya-baca: tidak boleh mengubah status, tidak boleh memberi kredit, dan tidak
membuka berkas bukti pembayaran. Jejak audit dan antrean anti-fraud dibatasi pada
SUPER_ADMIN, FINANCE, dan COMPLIANCE — role lain bahkan tidak memuat barisnya di server,
jadi tidak ada kebocoran lewat payload yang dirender. FINANCE boleh **membaca** antrean
anti-fraud untuk menilai risiko uang yang akan cair, tetapi tidak boleh menutup kasus
(`reviewFraud` hanya SUPER_ADMIN dan COMPLIANCE).

## 2. Kredit saldo administrator (Tahap 3)

- Tidak ada pemberian saldo otomatis: tidak ada bonus pendaftaran dan tidak ada
  pencocokan nama pengguna.
- Hanya role dengan `creditBalance` yang boleh memberi kredit.
- Formulir memuat akun penerima (hasil pencarian menampilkan **User ID**), jumlah,
  mata uang **USDT**, alasan, nomor referensi, admin pelaksana, waktu, serta saldo
  sebelum dan sesudah.
- Konfirmasi wajib sebelum kredit dikirim (`ConfirmDialog`).
- Setiap kredit menulis satu entri ledger bertipe `ADMIN_CREDIT` pada bucket
  `AVAILABLE`, satu baris `AuditLog` (`admin.credit_granted`) berisi snapshot
  sebelum/sesudah, IP, dan user agent, serta satu notifikasi untuk penerima — semuanya
  dalam satu transaksi database Serializable.
- **Idempotensi:** `Transaction.reference` unik dan diisi `admin-credit:<referensi>`.
  Referensi yang sama mengembalikan entri asli (tanpa kredit kedua); referensi yang sama
  dengan akun atau jumlah berbeda ditolak `REFERENCE_CONFLICT` (409).
- Saldo tidak pernah ditimpa langsung: satu-satunya jalur perubahan adalah
  `postLedgerEntry` (`src/lib/services/ledger-service.ts`).
- Kredit admin **tidak** menambah `totalEarned`; statistik imbalan tetap bersih.
- Koreksi dilakukan dengan entri `ADJUSTMENT` baru, bukan dengan mengubah riwayat.
- Kredit awal khusus lingkungan pengembangan memakai seed eksplisit dan idempoten:

  ```powershell
  npm run dev:credit -- --username demo_member --actor demo_admin `
    --amount 100.00 --reference DEV-INITIAL-DEMO-MEMBER --confirm
  ```

  Seed menolak berjalan tanpa `--confirm` dan menolak `NODE_ENV=production`.

## 3. Deposit manual (Tahap 4)

Status: `PENDING` → `UNDER_REVIEW` / `FLAGGED` → `APPROVED` / `REJECTED`.
Mengirim setoran tidak pernah menambah saldo. Saat disetujui, dalam satu transaksi:
dana masuk bucket `PROGRAM_FUNDS`, keanggotaan diaktifkan (hanya bila statusnya masih
`PENDING` dan jumlahnya masih sama dengan nilai gabung), imbalan periode pertama dibuat,
komisi rujukan dihitung, audit log ditulis, dan notifikasi dikirim. Status terminal tidak
dapat diproses ulang; penolakan wajib beralasan dan tidak menambah saldo. Tidak ada
gateway pembayaran dan tidak ada status "berhasil" yang dipalsukan.

## 4. Penarikan (Tahap 5)

Status: `PENDING` → `UNDER_REVIEW` → `APPROVED` → `PROCESSING` → `COMPLETED`, atau
`REJECTED` dari status mana pun sebelum selesai. Saat diajukan, dana dipindahkan
`AVAILABLE` → `RESERVED` (dua entri append-only) sehingga dana yang sama tidak dapat
dipakai dua kali; satu akun hanya boleh punya satu penarikan terbuka (unique index
parsial). Penolakan mengembalikan `RESERVED` → `AVAILABLE`; hanya `PROCESSING` →
`COMPLETED` yang mendebit cadangan secara permanen. Transfer eksternal dilakukan manual
dan statusnya jujur (tidak ada klaim transfer selesai tanpa verifikasi).

Setiap penarikan dikenakan biaya **10%** yang selalu dihitung ulang oleh server dari
nominal bruto (`WITHDRAWAL_FEE_RATE`), jadi klien tidak dapat memalsukan angka yang
dibebankan. Saat admin menandai `COMPLETED`, admin dapat melampirkan **bukti transfer**
(PNG/JPG/PDF, maksimal 5 MiB) yang divalidasi dan disimpan privat persis seperti bukti
setoran, lalu diunduh pemilik atau admin berizin lewat `/api/withdrawals/<id>/proof`.

Riwayat tersedia sebagai API `GET /api/withdrawals` (anggota: miliknya sendiri;
admin dengan kemampuan `read`: seluruh antrean, dengan `status`/`search`/`take`) dan
sebagai **rekap CSV** `/api/withdrawals/export` (lengkap dengan kolom biaya dan netto;
`?scope=admin` khusus admin). Sel yang berasal dari input pengguna dinetralkan agar tidak
dapat dieksekusi sebagai formula oleh aplikasi spreadsheet.

## 5. Ledger dan audit log (Tahap 6)

- Ledger `Transaction` bersifat **append-only**: trigger `tatorprofit_ledger_guard()`
  menolak `DELETE` dan menolak perubahan pada `userId, type, amount, currency, reference,
  bucket, balanceBefore, balanceAfter, createdAt`. Koreksi = entri baru.
- Invarian: `balance.bucket === sum(entri POSTED pada bucket tersebut)`, diperiksa oleh
  `verifyBalanceInvariant` dan dipakai di test serta skrip verifikasi.
- Kolom audit: aktor, aksi, jenis entitas, ID entitas, snapshot `before`/`after`, waktu,
  alamat IP, user agent, dan alasan/referensi di dalam snapshot.
- Aksi yang tercatat: kredit/penyesuaian saldo (`admin.credit_granted`), persetujuan dan
  penolakan setoran (`deposit.*`), setiap perubahan status penarikan (`withdrawal.*`),
  perubahan konfigurasi program dan imbalan (`program.*`, `reward.*`), serta perubahan
  peran administrator (`admin.role_assigned`). Peristiwa keamanan (login, login gagal,
  logout, reset kata sandi, rate limit) tercatat di `SecurityEvent`.
- Persentase **Komisi Rabat** lima generasi kini tersimpan di tabel `RebateConfig` dan
  dapat diubah saat runtime melalui kartu **Persentase Komisi Rabat** pada `/admin`
  (`POST /api/admin/rebate`). Setiap perubahan ditolak kecuali oleh peran dengan
  kemampuan `manageFinance` (SUPER_ADMIN/FINANCE) dan tercatat sebagai
  `rebate.config.updated` beserta snapshot `before`/`after` seluruh lima generasi.
  Nilai bawaan (`src/lib/config/referral.ts`) dipakai sebagai cadangan bila tabel belum
  terisi, sehingga perilaku perhitungan tidak berubah saat migrasi diterapkan.
- Nilai rabat tidak pernah menulis ulang transaksi historis: setiap baris
  `ReferralCommission` menyimpan `rate` dan `commissionAmount` miliknya sendiri.
- Kata sandi, token, dan kredensial tidak pernah dicatat di audit maupun log.

## 6. Antarmuka peran administrator (Bagian 7/7)

Kemampuan `manageUsers` kini memiliki permukaan di UI: kartu **Peran administrator**
pada `/admin`. Kartu itu hanya dimuat untuk SUPER_ADMIN — daftar administrator tidak
pernah dibaca untuk peran lain, jadi tidak ada kebocoran lewat payload yang dirender.
Setiap perubahan peran tetap divalidasi ulang di dalam service (`assignAdminRole`),
sehingga akun FINANCE/SUPPORT/COMPLIANCE/VIEWER tidak dapat memakainya walaupun
mengirim permintaan langsung ke `/api/admin/users/role`.

## 6b. Persentase Komisi Rabat

Fitur rabat hanya mengenal **lima generasi** (10%, 2%, 1%, 1%, 1% sebagai nilai bawaan).
Generasi 6 dan seterusnya tidak pernah disediakan: `RebateConfig` diberi CHECK constraint
`generation BETWEEN 1 AND 5`, service memvalidasi ulang, dan form admin hanya merender
generasi 1..5. Satu konfigurasi (`src/lib/rebate-config.ts`) dipakai bersama oleh beranda
member (`/dashboard`), tabel admin, dan mesin perhitungan komisi
(`postReferralCommissionsForTransaction`), sehingga ketiganya selalu menampilkan angka yang
sama. Keterangan "bukan jaminan nominal penghasilan" tampil pada kartu member.

## 6c. Antrean tinjauan anti-fraud (Bagian 13)

Halaman `/fraud-review` menampilkan kasus yang dibuka oleh pendeteksi multi-akun. Ia dijaga
`requireAdminCapability("readFraud")` di server; SUPPORT dan VIEWER dialihkan. Tombol
keputusan hanya dirender untuk `reviewFraud` (SUPER_ADMIN dan COMPLIANCE), dan keputusan
itu divalidasi ulang di server (`validateFraudDecision` + `reviewFraudCase`) sehingga peran
lain tidak dapat memakainya lewat `/api/admin/fraud`. Setiap keputusan wajib berisi alasan
tertulis dan menghasilkan satu baris `AuditLog` (`fraud.review.cleared` /
`fraud.review.confirmed`). Rincian sinyal dan batasnya ada di
`docs/anti-fraud-multi-account.md`.

## 7. Halaman akun dan kebijakan (Bagian 7/7)

Selain halaman keuangan, sekarang tersedia: `/rewards` (riwayat imbalan + progres
periode), `/transactions` (buku besar penuh), `/profile` (perbarui profil),
`/security` (sesi aktif, peristiwa keamanan, status 2FA yang jujur: belum tersedia),
`/notifications` (kotak masuk + tandai dibaca), `/reset-password` (menyelesaikan alur
lupa kata sandi), dan `/referral-terms` (Ketentuan Rujukan).

## 8. Cara memverifikasi ulang

```powershell
npx tsc --noEmit          # tipe
npm run lint              # eslint
npm test                  # unit + integrasi (termasuk tests/admin-credit.test.ts)
npm run build             # produksi
npm run dev               # terminal lain, lalu:
npm run verify:payments   # alur setoran/penarikan/kredit lewat HTTP + cek DB
npm run verify:e2e        # alur pengguna end-to-end
```

Dua pengalih lingkungan hanya untuk pengembangan lokal (jangan dipakai di produksi):

- `TRUST_PROXY_HEADERS=1` — mempercayai `X-Forwarded-For`. Wajib untuk menjalankan
  skrip verifikasi yang mensimulasikan beberapa alamat klien, dan hanya benar bila ada
  reverse proxy tepercaya yang menimpa header tersebut.
- `ALLOW_DEV_RESET_TOKEN=1` — mengembalikan token reset dari API agar alur lupa kata
  sandi dapat diuji tanpa penyedia surel. Di produksi token tidak pernah dikembalikan.


