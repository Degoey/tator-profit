-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('SUPER_ADMIN', 'FINANCE', 'SUPPORT', 'COMPLIANCE', 'VIEWER');

-- CreateEnum
CREATE TYPE "DepositStatus" AS ENUM ('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'FLAGGED');

-- CreateEnum
CREATE TYPE "WithdrawalStatus" AS ENUM ('PENDING', 'UNDER_REVIEW', 'APPROVED', 'PROCESSING', 'COMPLETED', 'REJECTED');

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "userAgent" TEXT;

-- AlterTable
ALTER TABLE "Balance" ADD COLUMN     "reservedAmount" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "adminRole" "AdminRole";

-- CreateTable
CREATE TABLE "DepositRequest" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "userProgramId" UUID NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "paymentMethod" TEXT NOT NULL,
    "paymentReference" TEXT NOT NULL,
    "proofStorageKey" TEXT NOT NULL,
    "proofFileName" TEXT NOT NULL,
    "proofMimeType" TEXT NOT NULL,
    "proofSize" INTEGER NOT NULL,
    "proofUploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "DepositStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedByUserId" UUID,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "reviewNote" TEXT,
    "flaggedReason" TEXT,
    "ledgerReference" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DepositRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WithdrawalRequest" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "method" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "notes" TEXT,
    "status" "WithdrawalStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedByUserId" UUID,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "reviewNote" TEXT,
    "processedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "reservedReference" TEXT,
    "completionReference" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WithdrawalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DepositRequest_ledgerReference_key" ON "DepositRequest"("ledgerReference");

-- CreateIndex
CREATE INDEX "DepositRequest_userId_status_idx" ON "DepositRequest"("userId", "status");

-- CreateIndex
CREATE INDEX "DepositRequest_status_createdAt_idx" ON "DepositRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "DepositRequest_userProgramId_idx" ON "DepositRequest"("userProgramId");

-- CreateIndex
CREATE UNIQUE INDEX "WithdrawalRequest_reservedReference_key" ON "WithdrawalRequest"("reservedReference");

-- CreateIndex
CREATE UNIQUE INDEX "WithdrawalRequest_completionReference_key" ON "WithdrawalRequest"("completionReference");

-- CreateIndex
CREATE INDEX "WithdrawalRequest_userId_status_idx" ON "WithdrawalRequest"("userId", "status");

-- CreateIndex
CREATE INDEX "WithdrawalRequest_status_createdAt_idx" ON "WithdrawalRequest"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "DepositRequest" ADD CONSTRAINT "DepositRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepositRequest" ADD CONSTRAINT "DepositRequest_userProgramId_fkey" FOREIGN KEY ("userProgramId") REFERENCES "UserProgram"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepositRequest" ADD CONSTRAINT "DepositRequest_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WithdrawalRequest" ADD CONSTRAINT "WithdrawalRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WithdrawalRequest" ADD CONSTRAINT "WithdrawalRequest_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: existing administrators keep their full capability. Without this the
-- new nullable "adminRole" column would silently lock every current admin out of
-- the financial review screens.
UPDATE "User" SET "adminRole" = 'SUPER_ADMIN' WHERE "role" = 'ADMIN' AND "adminRole" IS NULL;

-- Defence in depth: no balance bucket may ever become negative, even if a future
-- code path forgets the application level guard.
ALTER TABLE "Balance" ADD CONSTRAINT "Balance_amounts_non_negative" CHECK (
  "availableAmount" >= 0
  AND "pendingAmount" >= 0
  AND "programFundsAmount" >= 0
  AND "reservedAmount" >= 0
  AND "totalEarned" >= 0
  AND "totalReversed" >= 0
);

-- A request without money makes no sense and must never reach the review queue.
ALTER TABLE "DepositRequest" ADD CONSTRAINT "DepositRequest_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "WithdrawalRequest" ADD CONSTRAINT "WithdrawalRequest_amount_positive" CHECK ("amount" > 0);

-- One open deposit per membership: the database itself refuses a second request
-- that could be approved into a second credit for the same join.
CREATE UNIQUE INDEX "DepositRequest_one_open_per_membership"
  ON "DepositRequest"("userProgramId")
  WHERE "status" IN ('PENDING', 'UNDER_REVIEW', 'APPROVED');

-- Only one open withdrawal may reserve a given account's money at a time, which
-- keeps the AVAILABLE -> RESERVED movement auditable per request.
CREATE UNIQUE INDEX "WithdrawalRequest_one_open_per_user"
  ON "WithdrawalRequest"("userId")
  WHERE "status" IN ('PENDING', 'UNDER_REVIEW', 'APPROVED', 'PROCESSING');
