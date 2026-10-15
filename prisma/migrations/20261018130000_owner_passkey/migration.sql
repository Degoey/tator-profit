-- Konsol Pemilik — ganti 2FA TOTP dengan passkey WebAuthn (sidik jari / Face ID).
--
--  * Menghapus empat kolom TOTP dari "User": "ownerTotpSecret",
--    "ownerTotpEnabledAt", "ownerTotpRecoveryCodes", dan "ownerTotpLastStep".
--    Tidak ada lagi rahasia bersama yang disimpan server, jadi kunci enkripsi
--    `OWNER_2FA_KEY` pun tidak diperlukan.
--  * Menambah "User"."ownerPasskeyChallenge": tantangan (challenge) WebAuthn yang
--    sedang berjalan untuk pendaftaran atau verifikasi berikutnya. Ditimpa pada
--    setiap langkah dan dibersihkan setelah dipakai.
--  * Membuat tabel "OwnerPasskey": satu baris per kredensial passkey (kunci publik,
--    penghitung tanda tangan, metadata perangkat). Kunci privat tidak pernah
--    meninggalkan perangkat pemilik, jadi salinan database tidak cukup untuk
--    meniru verifikasi.
--
-- "Session"."totpVerifiedAt" sengaja TIDAK diubah: kolom itu tetap menjadi penanda
-- "sesi ini sudah lolos verifikasi kedua" (kini passkey, bukan kode TOTP), sehingga
-- mekanisme step-up per sesi tetap sama dan tidak ada data yang perlu dimigrasikan.
--
-- Tidak ada saldo, komisi, atau transaksi yang disentuh oleh migrasi ini.

-- AlterTable
ALTER TABLE "User" DROP COLUMN "ownerTotpSecret",
DROP COLUMN "ownerTotpEnabledAt",
DROP COLUMN "ownerTotpRecoveryCodes",
DROP COLUMN "ownerTotpLastStep",
ADD COLUMN     "ownerPasskeyChallenge" TEXT;

-- CreateTable
CREATE TABLE "OwnerPasskey" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" BYTEA NOT NULL,
    "counter" BIGINT NOT NULL DEFAULT 0,
    "deviceType" TEXT NOT NULL,
    "backedUp" BOOLEAN NOT NULL DEFAULT false,
    "transports" TEXT[],
    "friendlyName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "OwnerPasskey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OwnerPasskey_credentialId_key" ON "OwnerPasskey"("credentialId");

-- CreateIndex
CREATE INDEX "OwnerPasskey_userId_idx" ON "OwnerPasskey"("userId");

-- AddForeignKey
ALTER TABLE "OwnerPasskey" ADD CONSTRAINT "OwnerPasskey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
