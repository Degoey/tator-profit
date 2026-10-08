-- Bagian 5 — 27 kombinasi program (9 nominal x 3 durasi) dan mata uang USDT.
--
-- 1. `ProgramCycle` menyimpan durasi program (4 / 8 / 12 minggu) beserta snapshot
--    `weeklyRewardRate` dan `targetCycleRewardRate = weeklyRewardRate * cycleWeeks`
--    (40% / 80% / 120%). Sembilan `ProgramTier` x tiga `ProgramCycle` adalah 27
--    kombinasi program; tidak ada satu pun kombinasi yang dibuat dengan kode
--    terpisah.
-- 2. Setiap keanggotaan (`UserProgram`) menyimpan `cycleId` dan tetap menyimpan
--    snapshot tarif/durasi pada barisnya sendiri, sehingga perubahan konfigurasi
--    di masa depan tidak mengubah program lama secara retroaktif.
-- 3. Semua kolom mata uang diubah dari USD ke USDT.
--
-- Migrasi ini tidak menghapus satu baris data pun: hanya menambah struktur,
-- mengisi baris konfigurasi yang belum ada, dan menyelaraskan nilai mata uang.

-- 1. Tabel durasi program -----------------------------------------------------
CREATE TABLE "ProgramCycle" (
    "id" UUID NOT NULL,
    "programId" UUID NOT NULL,
    "cycleWeeks" INTEGER NOT NULL,
    "weeklyRewardRate" DECIMAL(7,4) NOT NULL,
    "targetCycleRewardRate" DECIMAL(7,4) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProgramCycle_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProgramCycle_programId_cycleWeeks_key" ON "ProgramCycle"("programId", "cycleWeeks");
CREATE INDEX "ProgramCycle_programId_isActive_cycleWeeks_idx" ON "ProgramCycle"("programId", "isActive", "cycleWeeks");

ALTER TABLE "ProgramCycle"
  ADD CONSTRAINT "ProgramCycle_programId_fkey"
  FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Durasi program hanya boleh 4, 8, atau 12 minggu (tidak ada minggu 13).
ALTER TABLE "ProgramCycle"
  ADD CONSTRAINT "ProgramCycle_cycleWeeks_check" CHECK ("cycleWeeks" IN (4, 8, 12));

-- targetCycleRewardRate selalu tepat sama dengan weeklyRewardRate x cycleWeeks.
ALTER TABLE "ProgramCycle"
  ADD CONSTRAINT "ProgramCycle_targetRate_check"
  CHECK ("targetCycleRewardRate" = ROUND("weeklyRewardRate" * "cycleWeeks", 4));

-- 2. Isi durasi 4 / 8 / 12 minggu untuk setiap program yang sudah ada ----------
INSERT INTO "ProgramCycle" (
    "id", "programId", "cycleWeeks", "weeklyRewardRate", "targetCycleRewardRate",
    "isActive", "createdAt", "updatedAt"
)
SELECT
    gen_random_uuid(),
    p."id",
    d."cycleWeeks",
    p."weeklyRewardRate",
    ROUND(p."weeklyRewardRate" * d."cycleWeeks", 4),
    true,
    NOW(),
    NOW()
FROM "Program" AS p
CROSS JOIN (VALUES (4), (8), (12)) AS d("cycleWeeks")
ON CONFLICT ("programId", "cycleWeeks") DO NOTHING;

-- 3. Keanggotaan menunjuk durasi yang dipilih --------------------------------
ALTER TABLE "UserProgram" ADD COLUMN "cycleId" UUID;

-- Backfill: keanggotaan lama menunjuk durasi programnya yang sesuai.
UPDATE "UserProgram" AS up
SET "cycleId" = pc."id"
FROM "ProgramCycle" AS pc
WHERE pc."programId" = up."programId"
  AND pc."cycleWeeks" = up."cycleWeeks";

ALTER TABLE "UserProgram"
  ADD CONSTRAINT "UserProgram_cycleId_fkey"
  FOREIGN KEY ("cycleId") REFERENCES "ProgramCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "UserProgram_cycleId_idx" ON "UserProgram"("cycleId");

-- Durasi keanggotaan maksimal 12 minggu (batas siklus program).
ALTER TABLE "UserProgram"
  ADD CONSTRAINT "UserProgram_cycleWeeks_check" CHECK ("cycleWeeks" BETWEEN 1 AND 12);

-- 4. Mata uang: USD -> USDT ---------------------------------------------------
UPDATE "Program" SET "currency" = 'USDT' WHERE "currency" = 'USD';
UPDATE "ProgramTier" SET "currency" = 'USDT' WHERE "currency" = 'USD';
UPDATE "UserProgram" SET "currency" = 'USDT' WHERE "currency" = 'USD';
UPDATE "Balance" SET "currency" = 'USDT' WHERE "currency" = 'USD';
-- Transaction rows are append-only by design. Existing historical ledger rows are
-- never edited; all new ledger entries are created in USDT by the runtime defaults.
UPDATE "Reward" SET "currency" = 'USDT' WHERE "currency" = 'USD';
UPDATE "ReferralCommission" SET "currency" = 'USDT' WHERE "currency" = 'USD';
UPDATE "DepositRequest" SET "currency" = 'USDT' WHERE "currency" = 'USD';
UPDATE "WithdrawalRequest" SET "currency" = 'USDT' WHERE "currency" = 'USD';

ALTER TABLE "Program" ALTER COLUMN "currency" SET DEFAULT 'USDT';
ALTER TABLE "ProgramTier" ALTER COLUMN "currency" SET DEFAULT 'USDT';
ALTER TABLE "UserProgram" ALTER COLUMN "currency" SET DEFAULT 'USDT';
ALTER TABLE "Balance" ALTER COLUMN "currency" SET DEFAULT 'USDT';
ALTER TABLE "Transaction" ALTER COLUMN "currency" SET DEFAULT 'USDT';
ALTER TABLE "Reward" ALTER COLUMN "currency" SET DEFAULT 'USDT';
ALTER TABLE "ReferralCommission" ALTER COLUMN "currency" SET DEFAULT 'USDT';
ALTER TABLE "DepositRequest" ALTER COLUMN "currency" SET DEFAULT 'USDT';
ALTER TABLE "WithdrawalRequest" ALTER COLUMN "currency" SET DEFAULT 'USDT';

-- Kode dan nama nominal memakai USDT (bukan USD).
UPDATE "ProgramTier"
SET "code" = REPLACE("code", 'USD-', 'USDT-'),
    "name" = REPLACE("name", 'Paket USD', 'Paket USDT')
WHERE "code" LIKE 'USD-%';

-- Bahasa Indonesia untuk akun baru.
UPDATE "Profile" SET "locale" = 'id-ID' WHERE "locale" = 'en-US';
ALTER TABLE "Profile" ALTER COLUMN "locale" SET DEFAULT 'id-ID';

-- Ketentuan program aktif memakai istilah "Target Reward" dan durasi 4/8/12 minggu.
UPDATE "Program"
SET "rewardTerms" = 'Target imbalan mengikuti ketentuan program (target 10% per minggu, durasi 4, 8, atau 12 minggu, target siklus 40%, 80%, atau 120%). Target imbalan bukan jaminan hasil: pencairan mengikuti kualifikasi, status keanggotaan, dan aturan program yang berlaku.'
WHERE "code" = 'TATORPROFIT-REWARD';
