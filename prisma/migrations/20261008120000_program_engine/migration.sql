-- Program engine (Bagian 2): ledger types, reward lifecycle, membership snapshots.
-- Written explicitly so the append-only ledger guard can live next to the DDL.

-- 1. UserProgramStatus gains SUSPENDED -----------------------------------------
ALTER TYPE "UserProgramStatus" ADD VALUE IF NOT EXISTS 'SUSPENDED';

-- 2. Ledger types follow the specification: PROGRAM_JOIN, REWARD,
--    REFERRAL_REWARD, WITHDRAWAL, ADJUSTMENT. PostgreSQL cannot drop enum values,
--    so the type is rebuilt (safe: existing rows are mapped explicitly).
CREATE TYPE "TransactionType_new" AS ENUM (
  'PROGRAM_JOIN',
  'REWARD',
  'REFERRAL_REWARD',
  'WITHDRAWAL',
  'ADJUSTMENT'
);

ALTER TABLE "Transaction" ALTER COLUMN "type" TYPE "TransactionType_new" USING (
  CASE "type"::text
    WHEN 'REWARD_CREDIT' THEN 'REWARD'
    WHEN 'REFERRAL_COMMISSION' THEN 'REFERRAL_REWARD'
    WHEN 'REVERSAL' THEN 'ADJUSTMENT'
    WHEN 'ADJUSTMENT' THEN 'ADJUSTMENT'
    ELSE 'ADJUSTMENT'
  END::"TransactionType_new"
);

DROP TYPE "TransactionType";
ALTER TYPE "TransactionType_new" RENAME TO "TransactionType";

-- 3. RewardStatus becomes PENDING -> APPROVED -> PAID, plus REJECTED / VOID -----
CREATE TYPE "RewardStatus_new" AS ENUM ('PENDING', 'APPROVED', 'PAID', 'REJECTED', 'VOID');

ALTER TABLE "Reward" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Reward" ALTER COLUMN "status" TYPE "RewardStatus_new" USING (
  CASE "status"::text
    WHEN 'QUALIFIED' THEN 'APPROVED'
    WHEN 'CREDITED' THEN 'PAID'
    WHEN 'CANCELLED' THEN 'VOID'
    ELSE 'PENDING'
  END::"RewardStatus_new"
);
ALTER TABLE "Reward" ALTER COLUMN "status" SET DEFAULT 'PENDING';

DROP TYPE "RewardStatus";
ALTER TYPE "RewardStatus_new" RENAME TO "RewardStatus";

-- 4. Balance: program funds recorded separately from the reward balance ---------
ALTER TABLE "Balance" ADD COLUMN "programFundsAmount" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- 5. UserProgram: rate snapshot + funds confirmation + lifecycle timestamps -----
ALTER TABLE "UserProgram" ADD COLUMN "weeklyRewardRate" DECIMAL(7,4) NOT NULL DEFAULT 0.1;
ALTER TABLE "UserProgram" ADD COLUMN "cycleWeeks" INTEGER NOT NULL DEFAULT 4;
ALTER TABLE "UserProgram" ADD COLUMN "maxCycleRewardRate" DECIMAL(7,4) NOT NULL DEFAULT 0.4;
ALTER TABLE "UserProgram" ADD COLUMN "fundsConfirmedAt" TIMESTAMP(3);
ALTER TABLE "UserProgram" ADD COLUMN "fundsConfirmedAmount" DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE "UserProgram" ADD COLUMN "suspendedAt" TIMESTAMP(3);
ALTER TABLE "UserProgram" ADD COLUMN "cancelledAt" TIMESTAMP(3);

-- 6. Transaction: which balance bucket an entry moves ---------------------------
ALTER TABLE "Transaction" ADD COLUMN "bucket" TEXT NOT NULL DEFAULT 'NONE';
CREATE INDEX "Transaction_type_createdAt_idx" ON "Transaction"("type", "createdAt");

-- 7. Reward: program link, rate/period naming, approval + payment trail ---------
ALTER TABLE "Reward" ADD COLUMN "programId" UUID;
UPDATE "Reward" SET "programId" = "UserProgram"."programId"
  FROM "UserProgram" WHERE "UserProgram"."id" = "Reward"."userProgramId";
ALTER TABLE "Reward" ALTER COLUMN "programId" SET NOT NULL;
ALTER TABLE "Reward" RENAME COLUMN "qualifiedAt" TO "approvedAt";
ALTER TABLE "Reward" RENAME COLUMN "creditedAt" TO "paidAt";
ALTER TABLE "Reward" ADD COLUMN "transactionId" UUID;

ALTER TABLE "Reward" RENAME COLUMN "weeklyRewardRate" TO "rate";
ALTER TABLE "Reward" RENAME COLUMN "cycleWeek" TO "period";

DROP INDEX "Reward_userProgramId_type_cycleNumber_cycleWeek_key";
CREATE UNIQUE INDEX "Reward_userProgramId_type_cycleNumber_period_key"
  ON "Reward"("userProgramId", "type", "cycleNumber", "period");
CREATE UNIQUE INDEX "Reward_transactionId_key" ON "Reward"("transactionId");
CREATE INDEX "Reward_userId_programId_period_idx" ON "Reward"("userId", "programId", "period");

ALTER TABLE "Reward" ADD CONSTRAINT "Reward_programId_fkey"
  FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Reward" ADD CONSTRAINT "Reward_transactionId_fkey"
  FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 8. Append-only ledger guard --------------------------------------------------
-- Financial rows can never be deleted and posted money fields can never be
-- edited. Corrections must be appended as a new ADJUSTMENT entry, which keeps a
-- full audit trail. A maintenance escape hatch is available for test/database
-- teardown by setting: SET LOCAL tatorprofit.allow_ledger_purge = 'on';
CREATE OR REPLACE FUNCTION tatorprofit_ledger_guard() RETURNS trigger AS $$
BEGIN
  IF current_setting('tatorprofit.allow_ledger_purge', true) = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'Ledger rows are immutable: deleting a Transaction is not allowed. Append an ADJUSTMENT instead.'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW."userId" IS DISTINCT FROM OLD."userId"
     OR NEW."type" IS DISTINCT FROM OLD."type"
     OR NEW."amount" IS DISTINCT FROM OLD."amount"
     OR NEW."currency" IS DISTINCT FROM OLD."currency"
     OR NEW."reference" IS DISTINCT FROM OLD."reference"
     OR NEW."bucket" IS DISTINCT FROM OLD."bucket"
     OR NEW."balanceBefore" IS DISTINCT FROM OLD."balanceBefore"
     OR NEW."balanceAfter" IS DISTINCT FROM OLD."balanceAfter"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION
      'Posted ledger fields are immutable. Append an ADJUSTMENT instead of editing a Transaction.'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Transaction_append_only"
BEFORE UPDATE OR DELETE ON "Transaction"
FOR EACH ROW EXECUTE FUNCTION tatorprofit_ledger_guard();
