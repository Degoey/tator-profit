# Panduan Deployment Staging ke VPS (Langkah 4)

Dokumen ini adalah panduan deployment **staging** TatorProfit ke sebuah VPS Linux.
Staging dipakai untuk pengujian internal dengan **data simulasi** — bukan untuk uang
nyata, dan **tanpa** gateway pembayaran. Aturan staging sengaja dibuat seketat produksi
(`src/lib/config/production-environment.ts`), tetapi terpisah penuh dari development.

> **Status:** dokumen ini disusun dari kondisi nyata repositori. Langkah yang
> bergantung pada detail VPS (alamat IP, domain, OS, penyedia) ditandai `TODO-VPS`
> dan **harus** diisi operator sebelum perintah dijalankan. Tidak ada perintah di
> dokumen ini yang boleh dijalankan terhadap server produksi.

## 1. Teknologi aplikasi (hasil audit)

| Aspek | Nilai nyata di repositori |
| --- | --- |
| Framework | Next.js 16 (App Router) + React 19 |
| Bahasa | TypeScript 5.9 (strict) |
| Runtime | Node.js 24 (Dockerfile: `node:24-alpine`; lokal: v24.21.0) |
| Package manager | npm (`package-lock.json`, instalasi memakai `npm ci`) |
| Database | PostgreSQL 16, diakses lewat Prisma 6.19.3 |
| ORM & migrasi | Prisma Migrate (`prisma/migrations`, 14 migrasi) |
| Styling | Tailwind CSS 4 |
| Autentikasi | Sesi token HMAC kustom + `bcryptjs` (tanpa layanan pihak ketiga) |
| Output build | `output: "standalone"` → `.next/standalone/server.js` |
| Pembayaran | **Tidak ada gateway.** Setoran/penarikan sepenuhnya manual |

**Perintah aplikasi (dari `package.json`):**

- Build: `npm run build` (`next build`)
- Jalankan: `node server.js` (standalone) — kompatibel `npm start`
- Migrasi: `npm run db:migrate` (`prisma migrate deploy`)
- Seed konfigurasi program: `npm run db:seed`
- Uji: `npm test` (wajib `TEST_DATABASE_URL`, DB terpisah bernama memuat `test`)
- Kualitas: `npm run lint`, `npm run typecheck`

**Hasil pengujian terakhir yang tersedia (artefak QA di repositori):**

- `qa-test-part12.txt` / `qa-run-latest.txt`: **344 lulus, 0 gagal**
- `qa-latest-lint.txt`: bersih (`eslint .` tanpa temuan)
- `qa-latest-typecheck.txt`: bersih (`tsc --noEmit`)

## 2. Persyaratan server (TODO-VPS: sesuaikan dengan VPS nyata)

Minimal yang harus dipastikan sebelum mulai:

- OS Linux 64-bit dengan pengguna `sudo` (mis. Ubuntu 22.04/24.04).
- Docker Engine + Docker Compose plugin terpasang.
- RAM ≥ 2 GB (build Next + Node 24 + Postgres 16). Disk ≥ 10 GB kosong.
- Port **80** dan **443** bebas (untuk reverse proxy + HTTPS).
- Domain/subdomain staging sudah diarahkan (A/AAAA record) ke IP VPS — mis.
  `staging.tatorprofit.example` (`TODO-VPS`).
- Akses SSH dengan kunci (bukan kata sandi), dan firewall aktif (`ufw`/setara).

> Aplikasi **tidak** membutuhkan port database terbuka ke internet. PostgreSQL hanya
> diakses dari dalam jaringan Docker Compose.

## 3. File konfigurasi yang dibuat/diperbaiki

Ditambahkan di repositori (aman, tanpa rahasia):

| File | Fungsi |
| --- | --- |
| `docs/deployment-staging-vps.md` | Panduan ini |
| `deploy/staging.env.example` | Template variabel lingkungan staging (tanpa nilai rahasia) |
| `docker-compose.staging.yml` | Compose staging: DB terisolasi, tanpa publish port DB, aman di-deploy ulang |
| `deploy/nginx/tatorprofit-staging.conf` | Reverse proxy + TLS untuk domain staging |
| `scripts/backup-db.sh` | Backup `pg_dump` (format custom, terkompresi) + rotasi |
| `scripts/restore-db.sh` | Pemulihan dari berkas backup (butuh konfirmasi eksplisit) |

File yang **diperbaiki** (perlu di-commit sebelum deploy):

| File | Perubahan yang perlu |
| --- | --- |
| `Dockerfile` | Sudah multi-stage, non-root (uid 1001), standalone — **belum di-commit** |
| `.dockerignore` | Ada — **belum di-commit** |
| `docker-compose.yml` | Perubahan lokal **belum di-commit** |
| `.env.example` | Perubahan lokal **belum di-commit** |
| `next.config.ts` | Perubahan lokal **belum di-commit** |

> **Rahasia tidak pernah dibuat di sini.** Berkas `.env.staging` (berisi kredensial
> nyata) dibuat **hanya di VPS**, dengan izin `chmod 600`, dan tidak pernah di-commit
> (sudah dicakup `.gitignore`: `.env.*`, `*.key`, `*.pem`, `secrets/`).

## 4. Perintah yang akan dijalankan

### 4.1 Di komputer lokal (aman — menyiapkan repositori)

```powershell
# 1. Rekonsiliasi riwayat dengan origin (main saat ini: ahead 4, behind 1)
git fetch origin
git --no-pager log --oneline --graph --decorate --all -15   # periksa dulu, jangan langsung merge

# 2. Commit artefak deployment (tanpa rahasia) pada branch kerja, lalu push
git add Dockerfile .dockerignore docker-compose.yml .env.example next.config.ts `
        deploy/ docs/deployment-staging-vps.md scripts/backup-db.sh scripts/restore-db.sh
git commit -m "chore(deploy): artefak dan panduan deployment staging"
git push origin main
```

### 4.2 Di VPS (butuh persetujuan — memengaruhi server)

```bash
# TODO-VPS: sesuaikan USER, DOMAIN, dan path. Jangan jalankan bila ada aplikasi
# lain di direktori ini — pakai direktori terpisah agar tidak menimpa apa pun.

# 3. Buat pengguna sistem tanpa hak root untuk deploy
sudo adduser --disabled-password --gecos "" tator
sudo usermod -aG docker tator        # catatan least-privilege di §5

# 4. Ambil kode
sudo -iu tator
git clone https://github.com/Degoey/tator-profit.git /home/tator/tator-profit-staging
cd /home/tator/tator-profit-staging
git checkout main

# 5. Siapkan rahasia staging (buat nilainya di VPS, JANGAN commit)
cp deploy/staging.env.example .env.staging
#   -> isi AUTH_TOKEN_SECRET dengan nilai acak >= 32 karakter:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
#   -> isi POSTGRES_PASSWORD dengan nilai acak kuat, lalu:
chmod 600 .env.staging

# 6. Build image dan jalankan (nama proyek compose terpisah)
docker compose -p tatorprofit-staging \
  --env-file .env.staging -f docker-compose.staging.yml build
docker compose -p tatorprofit-staging \
  --env-file .env.staging -f docker-compose.staging.yml up -d

# 7. Migrasi + seed konfigurasi program (JANGAN pakai `migrate dev`/`reset`)
docker compose -p tatorprofit-staging exec app \
  node node_modules/prisma/build/index.js migrate deploy
docker compose -p tatorprofit-staging exec app npm run db:seed
```

### 4.3 Reverse proxy + HTTPS (butuh persetujuan)

```bash
# TODO-VPS: ganti staging.tatorprofit.example dengan domain nyata.
sudo cp deploy/nginx/tatorprofit-staging.conf /etc/nginx/sites-available/tatorprofit-staging
sudo ln -s /etc/nginx/sites-available/tatorprofit-staging /etc/nginx/sites-enabled/tatorprofit-staging
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d staging.tatorprofit.example   # menerbitkan TLS
```

### 4.4 Firewall (butuh persetujuan — jangan pernah menonaktifkan firewall)

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status verbose      # port 5432 dan 3000 TIDAK boleh terbuka
```

### 4.5 Backup & pemulihan database

```bash
# Backup (selalu sebelum migrasi). Menyimpan ke ./backups, format custom terkompresi.
scripts/backup-db.sh

# Pemulihan — DESTRUKTIF terhadap database tujuan, jadi butuh konfirmasi eksplisit.
# Uji dulu pada database uji terpisah, bukan pada data berharga.
scripts/restore-db.sh backups/tatorprofit_staging_YYYYmmdd_HHMMSS.dump
```

## 5. Risiko dan cara pemulihan

| Risiko | Pencegahan | Pemulihan |
| --- | --- | --- |
| Migrasi gagal di tengah jalan | `scripts/backup-db.sh` **sebelum** `migrate deploy` | `scripts/restore-db.sh <berkas.dump>` |
| Salah `NEXT_PUBLIC_APP_URL` | Diisi sebelum `docker build` (nilai di-*inline* saat build) | Perbaiki `.env.staging`, `build` ulang, `up -d` |
| Kredensial DB lemah/terekspos | Password acak + `chmod 600` + port DB tidak dipublish | Rotasi password, recreate container |
| Bentrok port dengan aplikasi lain | Compose staging memakai proyek & nama container terpisah | Ubah pemetaan port host di `docker-compose.staging.yml` |
| Menimpa aplikasi lain di VPS | Direktori & nama proyek terpisah; **tidak** menyentuh stack lain | Hentikan hanya stack `tatorprofit-staging` |
| Uang nyata masuk | Tidak ada gateway pembayaran; DB staging terpisah; jangan aktifkan apa pun | Hentikan container; tinjau jejak audit |
| Data demo dianggap nyata | Database staging baru dan kosong; akun dibuat manual untuk uji | Kosongkan DB staging bila perlu (butuh persetujuan) |

**Hak akses minimal.** Aplikasi berjalan sebagai user non-root di dalam container
(uid 1001, dari `Dockerfile`). Di sisi host, hindari menambahkan pengguna deploy ke
grup `docker` bila memungkinkan (keanggotaan `docker` setara root); alternatifnya
gunakan `sudo docker` terbatas atau rootless Docker. Akun database staging hanya
memiliki hak atas database `tatorprofit_staging`, bukan superuser.

## 6. Checklist pengujian pasca-deployment

- [ ] `docker compose ps` menunjukkan `postgres` **healthy** dan `app` **running**
- [ ] `curl -I https://<domain>/` mengembalikan `200` dan header keamanan
      (`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`)
- [ ] Registrasi akun uji berhasil; login berhasil; cookie sesi `Secure`
- [ ] `prisma migrate deploy` melaporkan "No pending migrations" pada run berikutnya
- [ ] Setoran manual uji + unggah bukti pembayaran tersimpan di volume
- [ ] Log `docker compose logs app` bebas `[audit-log-failure]` / `[security-event-failure]`
- [ ] `scripts/backup-db.sh` menghasilkan berkas; `scripts/restore-db.sh` diuji di DB uji
- [ ] HTTPS valid (sertifikat terbit, redirect 80→443)
- [ ] Port 5432/3000 tidak dapat diakses dari internet

## 7. Catatan penting (keterbatasan yang jujur)

1. **Belum ada endpoint kesehatan khusus.** Healthcheck Compose dan Nginx memakai
   `/` (halaman publik mengembalikan 200). Endpoint `/api/health` **belum ada**;
   penambahannya adalah perubahan kode terpisah bila diinginkan.
2. **Belum ada backup terjadwal.** Skrip disediakan, tetapi penjadwalan (cron/systemd
   timer) dan uji pemulihan berkala masih tugas operator.
3. **Manajemen secret masih berbasis berkas `.env`.** Penyimpanan terkelola (vault)
   dan rotasi berkala belum ada (lihat `docs/security-audit-and-production-readiness.md`).
4. **CSP/HSTS belum dipasang di aplikasi** — tanggung jawab lapisan deployment
   (header keamanan dasar sudah dipasang di `next.config.ts`).
5. Aplikasi ini **belum siap menerima dana publik** (lihat §5 dokumen audit keamanan).
   Staging hanya untuk pengujian internal dengan data simulasi.
