-- CreateEnum
CREATE TYPE "HarvestStatus" AS ENUM ('SUBMITTED', 'CONFIRMED', 'FAILED');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'CONFIRMED', 'EXPIRED', 'FAILED');

-- AlterEnum
ALTER TYPE "WinStatus" ADD VALUE 'WON_FREE_TICKET';

-- AlterTable
ALTER TABLE "MegapotEpoch" DROP COLUMN "lpEarningsAmount",
DROP COLUMN "ticketCount",
DROP COLUMN "uniqueParticipants",
DROP COLUMN "winnersCount",
ADD COLUMN     "bonusMax" SMALLINT,
ADD COLUMN     "drawnAt" TIMESTAMP(3),
ADD COLUMN     "endedAt" TIMESTAMP(3),
ADD COLUMN     "jackpot" BIGINT NOT NULL,
ADD COLUMN     "lordsPotPaidAmount" BIGINT,
ADD COLUMN     "lordsPotTicketCount" INTEGER NOT NULL,
ADD COLUMN     "lordsPotWinnersCount" INTEGER NOT NULL,
ADD COLUMN     "normalMax" SMALLINT,
ADD COLUMN     "ticketsHarvestedAt" TIMESTAMP(3),
ADD COLUMN     "ticketsSettledAt" TIMESTAMP(3),
ADD COLUMN     "totalPaidAmount" BIGINT,
ADD COLUMN     "totalTicketCount" INTEGER NOT NULL,
ADD COLUMN     "totalWinnersCount" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "ProtocolState" ADD COLUMN     "jackpotsWon" SMALLINT,
ADD COLUMN     "prizesWon" BIGINT;

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "baseTxHash" TEXT,
ADD COLUMN     "harvestBatchId" TEXT,
ADD COLUMN     "isFreeTicketTier" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "payoutClaimId" TEXT,
ADD COLUMN     "relayBatchId" TEXT;

-- CreateTable
CREATE TABLE "RelayBatch" (
    "id" TEXT NOT NULL,
    "orderHash" TEXT NOT NULL,
    "batchIndex" INTEGER NOT NULL,
    "txHash" TEXT,
    "status" "HarvestStatus" NOT NULL DEFAULT 'SUBMITTED',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "RelayBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HarvestBatch" (
    "id" TEXT NOT NULL,
    "megapotId" INTEGER NOT NULL,
    "txHash" TEXT,
    "status" "HarvestStatus" NOT NULL DEFAULT 'SUBMITTED',
    "amountGross" BIGINT NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "HarvestBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutClaim" (
    "id" TEXT NOT NULL,
    "wallet" VARCHAR(44) NOT NULL,
    "amountUsdc" BIGINT NOT NULL DEFAULT 0,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "txSignature" TEXT,
    "lastValidBlockHeight" BIGINT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "PayoutClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RelayBatch_orderHash_status_idx" ON "RelayBatch"("orderHash", "status");

-- CreateIndex
CREATE INDEX "RelayBatch_status_idx" ON "RelayBatch"("status");

-- CreateIndex
CREATE INDEX "HarvestBatch_megapotId_status_idx" ON "HarvestBatch"("megapotId", "status");

-- CreateIndex
CREATE INDEX "HarvestBatch_status_idx" ON "HarvestBatch"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PayoutClaim_txSignature_key" ON "PayoutClaim"("txSignature");

-- CreateIndex
CREATE INDEX "PayoutClaim_wallet_status_idx" ON "PayoutClaim"("wallet", "status");

-- CreateIndex
CREATE INDEX "PayoutClaim_status_idx" ON "PayoutClaim"("status");

-- CreateIndex
CREATE INDEX "RelayOrder_fulfillEpoch_idx" ON "RelayOrder"("fulfillEpoch");

-- CreateIndex
CREATE INDEX "Ticket_winStatus_idx" ON "Ticket"("winStatus");

-- CreateIndex
CREATE INDEX "Ticket_harvestBatchId_idx" ON "Ticket"("harvestBatchId");

-- CreateIndex
CREATE INDEX "Ticket_payoutClaimId_idx" ON "Ticket"("payoutClaimId");

-- CreateIndex
CREATE INDEX "Ticket_relayBatchId_idx" ON "Ticket"("relayBatchId");

-- AddForeignKey
ALTER TABLE "RelayBatch" ADD CONSTRAINT "RelayBatch_orderHash_fkey" FOREIGN KEY ("orderHash") REFERENCES "RelayOrder"("hash") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_harvestBatchId_fkey" FOREIGN KEY ("harvestBatchId") REFERENCES "HarvestBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_payoutClaimId_fkey" FOREIGN KEY ("payoutClaimId") REFERENCES "PayoutClaim"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_relayBatchId_fkey" FOREIGN KEY ("relayBatchId") REFERENCES "RelayBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

