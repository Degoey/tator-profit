-- Fitur Persentase Komisi Rabat.
--
-- Tabel ini menjadi sumber data utama persentase rabat lima generasi yang
-- dipakai bersama oleh beranda member, dashboard admin, dan mesin perhitungan
-- komisi. Hanya generasi 1 sampai 5 yang sah; generasi 6 dan seterusnya ditolak
-- oleh CHECK constraint sehingga tidak mungkin tersimpan.
--
-- Nilai awal mengikuti konfigurasi sistem yang sudah berjalan (10%, 2%, 1%, 1%,
-- 1%) supaya perilaku perhitungan tidak berubah saat migrasi diterapkan. Baris
-- komisi historis menyimpan tarifnya sendiri, jadi konfigurasi ini tidak pernah
-- menulis ulang transaksi rabat yang sudah terjadi.

CREATE TABLE "RebateConfig" (
    "generation" INTEGER NOT NULL,
    "rate" DECIMAL(7,4) NOT NULL,
    "updatedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RebateConfig_pkey" PRIMARY KEY ("generation")
);

-- Generasi 6 dan seterusnya tidak pernah disediakan oleh sistem.
ALTER TABLE "RebateConfig"
    ADD CONSTRAINT "RebateConfig_generation_range" CHECK ("generation" BETWEEN 1 AND 5);

-- Seed default rates used by the running system (matches src/lib/config/referral.ts).
INSERT INTO "RebateConfig" ("generation", "rate", "createdAt", "updatedAt") VALUES
    (1, 0.1000, NOW(), NOW()),
    (2, 0.0200, NOW(), NOW()),
    (3, 0.0100, NOW(), NOW()),
    (4, 0.0100, NOW(), NOW()),
    (5, 0.0100, NOW(), NOW())
ON CONFLICT ("generation") DO NOTHING;
