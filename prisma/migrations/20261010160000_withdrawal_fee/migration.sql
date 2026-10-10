-- Backward-compatible withdrawal fee (10%) + submission idempotency.
-- Existing rows keep NULL fee/netAmount and therefore their original payout;
-- no balance and no historical ledger row is touched by this migration.

ALTER TABLE "WithdrawalRequest"
  ADD COLUMN "fee" DECIMAL(18, 2),
  ADD COLUMN "netAmount" DECIMAL(18, 2),
  ADD COLUMN "idempotencyKey" UUID;

CREATE INDEX "WithdrawalRequest_userId_idempotencyKey_idx"
  ON "WithdrawalRequest" ("userId", "idempotencyKey");
