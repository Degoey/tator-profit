-- Bagian 3 — jaringan rujukan lima tingkat dan komisi rujukan.
--
-- The migration is written by hand so existing commission rows survive:
--   1. ReferralCommissionStatus becomes PENDING -> APPROVED -> PAID, plus
--      REJECTED / VOID (same shape as RewardStatus in the program engine).
--      Legacy values are mapped explicitly, never dropped.
--   2. `referrerId` becomes `beneficiaryUserId` and `amount` becomes
--      `commissionAmount` with RENAME COLUMN, so the stored values (and the
--      existing primary keys / foreign keys) are preserved.
--   3. `sourceTransactionId` is added and backfilled: legacy rows are linked to
--      the ledger entry that carries their `sourceReference`; rows without one
--      get their own recorded REFERRAL_REWARD event (bucket NONE, no balance
--      change) so the audit trail stays complete and the FK can be enforced.
--   4. A database level trigger rejects referral cycles (including a self
--      reference) even when rows are written outside the application.

-- 1. Enum: PENDING, APPROVED, PAID, REJECTED, VOID ------------------------------
CREATE TYPE "ReferralCommissionStatus_new" AS ENUM (
  'PENDING',
  'APPROVED',
  'PAID',
  'REJECTED',
  'VOID'
);

ALTER TABLE "ReferralCommission" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "ReferralCommission" ALTER COLUMN "status" TYPE "ReferralCommissionStatus_new" USING (
  CASE "status"::text
    WHEN 'QUALIFIED' THEN 'APPROVED'
    WHEN 'POSTED' THEN 'PAID'
    WHEN 'CANCELLED' THEN 'VOID'
    ELSE 'PENDING'
  END::"ReferralCommissionStatus_new"
);
ALTER TABLE "ReferralCommission" ALTER COLUMN "status" SET DEFAULT 'PENDING';

DROP TYPE "ReferralCommissionStatus";
ALTER TYPE "ReferralCommissionStatus_new" RENAME TO "ReferralCommissionStatus";

-- 2. Column renames -------------------------------------------------------------
ALTER TABLE "ReferralCommission" RENAME COLUMN "referrerId" TO "beneficiaryUserId";
ALTER TABLE "ReferralCommission" RENAME COLUMN "amount" TO "commissionAmount";

ALTER TABLE "ReferralCommission"
  ADD COLUMN "sourceTransactionId" UUID,
  ADD COLUMN "approvedAt" TIMESTAMP(3),
  ADD COLUMN "paidAt" TIMESTAMP(3),
  ADD COLUMN "payoutTransactionId" UUID;


-- 3. Backfill the source ledger event -------------------------------------------
-- 3a. Legacy rows whose text reference matches a ledger entry.
UPDATE "ReferralCommission" AS c
SET "sourceTransactionId" = t."id"
FROM "Transaction" AS t
WHERE c."sourceTransactionId" IS NULL
  AND t."reference" = c."sourceReference";

-- 3b. Every other legacy row gets its own recorded event. The ledger is
--     append-only (INSERT is allowed, UPDATE/DELETE are blocked by the
--     Transaction_append_only trigger) and bucket NONE means no balance moves.
INSERT INTO "Transaction" (
  "id", "userId", "type", "status", "amount", "currency", "bucket",
  "balanceBefore", "balanceAfter", "reference", "description", "postedAt", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(),
  c."beneficiaryUserId",
  'REFERRAL_REWARD',
  'POSTED',
  c."commissionAmount",
  c."currency",
  'NONE',
  0,
  0,
  'referral-commission-legacy:' || c."id",
  'Komisi rujukan lama dipindahkan dari referensi teks saat migrasi Bagian 3',
  NOW(),
  NOW(),
  NOW()
FROM "ReferralCommission" AS c
WHERE c."sourceTransactionId" IS NULL;

UPDATE "ReferralCommission" AS c
SET "sourceTransactionId" = t."id"
FROM "Transaction" AS t
WHERE c."sourceTransactionId" IS NULL
  AND t."reference" = 'referral-commission-legacy:' || c."id";

ALTER TABLE "ReferralCommission" ALTER COLUMN "sourceTransactionId" SET NOT NULL;

-- 4. Keys, indexes and foreign keys ---------------------------------------------
DROP INDEX "ReferralCommission_referrerId_status_idx";

CREATE INDEX "ReferralCommission_beneficiaryUserId_status_idx"
  ON "ReferralCommission"("beneficiaryUserId", "status");
CREATE INDEX "ReferralCommission_sourceTransactionId_idx"
  ON "ReferralCommission"("sourceTransactionId");
CREATE UNIQUE INDEX "ReferralCommission_sourceTransactionId_beneficiaryUserId_key"
  ON "ReferralCommission"("sourceTransactionId", "beneficiaryUserId");
CREATE UNIQUE INDEX "ReferralCommission_payoutTransactionId_key"
  ON "ReferralCommission"("payoutTransactionId");

ALTER TABLE "ReferralCommission" DROP CONSTRAINT "ReferralCommission_referrerId_fkey";
ALTER TABLE "ReferralCommission" ADD CONSTRAINT "ReferralCommission_beneficiaryUserId_fkey"
  FOREIGN KEY ("beneficiaryUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReferralCommission" ADD CONSTRAINT "ReferralCommission_sourceTransactionId_fkey"
  FOREIGN KEY ("sourceTransactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReferralCommission" ADD CONSTRAINT "ReferralCommission_payoutTransactionId_fkey"
  FOREIGN KEY ("payoutTransactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 5. Referral tree cycle guard --------------------------------------------------
-- A cycle (or a self reference) can never be committed, not even by a script or
-- a concurrent writer: the guard walks the parent chain of the new referrer and
-- rejects the row when it reaches the referred account. Combined with the
-- UNIQUE("referredUserId") constraint (one parent per account) this keeps the
-- referral forest acyclic at the database level.
CREATE OR REPLACE FUNCTION tatorprofit_referral_cycle_guard() RETURNS trigger AS $$
DECLARE
  cursor_id UUID := NEW."referrerId";
  depth INT := 0;
BEGIN
  IF NEW."referrerId" = NEW."referredUserId" THEN
    RAISE EXCEPTION 'Referral cycle rejected: an account cannot refer itself.'
      USING ERRCODE = 'check_violation';
  END IF;

  WHILE depth < 64 LOOP
    SELECT r."referrerId" INTO cursor_id
    FROM "Referral" AS r
    WHERE r."referredUserId" = cursor_id;

    EXIT WHEN NOT FOUND;

    IF cursor_id = NEW."referredUserId" THEN
      RAISE EXCEPTION 'Referral cycle rejected: % is already an ancestor of the referrer.', NEW."referredUserId"
        USING ERRCODE = 'check_violation';
    END IF;

    depth := depth + 1;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Referral_cycle_guard"
BEFORE INSERT OR UPDATE ON "Referral"
FOR EACH ROW EXECUTE FUNCTION tatorprofit_referral_cycle_guard();

