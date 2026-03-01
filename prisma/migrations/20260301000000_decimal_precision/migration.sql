-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('TOPUP', 'CHARGE');

-- CreateTable
CREATE TABLE "wallets" (
    "userId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "balance" DECIMAL(36,18) NOT NULL DEFAULT 0,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("userId","currency")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "amount" DECIMAL(36,18) NOT NULL,
    "type" "TransactionType" NOT NULL,
    "reason" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "key" TEXT NOT NULL,
    "responseBody" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "transactions_userId_currency_type_createdAt_idx" ON "transactions"("userId", "currency", "type", "createdAt");
