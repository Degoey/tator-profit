-- Konsol Pemilik — pendaftaran 2FA (TOTP) untuk satu akun pemilik.
--
-- Murni menambah: lima kolom baru, tidak ada baris yang ditulis ulang, tidak ada
-- saldo/komisi yang disentuh, dan tidak ada yang dihapus. Kolom-kolom ini hanya
-- dibaca oleh Konsol Pemilik (`/owner`), jadi aplikasi yang sedang berjalan tetap
-- berperilaku sama setelah migrasi diterapkan.
--
--  * "User"."ownerTotpSecret"        — rahasia TOTP, tersimpan TERENKRIPSI
--                                      (AES-256-GCM, kunci `OWNER_2FA_KEY`), bukan
--                                      teks biasa, sehingga salinan database saja
--                                      tidak cukup untuk meniru kode autentikator.
--  * "User"."ownerTotpEnabledAt"     — terisi hanya setelah pendaftaran dikonfirmasi
--                                      dengan satu kode yang sah.
--  * "User"."ownerTotpRecoveryCodes" — hash HMAC kode pemulihan sekali-pakai.
--  * "User"."ownerTotpLastStep"      — langkah TOTP terakhir yang dipakai (anti replay).
--  * "Session"."totpVerifiedAt"      — kapan sesi ini lolos verifikasi 2FA (step-up).

-- AlterTable
ALTER TABLE "User" ADD COLUMN "ownerTotpSecret" TEXT;
ALTER TABLE "User" ADD COLUMN "ownerTotpEnabledAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "ownerTotpRecoveryCodes" JSONB;
ALTER TABLE "User" ADD COLUMN "ownerTotpLastStep" INTEGER;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN "totpVerifiedAt" TIMESTAMP(3);
