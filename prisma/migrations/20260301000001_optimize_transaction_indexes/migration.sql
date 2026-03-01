-- Drop old composite index that had `type` between `currency` and `createdAt`,
-- preventing PostgreSQL from using the index for ORDER BY createdAt.
DROP INDEX IF EXISTS "transactions_userId_currency_type_createdAt_idx";

-- Index for queries filtered by userId + currency, ordered by createdAt DESC.
-- Covers: getBalance with currency filter.
CREATE INDEX "transactions_userId_currency_createdAt_idx"
  ON "transactions" ("userId", "currency", "createdAt" DESC);

-- Index for queries filtered by userId only, ordered by createdAt DESC.
-- Covers: getBalance without currency filter.
CREATE INDEX "transactions_userId_createdAt_idx"
  ON "transactions" ("userId", "createdAt" DESC);

-- Unique constraint on idempotencyKey to enforce DB-level deduplication.
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_idempotencyKey_key" UNIQUE ("idempotencyKey");
