-- Bank / e-wallet pendaftar.
--
-- Setiap akun Tatorprofit yang dibuat melalui /register kini menyertakan pilihan
-- Bank/E-Wallet (kode stabil, divalidasi di `registerSchema`). Kolomnya nullable
-- agar baris User yang sudah ada sebelum penerapan fitur ini tetap valid; akun
-- baru selalu diisi oleh service pendaftaran. Purely additive: tidak ada kolom
-- yang diubah atau dihapus.
ALTER TABLE "User" ADD COLUMN "bank" TEXT;