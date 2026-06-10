-- Phase 6 Migration: Checkout safety hardening
-- Idempotent: safe to run multiple times.

-- ── Idempotency key on orders ─────────────────────────────────────────────────
-- Allows client to safely retry a failed checkout without creating duplicates.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(100);

-- Partial unique index: only enforces uniqueness on non-NULL keys.
-- NULL is used for orders placed before this migration (backward compat).
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idempotency_key
    ON orders (idempotency_key)
    WHERE idempotency_key IS NOT NULL;

-- ── Prevent negative stock at DB level ────────────────────────────────────────
-- First, floor any existing negatives to 0 (should not exist, but be safe).
UPDATE products SET stock_quantity = 0 WHERE stock_quantity < 0;

-- Add check constraint — will be verified against all existing rows.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.constraint_column_usage
        WHERE table_name = 'products' AND constraint_name = 'chk_stock_non_negative'
    ) THEN
        ALTER TABLE products
            ADD CONSTRAINT chk_stock_non_negative CHECK (stock_quantity >= 0);
    END IF;
END $$;
