-- Sumber modal trading (Tahap 2) + gerbang Validasi Aturan & pencatatan kerugian (Tahap 4-6).
-- Rujukan: docs/profit-trading-module-audit-and-plan.md
--
-- Murni aditif: hanya CREATE TYPE, ALTER TYPE ... ADD VALUE, ALTER TABLE ... ADD COLUMN
-- (nullable atau berdefault), CREATE TABLE, CREATE INDEX, dan ADD CONSTRAINT. Tidak ada
-- kolom, tabel, indeks, atau baris lama yang diubah maupun dihapus, dan tidak ada saldo
-- anggota yang disentuh.
--
-- Catatan penting mengenai nilai enum baru: PostgreSQL 12+ mengizinkan penambahan nilai
-- enum di dalam transaksi selama nilai tersebut tidak dipakai pada transaksi yang sama.
-- Migrasi ini hanya menambahkan nilainya dan tidak memakainya, sehingga aman dijalankan
-- oleh `prisma migrate deploy` pada PostgreSQL 16 (lihat docs/deployment-staging-vps.md).
-- Urutan fisik nilai di dalam tipe enum tidak dipakai untuk logika apa pun; urutan
-- tampilan ditentukan oleh konstanta di src/lib/config/trading.ts.
--
-- Prinsip yang dijaga oleh migrasi ini:
--  1. `TradingCapitalContribution` mencatat sumber modal (perusahaan/anggota) beserta
--     nomor buktinya (`reference` unik sehingga pencatatan ganda tertolak di level DB).
--     Modal TIDAK menentukan hak profit; dasar pembagian tetap dari perjanjian.
--  2. `TradingCapitalMovement` adalah riwayat perubahan alokasi modal (append-only).
--     Koreksi dilakukan dengan baris REVERSAL yang menunjuk baris asal, bukan penimpaan.
--  3. `TradingReport.lossAmount` mencatat kerugian aktual secara terpisah, beserta
--     ketentuan perjanjian yang dipakai (`lossHandlingApplied`). Tidak ada kolom apa pun
--     untuk membebankan kerugian ke anggota (tanpa pemotongan modal anggota/utang anggota).
--  4. `TradingReportStatus.RULES_VALIDATION` menjadi gerbang wajib sebelum pengajuan:
--     laporan tidak dapat melangkah ke persetujuan sebelum aturan tertulis terpenuhi.

-- CreateEnum
CREATE TYPE "CapitalOwnerType" AS ENUM ('COMPANY', 'MEMBER');

-- CreateEnum
CREATE TYPE "CapitalContributionStatus" AS ENUM ('RECORDED', 'VERIFIED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "CapitalMovementType" AS ENUM ('ALLOCATION', 'WITHDRAWAL', 'ADJUSTMENT', 'REVERSAL');

-- AlterEnum
ALTER TYPE "TradingReportStatus" ADD VALUE 'RULES_VALIDATION';

-- AlterTable
ALTER TABLE "TradingReport" ADD COLUMN     "carriedForwardLossAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "lossAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "lossHandlingApplied" TEXT,
ADD COLUMN     "lossHandlingNote" TEXT;

-- CreateTable
CREATE TABLE "TradingCapitalContribution" (
    "id" UUID NOT NULL,
    "ownerType" "CapitalOwnerType" NOT NULL,
    "memberUserId" UUID,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USDT',
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "status" "CapitalContributionStatus" NOT NULL DEFAULT 'RECORDED',
    "reference" TEXT NOT NULL,
    "evidenceStorageKey" TEXT,
    "notes" TEXT,
    "createdByUserId" UUID,
    "verifiedByUserId" UUID,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradingCapitalContribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradingCapitalMovement" (
    "id" UUID NOT NULL,
    "contributionId" UUID NOT NULL,
    "movementType" "CapitalMovementType" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USDT',
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "evidenceStorageKey" TEXT,
    "revertsMovementId" UUID,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradingCapitalMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TradingCapitalContribution_reference_key" ON "TradingCapitalContribution"("reference");

-- CreateIndex
CREATE INDEX "TradingCapitalContribution_ownerType_effectiveFrom_idx" ON "TradingCapitalContribution"("ownerType", "effectiveFrom");

-- CreateIndex
CREATE INDEX "TradingCapitalContribution_memberUserId_idx" ON "TradingCapitalContribution"("memberUserId");

-- CreateIndex
CREATE INDEX "TradingCapitalContribution_status_effectiveFrom_idx" ON "TradingCapitalContribution"("status", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "TradingCapitalMovement_reference_key" ON "TradingCapitalMovement"("reference");

-- CreateIndex
CREATE INDEX "TradingCapitalMovement_contributionId_effectiveAt_idx" ON "TradingCapitalMovement"("contributionId", "effectiveAt");

-- CreateIndex
CREATE INDEX "TradingCapitalMovement_movementType_effectiveAt_idx" ON "TradingCapitalMovement"("movementType", "effectiveAt");

-- AddForeignKey
ALTER TABLE "TradingCapitalContribution" ADD CONSTRAINT "TradingCapitalContribution_memberUserId_fkey" FOREIGN KEY ("memberUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradingCapitalContribution" ADD CONSTRAINT "TradingCapitalContribution_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradingCapitalContribution" ADD CONSTRAINT "TradingCapitalContribution_verifiedByUserId_fkey" FOREIGN KEY ("verifiedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradingCapitalMovement" ADD CONSTRAINT "TradingCapitalMovement_contributionId_fkey" FOREIGN KEY ("contributionId") REFERENCES "TradingCapitalContribution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradingCapitalMovement" ADD CONSTRAINT "TradingCapitalMovement_revertsMovementId_fkey" FOREIGN KEY ("revertsMovementId") REFERENCES "TradingCapitalMovement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradingCapitalMovement" ADD CONSTRAINT "TradingCapitalMovement_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

