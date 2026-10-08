-- The rate snapshot columns were backfilled with defaults while adding them.
-- They are required per membership and must not carry a database default.
ALTER TABLE "UserProgram" ALTER COLUMN "weeklyRewardRate" DROP DEFAULT;
ALTER TABLE "UserProgram" ALTER COLUMN "maxCycleRewardRate" DROP DEFAULT;
