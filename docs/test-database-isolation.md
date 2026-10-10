# Pemisahan Database Pengujian (Bagian 2 dan 8)

Dokumen ini menjelaskan cara suite pengujian dan skrip pemeliharaan dipisahkan dari
database aplikasi. Aturan di sini **hanya** soal pemisahan lingkungan: tidak ada satu
pun aturan keuangan yang berubah, tidak ada saldo yang dipindahkan, dan tidak ada akun
demo yang diubah menjadi akun nyata.

## 1. Kenapa wajib dipisahkan

Suite pengujian menulis data nyata ke PostgreSQL: akun uji, keanggotaan program, entri
ledger, baris audit, notifikasi, dan **tarif rabat global** di tabel `RebateConfig`
yang ikut menentukan perhitungan komisi. Sebelum pemisahan ini, `npm test` memakai
`DATABASE_URL` yang sama dengan aplikasi, sehingga menjalankan suite di komputer
produksi/staging dapat menimpa konfigurasi rabat yang sedang dipakai.

Aplikasi memakai satu singleton Prisma (`src/lib/prisma.ts`), jadi mengalihkan suite ke
database uji tidak boleh dilakukan di dalam berkas uji. Pengalihan harus terjadi
**sebelum proses uji dimulai**.

## 2. Aturan yang ditegakkan kode

`src/lib/config/test-database.ts` menolak konfigurasi berikut:

1. `NODE_ENV=production` atau `staging` — pengujian tidak pernah dijalankan di
   lingkungan seperti produksi (lihat `src/lib/config/production-environment.ts`).
2. `TEST_DATABASE_URL` kosong atau bukan URL PostgreSQL.
3. Nama database uji tidak memuat kata `test` (mis. `tatorprofit_test`), agar tidak
   mudah tertukar dengan `tatorprofit`.
4. Database uji sama dengan database aplikasi (`DATABASE_URL`) — dibandingkan
   berdasarkan host, port, nama database, dan `schema`.
5. Proses uji dijalankan langsung (mis. `tsx --test`) tanpa lewat runner, sehingga
   singleton Prisma masih menunjuk database aplikasi
   (`tests/helpers/prisma.ts` memanggil `assertSandboxedTestProcess`).

Skrip pemeliharaan memakai `src/lib/config/maintenance-guard.ts`:

- `scripts/demo-reset.ts` menolak produksi **dan** staging, serta menolak berjalan tanpa
  `--confirm` sebelum menghapus akun demo dan melewati proteksi ledger.
- `scripts/demo-local.ts`, `scripts/verify-e2e.ts`, `scripts/verify-routes.ts`,
  `scripts/verify-payments.ts` menolak berjalan di produksi maupun staging.

## 3. Menyiapkan database uji (sekali per mesin)

Buat database terpisah, lalu isi `TEST_DATABASE_URL` di `.env`:

```powershell
# contoh: PostgreSQL lokal
createdb -U tatorprofit tatorprofit_test

# .env
TEST_DATABASE_URL="postgresql://tatorprofit:tatorprofit@localhost:5432/tatorprofit_test?schema=public"
```

Jalankan migrasi resmi dan seed konfigurasi program pada database uji:

```powershell
npm run db:test:setup
```

Skrip itu menjalankan `prisma migrate deploy` dan `prisma/seed.ts` dengan
`DATABASE_URL` diganti `TEST_DATABASE_URL`. Skrip tidak pernah menghapus, mereset,
atau memigrasi database aplikasi.

## 4. Menjalankan pengujian

```powershell
npm test                        # seluruh suite (tests/*.test.ts)
npm test -- tests/rebate-config.test.ts   # satu berkas
```

Runner `scripts/run-tests.ts` mencetak database uji dan database aplikasi lebih dulu,
lalu menjalankan `node --test` (lewat tsx) dengan:

- `DATABASE_URL` = `TEST_DATABASE_URL`
- `NODE_ENV=test`
- `TATORPROFIT_APP_DATABASE_URL` = URL database aplikasi (dipakai penjaga untuk
  memastikan keduanya berbeda)

Bila `TEST_DATABASE_URL` belum diisi, pengujian berhenti sebelum menyentuh database
apa pun dan menampilkan instruksi perbaikannya.

## 5. Yang belum termasuk

- Pemisahan kredensial per lingkungan (akun database berbeda dengan hak akses terbatas,
  atau penyimpanan secret terkelola) tetap menjadi tugas operator/infrastruktur.
- Migrasi produksi tetap memakai `npm run db:migrate` dengan `DATABASE_URL` produksi;
  jalur itu tidak diubah oleh pengamanan ini.
