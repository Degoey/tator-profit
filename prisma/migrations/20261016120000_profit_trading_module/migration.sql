-- Modul Profit Mingguan Berbasis Hasil Trading Aktual.
-- Rujukan: docs/profit-trading-module-audit-and-plan.md
--
-- Murni aditif: hanya CREATE TYPE / CREATE TABLE / CREATE INDEX dan satu nilai enum
-- baru. Tidak ada tabel, kolom, indeks, atau baris lama yang diubah maupun dihapus,
-- dan tidak ada saldo, imbalan, atau komisi yang disentuh.
--
-- Catatan PostgreSQL: nilai enum baru ("TransactionType"."PROFIT_SHARE") ditambahkan
-- di sini tetapi TIDAK dipakai di migrasi ini, karena nilai enum yang baru ditambah
-- hanya boleh dipakai setelah transaksi yang menambahkannya commit. Karena alasan
-- yang sama, Prisma enum menempatkan PROFIT_SHARE di akhir daftar.
--
-- Angka pembagian hasil sengaja tidak ada di sini. Kebijakan bagi hasil disimpan pada
-- tabel "ProfitSharePolicy" dengan status PENDING_APPROVAL sampai disetujui pemilik;
-- selama belum disetujui, mesin alokasi menolak berjalan (fail closed).

-- CreateEnum
CREATE TYPE "TradingSourceType" AS ENUM ('ACTUAL', 'DEMO');

-- CreateEnum
CREATE TYPE "TradingRecordStatus" AS ENUM ('UNVERIFIED', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "TradingReportStatus" AS ENUM ('DRAFT', 'RECONCILIATION', 'PENDING_APPROVAL', 'APPROVED', 'PUBLISHED', 'PAYMENT_PROCESSING', 'PAID', 'REJECTED', 'CORRECTED');

-- CreateEnum
CREATE TYPE "TradingReconciliationStatus" AS ENUM ('PENDING', 'MATCHED', 'UNRESOLVED');

-- CreateEnum
CREATE TYPE "ProfitAllocationStatus" AS ENUM ('PENDING', 'APPROVED', 'PAID', 'REJECTED', 'VOID');

-- CreateEnum
CREATE TYPE "ProfitPaymentStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProfitSharePolicyStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REVOKED');

-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'PROFIT_SHARE';

-- CreateTable
CREATE TABLE "TradingRecord" (
    "id" UUID NOT NULL,
    "externalReference" TEXT NOT NULL,
    "traderName" TEXT NOT NULL,
    "traderUserId" UUID,
    "exchange" TEXT NOT NULL,
    "assetPair" TEXT NOT NULL,
    "tradeType" TEXT NOT NULL,
    "executedAt" TIMESTAMP(3) NOT NULL,
    "allocatedCapital" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "realizedPnl" DECIMAL(18,2) NOT NULL,
    "unrealizedPnl" DECIMAL(18,2),
    "tradingFees" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "otherCosts" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "costsIncludedInPnl" BOOLEAN NOT NULL DEFAULT false,
    "currency" TEXT NOT NULL DEFAULT 'USDT',
    "sourceType" "TradingSourceType" NOT NULL DEFAULT 'ACTUAL',
    "status" "TradingRecordStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "evidenceStorageKey" TEXT,
    "notes" TEXT,
    "importedBatchId" UUID,
    "reportId" UUID,
    "createdByUserId" UUID,
    "verifiedByUserId" UUID,
    "verifiedAt" TIMESTAMP(3),
    "verificationNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradingRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradingReport" (
    "id" UUID NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "sourceType" "TradingSourceType" NOT NULL DEFAULT 'ACTUAL',
    "version" INTEGER NOT NULL DEFAULT 1,
    "correctsReportId" UUID,
    "status" "TradingReportStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL DEFAULT 'USDT',
    "realizedPnl" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "unrealizedPnl" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tradingFees" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "otherCosts" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "netPnl" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "reserveAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "managementFeeAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "distributableAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "memberPoolAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "allocatedAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "paidAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "policySnapshot" JSONB,
    "summaryNote" TEXT,
    "createdByUserId" UUID,
    "approvedByUserId" UUID,
    "approvedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradingReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradingReconciliation" (
    "id" UUID NOT NULL,
    "reportId" UUID NOT NULL,
    "sourceLabel" TEXT NOT NULL,
    "internalNetPnl" DECIMAL(18,2) NOT NULL,
    "sourceNetPnl" DECIMAL(18,2) NOT NULL,
    "difference" DECIMAL(18,2) NOT NULL,
    "tolerance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" "TradingReconciliationStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "evidenceStorageKey" TEXT,
    "checkedByUserId" UUID,
    "checkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradingReconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfitAllocation" (
    "id" UUID NOT NULL,
    "reportId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "basisAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "shareRate" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USDT',
    "status" "ProfitAllocationStatus" NOT NULL DEFAULT 'PENDING',
    "ledgerReference" TEXT,
    "approvedByUserId" UUID,
    "approvedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfitAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberProfitLedger" (
    "id" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "allocationId" UUID,
    "reportId" UUID,
    "entryType" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USDT',
    "status" "TransactionStatus" NOT NULL DEFAULT 'POSTED',
    "reference" TEXT NOT NULL,
    "correctionOfId" UUID,
    "description" TEXT,
    "metadata" JSONB,
    "postedAt" TIMESTAMP(3),
    "createdByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberProfitLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfitPayment" (
    "id" UUID NOT NULL,
    "allocationId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "reportId" UUID NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USDT',
    "method" TEXT NOT NULL,
    "destination" TEXT,
    "status" "ProfitPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "providerReference" TEXT,
    "idempotencyKey" TEXT,
    "proofStorageKey" TEXT,
    "proofFileName" TEXT,
    "proofMimeType" TEXT,
    "proofSize" INTEGER,
    "failureReason" TEXT,
    "processedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "verifiedByUserId" UUID,
    "createdByUserId" UUID,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfitPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradingApprovalHistory" (
    "id" UUID NOT NULL,
    "reportId" UUID NOT NULL,
    "fromStatus" "TradingReportStatus",
    "toStatus" "TradingReportStatus" NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "actorUserId" UUID,
    "before" JSONB,
    "after" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradingApprovalHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfitSharePolicy" (
    "id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "status" "ProfitSharePolicyStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "memberShareRate" DECIMAL(7,4),
    "reserveRate" DECIMAL(7,4),
    "managementFeeRate" DECIMAL(7,4),
    "lossHandling" TEXT,
    "distributionPeriod" TEXT NOT NULL DEFAULT 'WEEKLY',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "effectiveFrom" TIMESTAMP(3),
    "approvedByUserId" UUID,
    "approvedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfitSharePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TradingRecord_sourceType_executedAt_idx" ON "TradingRecord"("sourceType", "executedAt");

-- CreateIndex
CREATE INDEX "TradingRecord_status_executedAt_idx" ON "TradingRecord"("status", "executedAt");

-- CreateIndex
CREATE INDEX "TradingRecord_executedAt_idx" ON "TradingRecord"("executedAt");

-- CreateIndex
CREATE INDEX "TradingRecord_reportId_idx" ON "TradingRecord"("reportId");

-- CreateIndex
CREATE UNIQUE INDEX "TradingRecord_exchange_externalReference_sourceType_key" ON "TradingRecord"("exchange", "externalReference", "sourceType");

-- CreateIndex
CREATE INDEX "TradingReport_status_periodEnd_idx" ON "TradingReport"("status", "periodEnd");

-- CreateIndex
CREATE INDEX "TradingReport_periodStart_periodEnd_idx" ON "TradingReport"("periodStart", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "TradingReport_periodStart_periodEnd_sourceType_version_key" ON "TradingReport"("periodStart", "periodEnd", "sourceType", "version");

-- CreateIndex
CREATE INDEX "TradingReconciliation_reportId_status_idx" ON "TradingReconciliation"("reportId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProfitAllocation_ledgerReference_key" ON "ProfitAllocation"("ledgerReference");

-- CreateIndex
CREATE INDEX "ProfitAllocation_memberId_status_idx" ON "ProfitAllocation"("memberId", "status");

-- CreateIndex
CREATE INDEX "ProfitAllocation_status_createdAt_idx" ON "ProfitAllocation"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProfitAllocation_reportId_memberId_key" ON "ProfitAllocation"("reportId", "memberId");

-- CreateIndex
CREATE UNIQUE INDEX "MemberProfitLedger_reference_key" ON "MemberProfitLedger"("reference");

-- CreateIndex
CREATE INDEX "MemberProfitLedger_memberId_createdAt_idx" ON "MemberProfitLedger"("memberId", "createdAt");

-- CreateIndex
CREATE INDEX "MemberProfitLedger_reportId_idx" ON "MemberProfitLedger"("reportId");

-- CreateIndex
CREATE UNIQUE INDEX "ProfitPayment_idempotencyKey_key" ON "ProfitPayment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ProfitPayment_memberId_status_idx" ON "ProfitPayment"("memberId", "status");

-- CreateIndex
CREATE INDEX "ProfitPayment_reportId_status_idx" ON "ProfitPayment"("reportId", "status");

-- CreateIndex
CREATE INDEX "ProfitPayment_status_createdAt_idx" ON "ProfitPayment"("status", "createdAt");

-- CreateIndex
CREATE INDEX "TradingApprovalHistory_reportId_createdAt_idx" ON "TradingApprovalHistory"("reportId", "createdAt");

-- CreateIndex
CREATE INDEX "TradingApprovalHistory_actorUserId_createdAt_idx" ON "TradingApprovalHistory"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "ProfitSharePolicy_status_effectiveFrom_idx" ON "ProfitSharePolicy"("status", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "TradingRecord" ADD CONSTRAINT "TradingRecord_traderUserId_fkey" FOREIGN KEY ("traderUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradingRecord" ADD CONSTRAINT "TradingRecord_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradingRecord" ADD CONSTRAINT "TradingRecord_verifiedByUserId_fkey" FOREIGN KEY ("verifiedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradingRecord" ADD CONSTRAINT "TradingRecord_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "TradingReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradingReport" ADD CONSTRAINT "TradingReport_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradingReport" ADD CONSTRAINT "TradingReport_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradingReport" ADD CONSTRAINT "TradingReport_correctsReportId_fkey" FOREIGN KEY ("correctsReportId") REFERENCES "TradingReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradingReconciliation" ADD CONSTRAINT "TradingReconciliation_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "TradingReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradingReconciliation" ADD CONSTRAINT "TradingReconciliation_checkedByUserId_fkey" FOREIGN KEY ("checkedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfitAllocation" ADD CONSTRAINT "ProfitAllocation_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "TradingReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfitAllocation" ADD CONSTRAINT "ProfitAllocation_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfitAllocation" ADD CONSTRAINT "ProfitAllocation_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberProfitLedger" ADD CONSTRAINT "MemberProfitLedger_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberProfitLedger" ADD CONSTRAINT "MemberProfitLedger_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberProfitLedger" ADD CONSTRAINT "MemberProfitLedger_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "ProfitAllocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberProfitLedger" ADD CONSTRAINT "MemberProfitLedger_correctionOfId_fkey" FOREIGN KEY ("correctionOfId") REFERENCES "MemberProfitLedger"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfitPayment" ADD CONSTRAINT "ProfitPayment_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "ProfitAllocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfitPayment" ADD CONSTRAINT "ProfitPayment_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfitPayment" ADD CONSTRAINT "ProfitPayment_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "TradingReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfitPayment" ADD CONSTRAINT "ProfitPayment_verifiedByUserId_fkey" FOREIGN KEY ("verifiedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfitPayment" ADD CONSTRAINT "ProfitPayment_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradingApprovalHistory" ADD CONSTRAINT "TradingApprovalHistory_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "TradingReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradingApprovalHistory" ADD CONSTRAINT "TradingApprovalHistory_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfitSharePolicy" ADD CONSTRAINT "ProfitSharePolicy_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfitSharePolicy" ADD CONSTRAINT "ProfitSharePolicy_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


