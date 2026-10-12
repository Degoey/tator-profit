# Modul Profit Mingguan Berbasis Hasil Trading Aktual — Audit & Rencana Implementasi

Dokumen ini adalah **langkah pertama** yang diminta: audit proyek + rencana implementasi
bertahap untuk modul baru "Profit Mingguan Berdasarkan Hasil Trading Aktual".

Dokumen ini adalah **langkah pertama** (audit + rencana). Seluruh klaim pada bagian audit
merujuk ke berkas yang benar-benar ada di repositori ini (branch `main`, commit `ac6bdc3`).

**Status pelaksanaan:** Fase 1a (skema + mesin murni, §16), Fase 1b (perjanjian bagi hasil &
impor CSV, §17), dan Fase 1c (sumber modal, gerbang Validasi Aturan, pencatatan kerugian,
mesin status pembayaran, kapabilitas RBAC trading, §18) **sudah dikerjakan**; 17 migrasi
sudah diterapkan dan seluruh suite diuji pada PostgreSQL lokal (§18.6). Fase 2–5
(service database, API, UI admin, dashboard anggota, dokumentasi akhir) **belum dikerjakan**.
Tidak ada pembayaran uang nyata dan tidak ada satu pun persentase pembagian yang ditetapkan
tanpa persetujuan pemilik.

> Prinsip yang mengikat seluruh pekerjaan berikutnya:
> jangan membangun ulang aplikasi, pertahankan desain/autentikasi/database/dashboard yang
> sudah berfungsi, jangan mengaktifkan pembayaran nyata otomatis, dan **jangan mengarang**
> hasil trading, persentase pembagian, atau transaksi.

## 1. Ringkasan eksekutif

TatorProfit saat ini adalah aplikasi Next.js 16 (App Router) + Prisma 6.19.3 + PostgreSQL 16
dengan sistem keuangan yang **sudah matang dan konservatif**: buku besar append-only, RBAC
admin eksplisit, jejak audit, anti-fraud, dan alur setoran/penarikan manual berjalur bukti.

Yang **belum ada**: sumber pendapatan yang berasal dari hasil trading aktual. Saat ini imbalan
anggota berasal dari mesin program (`Reward`) dan komisi rujukan lima generasi
(`ReferralCommission`), bukan dari P&L trading. Modul baru akan menambahkan lapisan
"hasil trading aktual → laporan mingguan → alokasi → ledger anggota → pembayaran" **di atas**
fondasi yang ada, tanpa mengubah fitur lama.

Karena keputusan bisnis inti (persentase bagi hasil, penanganan kerugian, dll.) **belum
ditetapkan pemilik**, modul ini dibangun dengan prinsip *fail closed*: semua parameter
pembagian disimpan sebagai konfigurasi yang menunggu persetujuan, dan sistem menolak
menerbitkan/membayar laporan bila parameter wajib belum disetujui.

## 2. Hasil audit proyek

### 2.1 Tumpukan teknologi (dari `package.json`, `tsconfig.json`, `next.config.ts`)

| Aspek | Nilai |
| --- | --- |
| Framework | Next.js `^16.4.0` (App Router, `src/app`), React `^19.2.0` |
| Bahasa | TypeScript 5.9, `strict` + `noUncheckedIndexedAccess`, alias `@/* -> ./src/*` |
| ORM/DB | Prisma `6.19.3`, PostgreSQL (`prisma/schema.prisma`, 16 migrasi) |
| Validasi | `zod` `^4.0.0` |
| UI | Tailwind CSS 4, `class-variance-authority`, `lucide-react`, komponen internal di `src/components/ui` |
| Autentikasi | Sesi token HMAC kustom (`src/lib/auth/*`) + `bcryptjs`, cookie `HttpOnly` |
| Runtime | Node 24 (dev), `output: "standalone"` untuk Docker |
| Uang | Selalu `Prisma.Decimal` (tidak pernah float), helper `src/lib/money.ts` |
| Pengujian | `node:test` lewat `tsx`, dijalankan `npm test` (`scripts/run-tests.ts`) — bukan Jest/Vitest |
| Driver CLI | `scripts/verify-e2e.ts`, `verify-payments.ts`, `verify-routes.ts`, `demo-local.ts` |

### 2.2 Basis data yang sudah ada (`prisma/schema.prisma`)

Model relevan yang **sudah ada** dan akan dipakai ulang (tidak diubah):

- `User`, `Profile`, `Session` — identitas & sesi.
- `Balance` (bucket `AVAILABLE`, `PENDING`, `PROGRAM_FUNDS`, `RESERVED`, `totalEarned`,
  `totalReversed`) — **satu-satunya** sumber kebenaran saldo.
- `Transaction` — buku besar append-only; dijaga trigger PostgreSQL `Transaction_append_only`
  (`prisma/migrations/20261007230319_init`), `reference` unik (idempotensi).
- `Program` / `ProgramTier` / `ProgramCycle` / `UserProgram` / `Reward` — mesin program & imbalan.
- `Referral` / `ReferralCommission` / `RebateConfig` — komisi rujukan 5 generasi
  (10/2/1/1/1%), dengan kunci idempotensi `@@unique([sourceTransactionId, beneficiaryUserId])`.
- `DepositRequest` / `WithdrawalRequest` — pembayaran manual + bukti (file privat).
- `Notification`, `SecurityEvent`, `AuditLog`, `FraudReview` — notifikasi, keamanan, audit, anti-fraud.

Tidak ada satu pun tabel/enum bertema trading (`TradeRecord`, `TradingReport`, dst.). Pencarian
`trading|TradeRecord|TradingReport|profitShare` di seluruh repositori **tidak menemukan hasil**,
jadi modul ini murni penambahan baru.

### 2.3 Otorisasi admin yang sudah ada (`src/lib/auth/admin-permissions.ts`)

Kapabilitas saat ini: `read`, `readProof`, `readAudit`, `reviewDeposit`, `reviewWithdrawal`,
`manageFinance`, `creditBalance`, `manageUsers`, `readFraud`, `reviewFraud`. Peta peran:
SUPER_ADMIN (semua), FINANCE (uang + audit, tanpa `manageUsers`/`reviewFraud`), COMPLIANCE
(inspeksi + `reviewFraud`), SUPPORT (baca), VIEWER (baca tanpa bukti). Peran `null` **ditolak**
(fail closed). Penjaga server: `requireAdminCapability()` di `src/lib/auth/current-user.ts`.

**Implikasi:** mencatat trading, menyetujui laporan, dan mencatat pembayaran **wajib** memakai
kapabilitas baru (mis. `manageTrading`, `approveTradingReport`, `recordProfitPayment`) —
bukan menumpang `manageFinance` secara diam-diam, supaya pemisahan tugas (maker/checker) nyata.

### 2.4 Lapisan uang yang sudah ada (`src/lib/services/ledger-service.ts`)

- `postLedgerEntry(client, input)` menulis entri + memindahkan bucket saldo **dalam satu
  transaksi**; saldo tidak pernah ditimpa langsung.
- `reference` unik → idempotensi bawaan (contoh `admin-credit:<ref>`).
- `verifyBalanceInvariant()` memeriksa `balance === sum(ledger per bucket)` — dipakai tes/ops.

**Implikasi:** kredit profit anggota dan pencatatan pembayaran **harus** lewat `postLedgerEntry`
dengan referensi unik turunan dari id laporan + peran (mis. `profit-share:<reportId>:<userId>`).

### 2.5 Pola pengujian & isolasi DB

- `npm test` → `scripts/run-tests.ts` memaksa `DATABASE_URL = TEST_DATABASE_URL` dan menolak
  database aplikasi / `NODE_ENV=production`; setiap proses uji di-sandbox
  (`tests/helpers/prisma.ts` → `assertSandboxedTestProcess()`).
- Gaya berkas uji: `node:test` + `node:assert/strict`; **dua jenis** uji yang lazim dipakai:
  1. **Uji murni** (tanpa DB) — mis. `tests/reward-calculation.test.ts` menguji
     `src/lib/services/reward-calculation.ts` (fungsi murni + `Prisma.Decimal`).
  2. **Uji integrasi DB** — memakai `createTestPrismaClient()` (mis. `tests/admin-credit.test.ts`).
- Ada juga uji "audit sumber" yang membaca berkas dengan `readProjectFile(...)` untuk memastikan
  pola RBAC/UI tidak menyimpang (mis. `tests/commission-admin.test.ts`).

**Implikasi:** modul baru harus menyediakan (a) uji murni untuk matematika P&L & bagi hasil,
(b) uji integrasi DB untuk idempotensi/otorisasi/ledger, (c) uji audit sumber untuk RBAC & UI.

## 3. Berkas dan fitur yang akan terpengaruh

### 3.1 Berkas yang akan **diubah** (aditif, tanpa menghapus perilaku lama)

| Berkas | Perubahan | Risiko |
| --- | --- | --- |
| `prisma/schema.prisma` | Tambah enum + model baru (lihat §4) dan relasi balik di `User` | Rendah — murni aditif |
| `prisma/migrations/<baru>/migration.sql` | Migrasi aditif (CREATE TABLE/INDEX/ENUM saja) | Rendah |
| `src/lib/auth/admin-permissions.ts` | Tambah kapabilitas trading + pemetaan peran | Sedang — mengubah matriks izin (uji wajib) |
| `src/app/admin/page.tsx` | Tambah bagian "Manajemen Trading" (kondisional sesuai kapabilitas) | Sedang |
| `src/app/dashboard/page.tsx` | Tambah bagian **Profit Trading Mingguan** + **Bonus Referral** (terpisah) | Sedang |
| `src/components/site-nav.tsx` (bila relevan) | Tautan menu anggota bila perlu | Rendah |
| `src/lib/status-labels.ts` | Label Indonesia untuk status laporan/pembayaran baru | Rendah |
| `docs/*` | Dokumen modul ini + ringkasan hasil | Rendah |

### 3.2 Berkas yang akan **dibuat** (baru)

- **Skema & konfigurasi**
  - `src/lib/config/trading.ts` — konstanta & parameter modul (status, jenis biaya, ambang).
  - `src/lib/services/profit-share-config.ts` — konfigurasi bagi hasil yang **menunggu
    persetujuan** (tanpa nilai persentase karangan; gagal-tertutup bila belum disetujui).
- **Mesin murni (tanpa DB)** — dapat diuji tanpa database:
  - `src/lib/services/trading-calculation.ts` — P&L bersih, pemisahan realized/unrealized,
    biaya, deteksi biaya ganda, cek selisih rekonsiliasi.
  - `src/lib/services/profit-allocation.ts` — pembagian hasil *setelah* parameter disetujui,
    penanganan kerugian, pembulatan Decimal, pengecekan invarian (total alokasi ≤ tersedia).
  - `src/lib/services/trading-report-status.ts` — mesin status laporan (transisi legal + alasan).
- **Service DB (transaksional)**
  - `src/lib/services/trading-record-service.ts` — input manual + impor CSV + verifikasi +
    rekonsiliasi + anti-duplikat.
  - `src/lib/services/trading-report-service.ts` — kompilasi periode, hitung, ajukan, setujui,
    terbitkan, koreksi (append-only), riwayat persetujuan.
  - `src/lib/services/profit-payment-service.ts` — pencatatan pembayaran terpisah + verifikasi
    + kredit ledger idempoten.
  - `src/lib/services/member-profit-service.ts` — pembacaan laporan & pembayaran untuk anggota
    (hanya data miliknya).
- **Validasi** — `src/lib/trading-validation.ts` (skema zod + parser/templat CSV).
- **API route** (`src/app/api/...`):
  - `api/admin/trading/records/route.ts` (GET/POST daftar & input manual)
  - `api/admin/trading/import/route.ts` (POST impor CSV)
  - `api/admin/trading/reconcile/route.ts` (POST rekonsiliasi)
  - `api/admin/trading/reports/route.ts` (GET/POST kompilasi & transisi status)
  - `api/admin/trading/payments/route.ts` (GET/POST pencatatan pembayaran)
  - `api/trading/reports/route.ts` (GET laporan milik anggota)
- **UI komponen** (`src/components/`):
  - `trading/admin-trading-records.tsx`, `admin-trading-import.tsx`,
    `admin-trading-reconcile.tsx`, `admin-trading-reports.tsx`, `admin-profit-payments.tsx`
  - `dashboard/member-profit-report.tsx` (bagian anggota)
- **Pengujian** (`tests/`): lihat §9.
- **Dokumen**: `docs/profit-trading-module.md` (hasil akhir + konfigurasi menunggu persetujuan).

### 3.3 Fitur lama yang **harus tetap berfungsi** (jangan diubah perilakunya)

Setoran, penarikan (+ fee 10%), kredit admin, imbalan program, komisi rujukan 5 generasi,
anti-fraud, notifikasi, audit, halaman akun, RBAC, dan APK Android admin. Modul trading
**tidak** boleh mengubah arti saldo/aplikasi lama; ia menambah ledger entry bertipe baru.

### 3.4 Kesenjangan (gap) antara kebutuhan modul dan fondasi yang ada

| Kebutuhan (dari spesifikasi) | Yang sudah ada | Yang belum ada |
| --- | --- | --- |
| Pencatatan trading aktual | — | Tabel + service + validasi |
| Impor CSV + anti-duplikat | Parser CSV pembayaran (`src/lib/payment-csv.ts`) sebagai acuan gaya | Parser CSV trading + kunci unik idempotensi |
| Rekonsiliasi sumber | — | Tabel rekonsiliasi + perhitungan selisih |
| Laporan mingguan + 8 status | Enum status di modul lain (Reward/Withdrawal) sebagai acuan | Model laporan + mesin transisi + riwayat approval |
| Perhitungan P&L bersih | `Prisma.Decimal` + gaya fungsi murni (`reward-calculation.ts`) | Rumus P&L + penghindaran biaya ganda |
| Alokasi bagi hasil | `RebateConfig` (pola konfigurasi runtime) sebagai acuan | Parameter bagi hasil (menunggu persetujuan) |
| Ledger profit anggota | `postLedgerEntry` + bucket saldo | Tipe transaksi `PROFIT_SHARE` + referensi |
| Pembayaran terpisah | `WithdrawalRequest` + bukti | Model pembayaran profit + verifikasi |
| Audit trail | `AuditLog` + `recordAuditLog` | Aksi audit khusus modul trading |
| Pemisahan demo vs aktual | — | Penanda sumber data (`sourceType`) di record & laporan |

## 4. Rancangan data yang diusulkan (belum diterapkan)

Nama model/enumnya sengaja dibuat eksplisit agar tidak mencampur `Reward`, referral, dan
profit trading:

### 4.1 `TradingRecord`

Kolom minimal: `id`, `externalReference` (unik per exchange/source), `traderId`/nama,
`exchange`, `assetPair`, `tradeType`, `executedAt`, `allocatedCapital`, `realizedPnl`,
`unrealizedPnl` (opsional/terpisah), `tradingFees`, `otherCosts`, `costsIncludedInPnl`,
`sourceType` (`ACTUAL`/`DEMO`), `verificationStatus`, `evidenceStorageKey` (privat), `notes`,
`createdBy`, `verifiedBy`, timestamps.

- Nilai keuangan `Decimal(18,2)`/rate Decimal; waktu UTC.
- Unique `(exchange, externalReference, sourceType)` untuk mencegah impor duplikat.
- `ACTUAL` tidak boleh berasal dari demo seed; data demo tidak boleh masuk laporan aktual.
- `unrealizedPnl` tidak masuk rumus net realized P&L.

### 4.2 `TradingReport` + `TradingReconciliation`

`TradingReport`: periode `[periodStart, periodEnd]` UTC, `sourceType`, snapshot agregat
(realized P&L, unrealized P&L, fees, other costs, net P&L, reserves, availableForSharing),
`status`, versi/koreksi, `publishedAt`, `approvedBy`, `createdBy`, timestamps.

`TradingReconciliation`: report + sumber rekonsiliasi, totals internal vs source, selisih,
status (`PENDING`, `MATCHED`, `UNRESOLVED`), catatan, bukti, pemeriksa, timestamps.

Aturan: laporan tidak dapat `PENDING_APPROVAL`/`APPROVED`/`PUBLISHED` jika transaksi belum
terverifikasi atau ada selisih `UNRESOLVED`. Laporan `PUBLISHED` tidak di-update in place;
koreksi membuat versi/record koreksi baru dan approval/audit baru.

### 4.3 `ProfitAllocation` + `MemberProfitLedger`

`ProfitAllocation`: report, member, dasar alokasi, rate/kebijakan snapshot, amount, status,
unique `(reportId, memberId)`; tidak dibuat jika net negatif atau kebijakan kerugian belum
disetujui. `MemberProfitLedger`: append-only sumber hak anggota (berbeda dari `Transaction`),
reference unik, amount, status, correction link, audit metadata.

Kredit saldo aktual (jika pemilik menyetujui) tetap harus dibuat oleh `postLedgerEntry` dalam
transaksi yang sama dengan status allocation/payment; tidak ada saldo dari frontend.

### 4.4 `ProfitPayment`, `TradingApprovalHistory`, `TradingAuditLog`

- `ProfitPayment`: allocation/member, nominal, payment status (`PENDING`, `PROCESSING`,
  `COMPLETED`, `FAILED`, `CANCELLED`), provider/reference, proof storage key, verifiedBy,
  timestamps, idempotency key unik. `COMPLETED` hanya setelah bukti diverifikasi; tidak ada
  gateway/transfer otomatis.
- `TradingApprovalHistory`: report, from/to status, actor, reason, timestamp, before/after.
- Audit boleh memakai `AuditLog` yang sudah ada dengan `entityType`/action trading; tabel
  khusus hanya dibuat bila kebutuhan retensi/partitioning mengharuskannya. Hindari duplikasi
  jejak tanpa alasan.

### 4.5 Enum/report lifecycle

`DRAFT → RECONCILIATION → PENDING_APPROVAL → APPROVED → PUBLISHED → PAYMENT_PROCESSING → PAID`.
Terminal/branch: `REJECTED`, `CORRECTED`. Transisi harus compare-and-set, beralasan, dan
tercatat aktor/waktu. `PAID` laporan tidak boleh berarti semua anggota dibayar kecuali setiap
`ProfitPayment` benar-benar terverifikasi; definisi agregat ini harus dikonfirmasi pemilik.

### 4.6 Relasi dengan referral

`ReferralCommission` tetap terpisah. Persentase 10/2/1/1/1% tidak diterapkan ke P&L trading
secara otomatis. Dasar referral, sumber dananya, serta eligibility tetap mengikuti konfigurasi
existing sampai pemilik menyetujui kebijakan tertulis.

## 5. Rumus perhitungan yang akan diterapkan

```
Net Trading P&L = Realized Trading P&L − Trading Fees − Biaya Lain yang Relevan
```

Aturan yang mengikat implementasi (dipakai di uji):

1. Setiap komponen dihitung **tepat satu kali**. Jika sumber sudah menyajikan P&L *setelah*
   biaya, `tradingFees` tidak dikurangi lagi (`costsIncludedInPnl = true`).
2. `unrealizedPnl` **tidak** masuk Net Trading P&L; hanya ditampilkan terpisah.
3. Laporan memisahkan: realized P&L, unrealized P&L, biaya transaksi, kerugian, net hasil,
   cadangan/kewajiban, dan jumlah yang **secara sah tersedia** untuk dibagi.
4. Net hasil ≠ otomatis profit anggota. Bagi hasil hanya dihitung bila parameter kebijakan
   (persentase/dasar/periode) sudah **disetujui**; jika belum, alokasi = 0 dengan alasan
   "menunggu persetujuan kebijakan" (bukan angka karangan).
5. Net negatif → ditampilkan transparan sebagai kerugian; tidak ada profit anggota otomatis.
   Penanganan kerugian mengikuti kebijakan yang disetujui (mis. carry-forward) — bila belum
   ada kebijakan, alokasi ditahan.
6. Semua pembulatan memakai `Prisma.Decimal` dengan `ROUND_HALF_UP` ke 2 desimal.
7. Invarian: `Σ alokasi ≤ availableForSharing` dan `Σ pembayaran ≤ Σ alokasi`.

## 6. Alur status laporan profit mingguan

| # | Status | Arti | Transisi diizinkan dari |
| --- | --- | --- | --- |
| 1 | `DRAFT` | Data trading masih dikumpulkan | — (awal) |
| 2 | `RECONCILIATION` | Sedang dicocokkan/diverifikasi | DRAFT, CORRECTED |
| 3 | `PENDING_APPROVAL` | Siap ditinjau (rekonsiliasi bersih) | RECONCILIATION |
| 4 | `APPROVED` | Disetujui pejabat berwenang | PENDING_APPROVAL |
| 5 | `PUBLISHED` | Diterbitkan ke anggota | APPROVED |
| 6 | `PAYMENT_PROCESSING` | Pembayaran sedang diproses | PUBLISHED |
| 7 | `PAID` | Pembayaran terverifikasi selesai | PAYMENT_PROCESSING |
| 8 | `REJECTED` / `CORRECTED` | Ditolak/dikoreksi + alasan | PENDING_APPROVAL, APPROVED, PUBLISHED |

Setiap transisi: compare-and-set di dalam transaksi serializable, wajib aktor + waktu + alasan,
menulis `TradingApprovalHistory` dan `AuditLog`. Laporan `PUBLISHED` **tidak** diubah diam-diam;
koreksi menghasilkan record koreksi baru yang dapat diaudit (versi bertambah, `correctsReportId`
menunjuk laporan lama).

## 7. Keamanan, RBAC, dan pemisahan tugas

Kapabilitas baru yang diusulkan (ditambahkan ke matriks eksplisit yang sudah ada):

| Kapabilitas | SUPER_ADMIN | FINANCE | COMPLIANCE | SUPPORT | VIEWER |
| --- | --- | --- | --- | --- | --- |
| `readTrading` (baca catatan & laporan) | ya | ya | ya | ya | ya |
| `manageTrading` (input/impor/rekonsiliasi) | ya | ya | tidak | tidak | tidak |
| `approveTradingReport` (setujui/terbitkan) | ya | ya | tidak | tidak | tidak |
| `recordProfitPayment` (catat/verifikasi bayar) | ya | ya | tidak | tidak | tidak |
| `readTradingAudit` | ya | ya | ya | tidak | tidak |

- **Pemisahan tugas:** pencatat/importer (`manageTrading`) tidak otomatis boleh menyetujui.
  Aturan default: penyetuju harus berbeda dari pembuat laporan; ini konfigurasi yang
  **menunggu persetujuan** (bila pemilik mengizinkan orang yang sama, sistem menandainya).
- API: semua rute memakai `requireAdminCapability(...)` + pemeriksaan same-origin
  (`src/lib/request-origin.ts`) + rate limit (`src/lib/rate-limit.ts`) + validasi zod backend.
- Anggota: `/api/trading/reports` hanya mengembalikan baris milik pengguna sesi; tidak ada
  parameter yang membolehkan membaca anggota lain (uji IDOR).
- Rahasia: tidak ada private key/seed phrase; API key exchange (bila nanti ditambahkan) hanya
  read-only, disimpan di env/secret manager, **tanpa** izin withdrawal.
- Bukti pendukung disimpan di luar `public/`, diakses lewat rute terautentikasi (pola sama
  dengan `PAYMENT_PROOF_DIR`).
- Tidak ada gateway pembayaran nyata; pembayaran dicatat manual + bukti + verifikasi.
- Data demo ditandai `sourceType = DEMO` dan dikecualikan dari laporan aktual (uji khusus).

## 8. API dan antarmuka (ringkas)

**Admin — menu "Manajemen Trading"** (`/admin`, bagian baru, dimuat kondisional):

1. Kartu **Catatan Trading**: tabel + form input manual (semua kolom pada §4.1), filter periode,
   status verifikasi, dan aksi verifikasi.
2. Kartu **Impor CSV**: unggah, pratinjau, hasil validasi per baris, baris gagal ditandai,
   duplikat ditolak; template CSV disediakan.
3. Kartu **Rekonsiliasi**: input/unggah ringkasan sumber, tampilkan selisih internal vs sumber,
   status `MATCHED`/`UNRESOLVED`, blokir penerbitan bila belum bersih.
4. Kartu **Laporan Mingguan**: kompilasi periode, ringkasan P&L, tombol transisi status dengan
   dialog konfirmasi + alasan wajib, riwayat persetujuan, tombol koreksi.
5. Kartu **Pembayaran Profit**: daftar alokasi, pencatatan pembayaran, unggah bukti, verifikasi
   selesai/gagal, penanganan pembayaran berulang (idempotensi).

**Anggota — `/dashboard`, bagian "Profit Trading Mingguan"** (komponen baru):

- Periode, status laporan, ringkasan hasil perusahaan yang **disetujui untuk dipublikasikan**,
  dasar perhitungan, nominal hak anggota, riwayat mingguan, riwayat pembayaran, status, tanggal,
  referensi, dan keterangan bila belum diterbitkan/belum dibayar.
- Bagian **Profit Mingguan** dan **Bonus Referral** ditampilkan terpisah (tidak digabung).
- Tidak ada status "Dibayar" sebelum `ProfitPayment` terverifikasi.

## 9. Rencana pengujian (data simulasi, tanpa uang nyata)

Seluruh uji memakai data simulasi dan database uji terpisah (`TEST_DATABASE_URL`); tidak ada
uang nyata yang dikirim dan tidak ada saldo anggota sungguhan yang diubah.

| Berkas uji (baru) | Cakupan |
| --- | --- |
| `tests/trading-calculation.test.ts` | profit, **loss**, impas, biaya transaksi, biaya ganda, pemisahan realized/unrealized |
| `tests/trading-import.test.ts` | validasi format/nominal/waktu, **impor CSV duplikat**, baris gagal ditandai |
| `tests/trading-reconciliation.test.ts` | **perbedaan data rekonsiliasi**, blokir laporan saat selisih belum selesai |
| `tests/trading-report-lifecycle.test.ts` | **laporan belum disetujui**, transisi legal/ilegal, **laporan dikoreksi** |
| `tests/profit-allocation.test.ts` | **perhitungan pembagian hasil** (parameter disetujui vs belum), net negatif, invarian |
| `tests/profit-payment.test.ts` | **pembayaran gagal**, **pembayaran berulang** (idempotensi), verifikasi bukti |
| `tests/trading-access.test.ts` | **hak akses admin & anggota** (RBAC + IDOR + audit sumber UI) |
| `tests/trading-demo-separation.test.ts` | **pemisahan data demo dan data aktual** |

Uji murni (tanpa DB) dapat dijalankan lebih dulu; uji integrasi DB menyusul saat PostgreSQL uji
tersedia.

## 10. Keputusan bisnis yang **MENUNGGU PERSETUJUAN PEMILIK**

Tidak satu pun nilai di bawah ini akan dikarang atau ditetapkan sepihak. Sampai disetujui,
sistem berjalan gagal-tertutup (tidak menerbitkan/membayar).

| # | Keputusan | Status | Dampak bila belum ada |
| --- | --- | --- | --- |
| 1 | Persentase/dasar pembagian hasil trading | **MENUNGGU** | alokasi = 0, laporan tidak bisa `PAID` |
| 2 | Periode & metode pembagian (mingguan, cutoff, zona waktu) | **MENUNGGU** | hanya `DRAFT`/`RECONCILIATION` |
| 3 | Penanganan kerugian & periode rugi (carry-forward?) | **MENUNGGU** | kerugian ditampilkan, tanpa alokasi |
| 4 | Biaya pengelolaan / cadangan wajib | **MENUNGGU** | cadangan = 0 (dicatat eksplisit) |
| 5 | Hak anggota atas modal vs hasil trading | **MENUNGGU** | tidak ada kredit ke anggota |
| 6 | Sumber dana bonus referral & eligibility vs P&L trading | **MENUNGGU** | referral tetap pada konfigurasi lama |
| 7 | Pemisahan tugas penyetuju vs pencatat | **MENUNGGU** (usulan default: wajib beda orang) | memakai default konservatif |
| 8 | Definisi `PAID` laporan (semua anggota / sebagian) | **MENUNGGU** | status per anggota yang menentukan |
| 9 | Persetujuan pemilik atas kebijakan (nama, tanggal, bukti) | **MENUNGGU** | seluruh alur tetap terkunci |

Catatan hukum: model pengelolaan dana, pembagian hasil, program rujukan, dan penawaran ke
anggota harus ditinjau dari sisi hukum/perizinan sebelum menerima dana atau membayar nyata
(sejalan dengan `docs/security-audit-and-production-readiness.md` §5).

## 11. Rencana implementasi bertahap

Setiap fase meninggalkan aplikasi dalam keadaan **berfungsi** dan tidak merusak fitur lama.

### Fase 1 — Skema & mesin murni (tanpa UI, tanpa uang)
- Tambah enum + model (§4) ke `prisma/schema.prisma` + migrasi aditif.
- `src/lib/config/trading.ts`, `src/lib/services/trading-calculation.ts`,
  `profit-allocation.ts`, `trading-report-status.ts`, `profit-share-config.ts`.
- Uji murni: `trading-calculation.test.ts`, `profit-allocation.test.ts`.
- Verifikasi: `npm run typecheck`, `npm run lint`, uji murni.

### Fase 2 — Service DB & API admin
- `trading-record-service.ts`, `trading-report-service.ts`, `profit-payment-service.ts`,
  `member-profit-service.ts`, `src/lib/trading-validation.ts`.
- Rute `api/admin/trading/*` dengan RBAC + origin + rate limit + audit.
- Uji integrasi DB (impor duplikat, rekonsiliasi, lifecycle, idempotensi pembayaran).

### Fase 3 — RBAC, UI admin, dan audit trail
- Kapabilitas baru di `admin-permissions.ts` + uji matriks.
- Kartu "Manajemen Trading" pada `/admin` + komponen UI.
- Uji akses (RBAC/IDOR) dan uji audit sumber.

### Fase 4 — Dashboard anggota & pemisahan referral
- Bagian "Profit Trading Mingguan" + pemisahan Profit vs Bonus Referral.
- Label status (`status-labels.ts`), tautan nav bila perlu.
- Uji tampilan anggota (hanya data sendiri; "Dibayar" hanya bila terverifikasi).

### Fase 5 — Dokumentasi, pengujian penuh, dan konfigurasi
- `docs/profit-trading-module.md` + daftar konfigurasi menunggu persetujuan.
- `npm test` penuh, `npm run build`, dan (bila DB uji tersedia) verifikasi end-to-end.

## 12. Risiko yang ditemukan

| # | Risiko | Tingkat | Mitigasi |
| --- | --- | --- | --- |
| 1 | Nilai persentase/kerugian dikarang | **Tinggi (bisnis/hukum)** | gagal-tertutup; konfigurasi menunggu persetujuan (§10) |
| 2 | Salah hitung P&L / biaya ganda | Tinggi | fungsi murni + uji profit/loss/impas/biaya ganda |
| 3 | Impor CSV ganda / data demo masuk laporan aktual | Tinggi | kunci unik idempotensi + `sourceType` + uji khusus |
| 4 | Saldo berubah tanpa jejak | Tinggi | hanya `postLedgerEntry` + `AuditLog` + `verifyBalanceInvariant` |
| 5 | Laporan terbit lalu diubah diam-diam | Sedang–Tinggi | status append-only + koreksi berversi + approval history |
| 6 | Kebocoran data antar anggota (IDOR) | Sedang | query selalu dibatasi `userId` sesi + uji IDOR |
| 7 | Perubahan matriks izin merusak RBAC lama | Sedang | tambah kapabilitas tanpa mengubah yang ada + uji matriks |
| 8 | Tabel/enum baru membuat migrasi gagal di data lama | Rendah | migrasi aditif (CREATE saja), tanpa drop/rewrite |
| 9 | Menjanjikan profit tetap / profit fiktif saat rugi | Tinggi | kerugian ditampilkan transparan; tanpa alokasi otomatis |
| 10 | Integrasi API exchange menambah risiko kustodi | Sedang | read-only, tanpa withdrawal, secret di env/secret manager |

## 13. Cara memverifikasi (setelah implementasi)

```powershell
npm run typecheck          # tipe
npm run lint               # eslint
npm test                   # unit + integrasi (butuh database uji)
npm run build              # produksi
# opsional saat DB uji siap:
npm run db:test:setup ; npm test
```

## 14. Status lingkungan saat audit (batasan)

- `node v24.21.0`, `npm 11.19.0`; Prisma client sudah ter-generate.
- **Tidak ada PostgreSQL yang berjalan** di `localhost:5432` (uji koneksi: gagal) dan
  **daemon Docker tidak aktif** (`docker ps` gagal terhubung).
- Akibatnya: `prisma migrate deploy`, uji integrasi DB, `verify:*`, dan `build` yang butuh
  koneksi DB **belum bisa dijalankan** di lingkungan ini. Uji **murni** (tanpa DB) tetap bisa.
- Rekomendasi: jalankan `docker compose up -d postgres` (atau PostgreSQL lokal) dan
  `npm run db:test:setup` sebelum fase yang menyentuh database.

## 15. Langkah berikutnya

Fase 1 sudah selesai (lihat §16). Langkah berikutnya:

1. Jalankan migrasi di database pengembangan/uji (`npm run db:test:setup`, lalu
   `npx prisma migrate deploy`) ketika PostgreSQL tersedia — migrasi **belum dijalankan**
   di lingkungan audit ini.
2. **Fase 2** — service database + API admin (impor CSV, rekonsiliasi, lifecycle laporan,
   pembayaran idempoten) beserta uji integrasi database.
3. **Fase 3** — kapabilitas RBAC baru + kartu "Manajemen Trading" pada `/admin`.
4. **Fase 4** — bagian "Profit Trading Mingguan" di `/dashboard` dan pemisahan
   Profit vs Bonus Referral.
5. **Fase 5** — dokumentasi akhir + pengujian penuh.

**Tidak ada** pembayaran uang nyata yang diaktifkan otomatis di fase mana pun, dan tidak ada
satu pun angka pembagian hasil yang ditetapkan sebelum pemilik menyetujuinya (§10).

## 16. Status Fase 1 — SELESAI

Semua di bawah ini **aditif** dan sudah diverifikasi di lingkungan audit.

### 16.1 Skema database (`prisma/schema.prisma`, `+434` baris)

- 7 enum baru: `TradingSourceType`, `TradingRecordStatus`, `TradingReportStatus`,
  `TradingReconciliationStatus`, `ProfitAllocationStatus`, `ProfitPaymentStatus`,
  `ProfitSharePolicyStatus`.
- 1 nilai enum baru: `TransactionType.PROFIT_SHARE` (diletakkan di akhir, sesuai aturan
  PostgreSQL untuk penambahan nilai enum).
- 8 model baru: `TradingRecord`, `TradingReport`, `TradingReconciliation`, `ProfitAllocation`,
  `MemberProfitLedger`, `ProfitPayment`, `TradingApprovalHistory`, `ProfitSharePolicy`.
- 16 relasi balik baru pada model `User` (tanpa mengubah kolom/indeks/perilaku lama).
- Idempotensi bawaan: `TradingRecord @@unique([exchange, externalReference, sourceType])`,
  `TradingReport @@unique([periodStart, periodEnd, sourceType, version])`,
  `ProfitAllocation @@unique([reportId, memberId])`, `MemberProfitLedger.reference @unique`,
  `ProfitPayment.idempotencyKey @unique`.

### 16.2 Migrasi

- `prisma/migrations/20261016120000_profit_trading_module/migration.sql`.
- Dihasilkan dengan `prisma migrate diff` (membandingkan skema HEAD dengan skema saat ini),
  jadi SQL-nya persis yang akan ditulis Prisma — bukan tulisan tangan.
- Berisi hanya `CREATE TYPE`, `CREATE TABLE`, `CREATE INDEX`/`CREATE UNIQUE INDEX`,
  `ADD CONSTRAINT ... FOREIGN KEY`, dan satu `ALTER TYPE ... ADD VALUE`.
  Tidak ada `DROP`/`ALTER COLUMN`/`UPDATE`.
- **Belum dijalankan** karena tidak ada PostgreSQL di lingkungan ini (§14).

### 16.3 Mesin perhitungan murni (tanpa database)

| Berkas | Isi |
| --- | --- |
| `src/lib/config/trading.ts` | status, label Indonesia, mata uang, referensi ledger idempoten. **Tanpa** angka pembagian hasil. |
| `src/lib/services/trading-calculation.ts` | Net Trading P&L, biaya tidak dihitung dua kali, pemisahan realized/unrealized, pengecualian data DEMO, rekonsiliasi, periode mingguan UTC. |
| `src/lib/services/profit-share-config.ts` | validasi kebijakan bagi hasil; bawaan `PENDING_APPROVAL` (gagal-tertutup). |
| `src/lib/services/profit-allocation.ts` | pembagian setelah kebijakan disetujui, penanganan kerugian, pembulatan sisa terbesar, invarian `Σ alokasi ≤ yang dibagi`. |
| `src/lib/services/trading-report-status.ts` | mesin status laporan, transisi legal/ilegal, syarat penerbitan, ringkasan laporan. |

### 16.4 Pengujian murni (tanpa database, tanpa uang nyata)

| Berkas | Isi |
| --- | --- |
| `tests/trading-calculation.test.ts` | profit, **kerugian**, impas, biaya ganda, unrealized terpisah, **data demo dikecualikan**, belum-terverifikasi terhitung, masukan tidak valid ditolak, **selisih rekonsiliasi**, periode mingguan. |
| `tests/profit-allocation.test.ts` | **kebijakan belum disetujui memblokir pembagian**, perhitungan setelah disetujui, **periode rugi**, rasio salah ditolak, **pembagian proporsional**, **pembulatan tanpa kehilangan sen**, anggota tanpa dasar pembagian, invarian. |
| `tests/trading-report-status.test.ts` | transisi legal/ilegal, transisi dari status terbit/hanya koreksi, wajib alasan, **penerbitan diblokir** dengan daftar alasan, ringkasan kerugian & catatan unrealized. |

Perintah & hasil yang benar-benar dijalankan:

```powershell
npx prisma validate   # The schema at prisma\schema.prisma is valid
npm run typecheck     # tsc --noEmit, tanpa error
npm run lint          # eslint ., tanpa error
npm test -- tests/trading-calculation.test.ts tests/profit-allocation.test.ts tests/trading-report-status.test.ts
# tests 26 | pass 26 | fail 0
```

### 16.5 Yang **belum** dikerjakan (Fase 2–5)

Service database, rute API, kapabilitas RBAC baru, kartu admin "Manajemen Trading", bagian
dashboard anggota, impor CSV/unggah bukti, uji integrasi database, dan `prisma migrate deploy`.
Skema berubah, jadi uji integrasi database yang sudah ada **belum dijalankan ulang** di
lingkungan ini dan harus dijalankan begitu PostgreSQL uji tersedia.

## 17. Fase 1b — Perjanjian bagi hasil & impor CSV (SELESAI, murni)

Menutup dua kebutuhan yang tersisa sebelum Fase 2: **pengelolaan perjanjian (perjanjian
bagi hasil berversi)** dan **impor/validasi catatan trading dari CSV**. Semua perubahan
tetap aditif dan tidak ada satu pun angka pembagian yang ditetapkan di kode.

### 17.1 Skema (aditif)

| Perubahan | Rincian |
| --- | --- |
| `ProfitSharePolicy` → perjanjian | + `agreementNumber`, `agreementVersion`, `distributionMethod`, `pnlBasis`, `costTreatment`, `periodDefinition`, `correctionTerms`, `disputeTerms`, `effectiveTo`, `supersedesPolicyId`, `agreementDocumentKey`; + indeks `[agreementNumber, agreementVersion]`; relasi diri `supersedes`/`supersededBy`. |
| Model baru | `ProfitAgreementParty` — bukti persetujuan per pihak (`partyName`, `partyRole`, `userId?`, `agreedAt`, `evidenceStorageKey?`, `evidenceNote?`); unik `[policyId, partyName, partyRole]`. **Tanpa** persentase/nominal. |
| `TradingReport` | + `agreementId?` (FK ke versi perjanjian), `companyRetainedAmount`, `computationVersion`, `computationInputs`, `computationFormula`, `computedAt`. |
| `User` | + 1 relasi balik baru (`profitAgreementParties`) — tidak ada kolom/indeks lama yang berubah. |

Migrasi: `prisma/migrations/20261016140000_profit_agreement_module/migration.sql`.
Dihasilkan `prisma migrate diff` (`tmp/schema-baseline.prisma` → `prisma/schema.prisma`),
jadi SQL-nya persis keluaran Prisma. Isinya hanya `ADD COLUMN` (nullable/berdefault),
`CREATE TABLE`, `CREATE INDEX`, `ADD CONSTRAINT`; **tanpa** enum baru, `DROP`, atau
`ALTER COLUMN` — karena itu tidak ada batasan transaksi enum seperti migrasi sebelumnya.
Migrasi **belum dijalankan** (tidak ada PostgreSQL, §14).

### 17.2 Berkas baru / perluasan

| Berkas | Isi |
| --- | --- |
| `src/lib/services/profit-share-config.ts` (diperluas) | `AgreementTerms`, `AgreementPartyInput`, `ProfitAgreementInput`, `validateProfitAgreement`, `describeAgreementGaps`, `AGREEMENT_SNAPSHOT_VERSION`, `AgreementSnapshot`, `buildPolicySnapshot`. |
| `src/lib/trading-validation.ts` (baru) | skema zod 15 kolom CSV, normalisasi nilai, kunci anti-duplikat, pembaca CSV RFC 4180, templat unduh. Murni, tanpa database. |
| `tests/profit-agreement.test.ts` (baru) | 9 pengujian perjanjian + snapshot. |
| `tests/trading-import.test.ts` (baru) | 17 pengujian impor/validasi CSV. |

### 17.3 Keputusan penting (dan alasannya)

1. **Snapshot, bukan rujukan.** `buildPolicySnapshot` menyimpan salinan nilai versi
   perjanjian (nomor, versi, rasio sebagai string 4 desimal, istilah, pihak). Versi baru
   tidak pernah mengubah laporan lama; diuji dengan mengubah objek sumber setelah snapshot.
2. **Kunci berkas rahasia tidak ikut snapshot** — diganti boolean `hasAgreementDocument`
   dan `hasEvidence`.
3. **Presisi uang tidak pernah dibulatkan diam-diam.** Maksimal dua desimal; `10.001`
   ditolak (skema maupun `normalizeMoneyString` yang melempar `RangeError`), sedangkan
   `10` → `10.00` dan `-0` → `0.00` hanya penyeragaman penulisan.
4. **Waktu selalu UTC.** ISO 8601; tanggal tanpa jam diartikan `00:00 UTC`; waktu dengan
   zona (`+07:00`) dikonversi ke UTC supaya batas periode mingguan tidak bergeser.
5. **Sumber wajib eksplisit.** `sumber` hanya `ACTUAL`/`DEMO` (huruf besar); nilai kosong
   atau `aktual` ditolak, sehingga data demo tidak pernah bisa lolos menjadi laporan aktual.
6. **Duplikat ditolak dua arah.** Di dalam berkas dan terhadap database, memakai kunci yang
   sama dengan unique index `[exchange, externalReference, sourceType]`. Bursa dinormalkan
   ke huruf besar — nilai yang sama itulah yang disimpan, jadi database dan pemeriksaan
   aplikasi tidak pernah berbeda pendapat.
7. **Impor gagal-tertutup.** Berkas kosong, kolom wajib hilang, atau jumlah baris melebihi
   batas ⇒ `rows: []` (tidak ada satu pun catatan masuk) plus daftar galat per baris.

### 17.4 Perintah & hasil yang benar-benar dijalankan

```powershell
npx prisma validate                 # skema valid
npx prisma migrate diff --from-schema-datamodel tmp/schema-baseline.prisma `
  --to-schema-datamodel prisma/schema.prisma --script   # SQL aditif (dipakai untuk migrasi)
npx prisma generate                 # Prisma Client v6.19.3 berhasil
npm run typecheck                   # tsc --noEmit, tanpa error
npx eslint .                        # tanpa error
npx tsx --test --test-concurrency=1 tests/profit-agreement.test.ts tests/trading-import.test.ts
# tests 26 | pass 26 | fail 0
npx tsx --test --test-concurrency=1 tests/trading-calculation.test.ts `
  tests/profit-allocation.test.ts tests/trading-report-status.test.ts
# tests 26 | pass 26 | fail 0
npx tsx --test --test-concurrency=1 tests/trading-calculation.test.ts `
  tests/profit-allocation.test.ts tests/trading-report-status.test.ts `
  tests/profit-agreement.test.ts tests/trading-import.test.ts
# tests 52 | pass 52 | fail 0
```

### 17.5 Catatan lingkungan (penting)

`npm test` **tanpa argumen** belum bisa diselesaikan di lingkungan ini: 36 berkas uji ikut
dijalankan, dan berkas uji lain yang menyentuh database berhenti menunggu PostgreSQL
(`localhost:5432` tertutup), sehingga runner menggantung. Karena itu uji murni di atas
dijalankan langsung dengan `tsx --test` (tanpa menunggu database). Begitu PostgreSQL uji
tersedia: `docker compose up -d postgres`, `npx prisma migrate deploy`,
`npm run db:test:setup`, lalu `npm test`.

### 17.6 Yang belum dikerjakan (menunggu PostgreSQL uji + keputusan pemilik §10)

- Service database perjanjian (buat versi baru, ajukan, setujui, cabut) + API admin,
  termasuk unggah dokumen perjanjian dan bukti persetujuan pihak.
- Service impor catatan trading + rute unggah CSV (memakai `parseTradingCsv` +
  `existingKeys` dari database) dan penyimpanan berkas bukti di storage privat.
- Fase 2–5 seperti §16.5. **Belum ada** pembayaran uang nyata dan **belum ada** satu pun
  angka pembagian hasil yang ditetapkan sebelum pemilik menyetujui.

## 18. Fase 1c — Sumber modal, Validasi Aturan, kerugian, & pembayaran (SELESAI, murni)

Menutup empat kebutuhan yang tersisa sebelum service database: **pencatatan sumber modal
(Tahap 2)**, **gerbang validasi aturan agar pembagian ditandai `RULES_NOT_CONFIGURED`
alih-alih memakai aturan karangan (Tahap 4)**, **pencatatan kerugian aktual secara
terpisah (Tahap 5)**, serta **mesin status pembayaran dan kapabilitas RBAC trading
(Tahap 6/8)**. Semua perubahan tetap aditif dan tetap tanpa satu pun angka bisnis.

### 18.1 Skema (aditif)

| Perubahan | Rincian |
| --- | --- |
| `TradingReportStatus` | + nilai `RULES_VALIDATION` sebagai gerbang wajib antara `RECONCILIATION` dan `PENDING_APPROVAL`. |
| `TradingReport` | + `lossAmount` (kerugian aktual, selalu ≥ 0), `lossHandlingApplied` (ketentuan perjanjian yang dipakai), `carriedForwardLossAmount`, `lossHandlingNote`. **Tidak ada** kolom untuk memotong modal anggota atau mencatat utang anggota — ketiadaannya adalah pengaman. |
| Enum baru | `CapitalOwnerType` (`COMPANY`, `MEMBER`), `CapitalContributionStatus` (`RECORDED`, `VERIFIED`, `REJECTED`, `WITHDRAWN`), `CapitalMovementType` (`ALLOCATION`, `WITHDRAWAL`, `ADJUSTMENT`, `REVERSAL`). |
| Model baru | `TradingCapitalContribution` — satu baris = satu pencatatan modal (pemilik, anggota?, nominal, mata uang, tanggal efektif, status, `reference` unik, bukti privat, pencatat/pemeriksa). `TradingCapitalMovement` — riwayat perubahan alokasi modal (append-only, `reason` wajib, `revertsMovementId` untuk pembatalan). |
| `User` | + 4 relasi balik baru pada sumber modal; tidak ada kolom/indeks lama yang berubah. |

Migrasi: `prisma/migrations/20261017120000_trading_capital_and_rules_gate/migration.sql`
(135 baris). Dihasilkan `prisma migrate diff` (`tmp/schema-baseline.prisma` → `prisma/schema.prisma`),
berisi hanya `CREATE TYPE`, `ALTER TYPE ... ADD VALUE`, `ADD COLUMN` (nullable/berdefault),
`CREATE TABLE`, `CREATE INDEX`, dan `ADD CONSTRAINT`; **tanpa** `DROP`, `ALTER COLUMN`,
atau penghapusan baris (`Select-String 'DROP|ALTER COLUMN|DELETE|UPDATE '` hanya menemukan
`ON DELETE` di dalam `ADD CONSTRAINT`). Migrasi **belum dijalankan** (tidak ada PostgreSQL, §14).

### 18.2 Berkas baru / perluasan

| Berkas | Isi |
| --- | --- |
| `src/lib/services/trading-rules-validation.ts` (baru) | gerbang Validasi Aturan: 9 pemeriksaan (kompilasi, rekonsiliasi, catatan terverifikasi, data demo, kelengkapan & masa berlaku perjanjian, ketentuan rugi, dasar pembagian dari perjanjian) → `PASSED` / `BLOCKED` / `RULES_NOT_CONFIGURED`. |
| `src/lib/services/trading-loss-handling.ts` (baru) | penilaian periode rugi: `lossAmount` positif, ketentuan perjanjian yang dipakai, carry-forward **hanya** bila perjanjian menyetujuinya, serta `assertNoMemberLossCharge` (beban ke anggota selalu 0). |
| `src/lib/services/trading-capital.ts` (baru) | validasi pencatatan modal & pergerakannya, ringkasan modal terpisah perusahaan/anggota (pembatalan REVERSAL mengeluarkan pergerakan asal dari penjumlahan), `assertCapitalInvariant`, dan penegasan bahwa modal **tidak** menentukan hak profit. |
| `src/lib/services/profit-payment-status.ts` (baru) | mesin status pembayaran (`PENDING` → `PROCESSING` → `COMPLETED`/`FAILED`, `CANCELLED`, `FAILED` → `PENDING`), syarat "dibayar hanya setelah bukti diverifikasi", dan penolakan pembayaran berulang (kunci idempotensi + pembayaran aktif). |
| `src/lib/services/trading-report-status.ts` (diperluas) | transisi memuat `RULES_VALIDATION`; `evaluatePublicationReadiness` menambahkan penghalang `RULES_NOT_CONFIGURED`/`BLOCKED` dan mensyaratkan status `RULES_VALIDATION` sebelum pengajuan. |
| `src/lib/config/trading.ts` (diperluas) | label `RULES_VALIDATION`; konstanta modal (jenis pemilik, status pencatatan, jenis pergerakan, kunci idempotensi `capitalContributionKey`, teks tetap `CAPITAL_PROFIT_BASIS_NOTICE`). |
| `src/lib/auth/admin-permissions.ts` (diperluas) | 5 kapabilitas trading: `readTrading`, `manageTrading`, `approveTradingReport`, `recordProfitPayment`, `readTradingAudit` beserta peta peran (lihat `docs/admin-rbac-and-audit.md` §1). |
| `tests/trading-rules-validation.test.ts`, `tests/trading-capital.test.ts`, `tests/trading-loss-handling.test.ts`, `tests/profit-payment-status.test.ts` (baru) | 52 pengujian murni baru. |
| `tests/trading-report-status.test.ts`, `tests/admin-permissions.test.ts` (diperluas) | gerbang `RULES_VALIDATION` tidak dapat dilompati; matriks kapabilitas trading diuji per peran. |

### 18.3 Keputusan penting (dan alasannya)

1. **Gerbang aturan berdiri sendiri.** `RULES_VALIDATION` menjadi status tersendiri,
   bukan menumpang `RECONCILIATION`, supaya ada satu titik di mana sistem berhenti dan
   menyatakan "aturan tertulis belum ada" — dan transisi `RECONCILIATION → PENDING_APPROVAL`
   ditolak (diuji).
2. **Dua alasan yang dibedakan.** `RULES_NOT_CONFIGURED` berarti aturan/perjanjian belum
   lengkap atau belum disetujui (pembagian **tidak** dihitung sama sekali); `BLOCKED`
   berarti aturan sudah ada tetapi syarat data belum lolos (mis. masih ada catatan belum
   diverifikasi, selisih rekonsiliasi). UI dapat menjelaskan keduanya secara berbeda.
3. **Modal tidak pernah menjadi dasar hak profit.** Tidak ada satu pun fungsi yang
   mengubah nominal modal menjadi hak anggota; `capitalProfitBasisNotice()` mengembalikan
   teks tetap tanpa angka. Aturan ini juga diuji (modal perusahaan/anggota terpisah,
   modal ditolak bila jenis pemilik tidak sesuai).
4. **Kerugian dicatat, tidak dibebankan ke anggota.** `lossAmount` dipisahkan dari angka
   profit; `memberLossCharged` dan `memberPrincipalReduction` selalu `0` dan dijaga
   `assertNoMemberLossCharge` (uji menabrak `RangeError` bila diberi angka > 0).
   Carry-forward hanya muncul bila perjanjian yang disetujui memang memilih
   `CARRY_FORWARD`; tanpa perjanjian, statusnya `RULES_NOT_CONFIGURED`.
5. **Arah nilai modal ditentukan jenis pergerakan, bukan tanda angka.** `ALLOCATION`,
   `WITHDRAWAL`, dan `REVERSAL` positif; `ADJUSTMENT` boleh negatif sebagai saluran
   koreksi eksplisit. Pembatalan (REVERSAL) mengeluarkan pergerakan asal dari
   penjumlahan, sehingga "berapa modal yang dikelola" selalu dapat dihitung ulang dari
   riwayat — bukan dari angka yang ditimpa.
6. **"Dibayar" hanya setelah bukti diverifikasi.** `evaluatePaymentCompletion`
   mensyaratkan bukti, admin pemverifikasi, dan waktu verifikasi. Pembayaran gagal
   (`FAILED`) boleh dicatat ulang; pembayaran berulang ditolak lewat kunci idempotensi
   atau keberadaan pembayaran aktif pada hak anggota yang sama.
7. **Pemetaan istilah spesifikasi (tanpa mengubah nilai enum).** Spesifikasi menyebut
   `PAID`/`REVERSED`; sistem memakai `ProfitPaymentStatus` yang sudah ada: `PAID` →
   `COMPLETED`, `REVERSED` → `CANCELLED`. Tidak ada `DROP`/`RENAME` nilai enum, jadi
   tidak ada perubahan destruktif pada database.
8. **Kapabilitas trading terpisah dari `manageFinance`.** `manageTrading`,
   `approveTradingReport`, dan `recordProfitPayment` hanya untuk SUPER_ADMIN dan FINANCE;
   COMPLIANCE membaca laporan + jejak audit tanpa bisa mengubah; SUPPORT dan VIEWER hanya
   membaca. Aturan "penyetuju harus berbeda dari pembuat laporan" tetap
   **menunggu keputusan pemilik** (§10 butir 7) — sistem hanya mencatat siapa melakukan apa.

### 18.4 Perintah & hasil yang benar-benar dijalankan

```powershell
npx prisma format ; npx prisma validate    # The schema at prisma\schema.prisma is valid
npx prisma generate                        # Generated Prisma Client (v6.19.3)
npx prisma migrate diff --from-schema-datamodel tmp/schema-baseline.prisma `
  --to-schema-datamodel prisma/schema.prisma --script   # SQL aditif → berkas migrasi
npx prisma migrate diff --from-schema-datamodel tmp/schema-baseline.prisma `
  --to-schema-datamodel prisma/schema.prisma            # No difference detected (baseline disegarkan)
npm run typecheck                          # tsc --noEmit, tanpa error
npm run lint                               # eslint ., tanpa error
npm test -- tests/trading-calculation.test.ts tests/profit-allocation.test.ts `
  tests/trading-report-status.test.ts tests/profit-agreement.test.ts `
  tests/trading-import.test.ts tests/trading-rules-validation.test.ts `
  tests/trading-capital.test.ts tests/trading-loss-handling.test.ts `
  tests/profit-payment-status.test.ts tests/admin-permissions.test.ts
# tests 104 | pass 104 | fail 0
```

Setelah PostgreSQL uji tersedia (lihat §18.6), dua perintah lanjutan juga dijalankan:

```powershell
npm run db:migrate        # 17 migrations found -> all applied, "Database schema is up to date!"
npm run db:test:setup     # database uji localhost:5432/tatorprofit_test disiapkan
npm test                  # tests 520 | pass 520 | fail 0
```

### 18.5 Yang belum dikerjakan (menunggu PostgreSQL uji + keputusan pemilik §10)

- Service database: pengelolaan perjanjian (versi, ajukan, setujui, cabut, unggah dokumen
  & bukti pihak), pencatatan sumber modal + pergerakannya, impor catatan trading
  (`parseTradingCsv` + `existingKeys` dari database), kompilasi laporan mingguan,
  alokasi hak anggota, dan pencatatan pembayaran profit (semuanya belum ada).
- Rute API admin/anggota + validasi zod di backend, penyimpanan bukti di storage privat,
  serta kartu "Manajemen Trading" di `/admin` dan bagian "Profit Trading Mingguan" di
  `/dashboard`.
- 8 berkas uji integrasi database pada §9 dan `tests/trading-access.test.ts` (RBAC + IDOR +
  audit sumber UI) **belum dibuat**: keduanya menuntut PostgreSQL uji.
- `prisma migrate deploy` **sudah dijalankan** pada PostgreSQL lokal (17/17 migrasi terpasang,
  lihat §18.6); `npm run db:test:setup` juga sudah dijalankan. Yang tetap belum adalah
  penerapan ke server staging/production (menunggu VPS sesuai `docs/deployment-staging-vps.md`).
- Keputusan pemilik §10 (persentase bagi hasil, penanganan kerugian, biaya pengelolaan,
  pendanaan referral, definisi `PAID` laporan) masih **MENUNGGU**; selama itu pembagian
  hasil tetap 0 dengan alasan yang dinyatakan apa adanya, dan tidak ada uang nyata berpindah.

### 18.6 Penerapan pertama ke PostgreSQL lokal (dan satu temuan penting)

Lingkungan: Docker Desktop beserta layanan `postgres` dari `docker-compose.yml`
(`postgres:16-alpine`, `localhost:5432/tatorprofit`, volume `tatorprofit-pgdata`), aplikasi
`npm run dev` di `http://localhost:3000`.

1. `npm run db:migrate` **gagal pada percobaan pertama**: `P3018`, kode `42601`,
   `syntax error at or near "node"`. Penyebabnya bukan SQL-nya, melainkan **isi berkas
   migrasi**: 11 baris keluaran peringatan PowerShell/Node (`node.exe : warn The
   configuration property package.json#prisma is deprecated ...`, `At line:1 char:1`,
   `CategoryInfo`, `FullyQualifiedErrorId`, dst.) ikut tertulis ke `migration.sql` saat
   berkas dibuat dengan pengalihan keluaran (`>`).
2. Diperbaiki dengan membuang baris-baris itu (posisi 1907 ≈ posisi error 1908). Tidak ada
   objek setengah jadi: `pg_class` menunjukkan hanya `TradingReport` yang ada, sementara
   `TradingCapitalContribution` / `TradingCapitalMovement` belum terbentuk.
3. `npx prisma migrate resolve --rolled-back 20261017120000_trading_capital_and_rules_gate`,
   lalu `npm run db:migrate` berhasil — ketiga migrasi modul trading terpasang dan
   `npx prisma migrate status` melaporkan **"Database schema is up to date!"** (17/17).
4. Verifikasi langsung ke database: `TradingReportStatus` memuat `RULES_VALIDATION`;
   `CapitalOwnerType`, `CapitalContributionStatus`, `CapitalMovementType` ada dengan nilai
   yang benar; tabel `TradingCapitalContribution` dan `TradingCapitalMovement` ada;
   `TradingReport` memuat `lossAmount` dan `carriedForwardLossAmount` (NOT NULL) serta
   `lossHandlingApplied` dan `lossHandlingNote` (nullable).
5. `npm test` untuk **seluruh** suite (520 uji, termasuk uji integrasi database) menemukan
   **1 kegagalan lama yang sebelumnya tersembunyi** karena suite tidak pernah bisa berjalan:
   `tests/anti-fraud.test.ts` menuntut spasi tunggal pada `/registrationIp String\?/`,
   sedangkan `prisma format` menyejajarkan kolom (`registrationIp    String?`). Assertion
   dibuat toleran spasi (`\s+`) — maksudnya tidak berubah, hanya tidak lagi rapuh terhadap
   perataan kosmetik. Setelah perbaikan: **520/520 lulus, 0 gagal**.
6. Pelajaran yang dicatat: (a) **jangan** mengalihkan keluaran `prisma` ke berkas migrasi
   dengan `>` / `*>` — salin hanya isi SQL-nya; (b) assertion terhadap berkas skema harus
   toleran spasi.

Data demo lokal disiapkan `npm run demo:local` (lihat kredensial yang dicetak skrip itu),
dan akun `demo_admin` (SUPER_ADMIN) serta `demo_member` (USER) sudah terbukti dapat masuk
lewat `POST /api/auth/login` pada aplikasi yang berjalan.
