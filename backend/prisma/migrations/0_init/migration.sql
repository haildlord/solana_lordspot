-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "buyer" TEXT NOT NULL,
    "link_to_nft" TEXT,
    "bonusBall" INTEGER NOT NULL,
    "normalBalls" INTEGER[],
    "lastBought" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Ticket_signature_idx" ON "Ticket"("signature");

