ALTER TABLE "WithdrawalRequest"
ADD COLUMN "proofStorageKey" TEXT,
ADD COLUMN "proofFileName" TEXT,
ADD COLUMN "proofMimeType" TEXT,
ADD COLUMN "proofSize" INTEGER;
