-- Modul Perjanjian Bagi Hasil (lanjutan modul Profit Trading Aktual).
-- Rujukan: docs/profit-trading-module-audit-and-plan.md
--
-- Murni aditif: hanya ALTER TABLE ... ADD COLUMN (nullable atau berdefault),
-- CREATE TABLE, CREATE INDEX, dan ADD CONSTRAINT. Tidak ada kolom, tabel, indeks,
-- atau baris lama yang diubah maupun dihapus, dan tidak ada saldo yang disentuh.
--
-- Perjanjian bagi hasil tidak pernah ditimpa. Perubahan dibuat sebagai versi baru
-- (kolom "agreementVersion" + rantai "supersedesPolicyId"), dan setiap laporan
-- menyimpan salinan versi yang dipakainya ("agreementId" + "policySnapshot")
-- sehingga laporan lama tidak pernah berubah diam-diam.
--
-- Tabel "ProfitAgreementParty" hanya menyimpan BUKTI persetujuan pihak terkait; ia
-- sengaja tidak memuat satu pun persentase atau nominal. Angka pembagian tetap di
-- "ProfitSharePolicy" dan baru dipakai setelah disetujui pemilik (fail closed).
--
-- Catatan: migrasi ini tidak menambah nilai enum apa pun, sehingga tidak ada
-- batasan transaksi PostgreSQL seperti pada migrasi modul trading sebelumnya.

-- AlterTable
ALTER TABLE "TradingReport" ADD COLUMN     "agreementId" UUID,
ADD COLUMN     "companyRetainedAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "computationFormula" JSONB,
ADD COLUMN     "computationInputs" JSONB,
ADD COLUMN     "computationVersion" TEXT,
ADD COLUMN     "computedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ProfitSharePolicy" ADD COLUMN     "agreementDocumentKey" TEXT,
ADD COLUMN     "agreementNumber" TEXT,
ADD COLUMN     "agreementVersion" TEXT,
ADD COLUMN     "correctionTerms" TEXT,
ADD COLUMN     "costTreatment" TEXT,
ADD COLUMN     "disputeTerms" TEXT,
ADD COLUMN     "distributionMethod" TEXT,
ADD COLUMN     "effectiveTo" TIMESTAMP(3),
ADD COLUMN     "periodDefinition" TEXT,
ADD COLUMN     "pnlBasis" TEXT,
ADD COLUMN     "supersedesPolicyId" UUID;

-- CreateTable
CREATE TABLE "ProfitAgreementParty" (
    "id" UUID NOT NULL,
    "policyId" UUID NOT NULL,
    "partyName" TEXT NOT NULL,
    "partyRole" TEXT NOT NULL,
    "userId" UUID,
    "agreedAt" TIMESTAMP(3),
    "evidenceStorageKey" TEXT,
    "evidenceNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfitAgreementParty_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProfitAgreementParty_policyId_idx" ON "ProfitAgreementParty"("policyId");

-- CreateIndex
CREATE UNIQUE INDEX "ProfitAgreementParty_policyId_partyName_partyRole_key" ON "ProfitAgreementParty"("policyId", "partyName", "partyRole");

-- CreateIndex
CREATE INDEX "ProfitSharePolicy_agreementNumber_agreementVersion_idx" ON "ProfitSharePolicy"("agreementNumber", "agreementVersion");

-- AddForeignKey
ALTER TABLE "TradingReport" ADD CONSTRAINT "TradingReport_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "ProfitSharePolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfitSharePolicy" ADD CONSTRAINT "ProfitSharePolicy_supersedesPolicyId_fkey" FOREIGN KEY ("supersedesPolicyId") REFERENCES "ProfitSharePolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfitAgreementParty" ADD CONSTRAINT "ProfitAgreementParty_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "ProfitSharePolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfitAgreementParty" ADD CONSTRAINT "ProfitAgreementParty_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
