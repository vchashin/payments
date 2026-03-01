-- AlterTable: add operationType to IdempotencyRecord
ALTER TABLE "idempotency_records" ADD COLUMN "operationType" TEXT NOT NULL DEFAULT '';

-- Remove default after backfill (new rows must always supply operationType)
ALTER TABLE "idempotency_records" ALTER COLUMN "operationType" DROP DEFAULT;

-- CreateIndex for TTL cleanup queries
CREATE INDEX "idempotency_records_createdAt_idx" ON "idempotency_records"("createdAt");

-- CreateTable: DailyUsage for serializable daily-limit tracking
CREATE TABLE "daily_usage" (
    "userId"   TEXT           NOT NULL,
    "currency" TEXT           NOT NULL,
    "date"     DATE           NOT NULL,
    "total"    DECIMAL(36,18) NOT NULL DEFAULT 0,

    CONSTRAINT "daily_usage_pkey" PRIMARY KEY ("userId", "currency", "date")
);
