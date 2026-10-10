-- Bagian 13 — anti-fraud multi-akun dan penyalahgunaan rujukan.
--
-- Purely additive: the registration address column, the review queue table and
-- one new security event type. No existing row is rewritten, no balance or
-- commission is touched, and nothing is dropped. A flagged account keeps using
-- the platform until an administrator closes the case on /fraud-review.
--
-- PostgreSQL appends new enum values at the end of the type, which is why the
-- Prisma enum declares FRAUD_FLAGGED last. The value is deliberately not used in
-- this migration: a freshly added enum value may only be used after the
-- transaction that added it has committed.

-- CreateEnum
CREATE TYPE "FraudReviewStatus" AS ENUM ('OPEN', 'CLEARED', 'CONFIRMED');

-- AlterEnum
ALTER TYPE "SecurityEventType" ADD VALUE IF NOT EXISTS 'FRAUD_FLAGGED';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "registrationIp" TEXT;

-- CreateTable
CREATE TABLE "FraudReview" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "signals" TEXT[],
    "relatedUserIds" UUID[],
    "status" "FraudReviewStatus" NOT NULL DEFAULT 'OPEN',
    "reviewerId" UUID,
    "reviewNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FraudReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FraudReview_userId_key" ON "FraudReview"("userId");

-- CreateIndex
CREATE INDEX "FraudReview_status_createdAt_idx" ON "FraudReview"("status", "createdAt");

-- CreateIndex
CREATE INDEX "User_bankAccountNumber_idx" ON "User"("bankAccountNumber");

-- CreateIndex
CREATE INDEX "User_registrationIp_createdAt_idx" ON "User"("registrationIp", "createdAt");

-- AddForeignKey
ALTER TABLE "FraudReview" ADD CONSTRAINT "FraudReview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FraudReview" ADD CONSTRAINT "FraudReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
