-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('SOLANA_CONFIRMED', 'QUEUED', 'DEFERRED', 'PROCESSING', 'BASE_SUBMITTED', 'SUCCESS', 'RETRY_PENDING', 'FAILED_PERMANENT');

-- CreateEnum
CREATE TYPE "WinStatus" AS ENUM ('DRAW_PENDING', 'LOST', 'WON_UNCLAIMED', 'CLAIMED_ON_BASE', 'PAID_OUT_ON_SOLANA');

-- CreateEnum
CREATE TYPE "WebhookStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'SKIPPED', 'FAILED');

-- CreateTable
CREATE TABLE "WebhookInbox" (
    "id" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "rawPayload" JSONB NOT NULL,
    "status" "WebhookStatus" NOT NULL DEFAULT 'RECEIVED',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "WebhookInbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RelayOrder" (
    "hash" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "buyer" VARCHAR(44) NOT NULL,
    "purchaseEpoch" INTEGER NOT NULL,
    "fulfillEpoch" INTEGER,
    "amountUsdc" BIGINT NOT NULL,
    "ticketCount" INTEGER NOT NULL,
    "lastBought" TIMESTAMP(3) NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'SOLANA_CONFIRMED',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextRetryAt" TIMESTAMP(3),
    "baseTxHash" TEXT,
    "megapotTicketIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RelayOrder_pkey" PRIMARY KEY ("hash")
);

-- CreateTable
CREATE TABLE "RelayAttempt" (
    "id" TEXT NOT NULL,
    "orderHash" TEXT NOT NULL,
    "attemptNum" INTEGER NOT NULL,
    "baseTxHash" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RelayAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL,
    "orderHash" TEXT NOT NULL,
    "bonusBall" SMALLINT NOT NULL,
    "normalBalls" SMALLINT[],
    "megapotNftId" TEXT,
    "winStatus" "WinStatus" NOT NULL DEFAULT 'DRAW_PENDING',
    "winAmount" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndexerCursor" (
    "id" TEXT NOT NULL DEFAULT 'solana_vault',
    "signature" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndexerCursor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProtocolState" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "isPaused" BOOLEAN NOT NULL DEFAULT false,
    "currentEpochId" INTEGER,
    "endedAt" TIMESTAMP(3),
    "maxNormalBall" SMALLINT,
    "maxBonusBall" SMALLINT,
    "prizePoolAmount" BIGINT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProtocolState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MegapotEpoch" (
    "megapotId" INTEGER NOT NULL,
    "ticketCount" INTEGER NOT NULL,
    "uniqueParticipants" INTEGER NOT NULL,
    "winnersCount" INTEGER NOT NULL,
    "topPrizeAmount" BIGINT NOT NULL,
    "topPrizeWinnersCount" INTEGER NOT NULL,
    "lpEarningsAmount" BIGINT NOT NULL,
    "winningNormals" SMALLINT[],
    "winningBonusBall" SMALLINT NOT NULL,
    "prizeTiers" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MegapotEpoch_pkey" PRIMARY KEY ("megapotId")
);

-- CreateIndex
CREATE UNIQUE INDEX "WebhookInbox_signature_key" ON "WebhookInbox"("signature");

-- CreateIndex
CREATE INDEX "WebhookInbox_status_createdAt_idx" ON "WebhookInbox"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RelayOrder_signature_key" ON "RelayOrder"("signature");

-- CreateIndex
CREATE INDEX "RelayOrder_status_nextRetryAt_idx" ON "RelayOrder"("status", "nextRetryAt");

-- CreateIndex
CREATE INDEX "RelayOrder_buyer_idx" ON "RelayOrder"("buyer");

-- CreateIndex
CREATE INDEX "RelayAttempt_orderHash_idx" ON "RelayAttempt"("orderHash");

-- CreateIndex
CREATE INDEX "Ticket_orderHash_idx" ON "Ticket"("orderHash");

-- AddForeignKey
ALTER TABLE "RelayAttempt" ADD CONSTRAINT "RelayAttempt_orderHash_fkey" FOREIGN KEY ("orderHash") REFERENCES "RelayOrder"("hash") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_orderHash_fkey" FOREIGN KEY ("orderHash") REFERENCES "RelayOrder"("hash") ON DELETE RESTRICT ON UPDATE CASCADE;
