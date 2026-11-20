-- ============================================================================
-- ORDER-TO-AUDIT SYSTEM: DATABASE MIGRATION 000
-- Explicit Schema Upgrade Script for Existing Databases
-- ============================================================================
-- NOTE:
-- For fresh installations, database/setup.sql runs migrations 001 through 005.
-- If you already have an existing database from the initial schema draft, run
-- this upgrade script first to alter existing tables and migrate structures.
-- ============================================================================

DO $$ 
BEGIN
    -- 1. Upgrade items table
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'items' AND column_name = 'packets_per_carton') THEN
        ALTER TABLE items ADD COLUMN packets_per_carton NUMERIC(10, 2) NOT NULL DEFAULT 1.00;
    END IF;

    -- 2. Upgrade production_runs table
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'production_runs' AND column_name = 'planned_batch_count') THEN
        ALTER TABLE production_runs ADD COLUMN planned_batch_count NUMERIC(8, 2) NOT NULL DEFAULT 1.00;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'production_runs' AND column_name = 'standard_batch_size') THEN
        ALTER TABLE production_runs ADD COLUMN standard_batch_size NUMERIC(14, 4) NOT NULL DEFAULT 200.0000;
    END IF;

    -- 3. Upgrade production_run_inputs table
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'production_run_inputs' AND column_name = 'good_production_qty') THEN
        ALTER TABLE production_run_inputs ADD COLUMN good_production_qty NUMERIC(14, 4) NOT NULL DEFAULT 0.0000;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'production_run_inputs' AND column_name = 'damaged_or_scrap_qty') THEN
        ALTER TABLE production_run_inputs ADD COLUMN damaged_or_scrap_qty NUMERIC(14, 4) NOT NULL DEFAULT 0.0000;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'production_run_inputs' AND column_name = 'returned_to_store_qty') THEN
        ALTER TABLE production_run_inputs ADD COLUMN returned_to_store_qty NUMERIC(14, 4) NOT NULL DEFAULT 0.0000;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'production_run_inputs' AND column_name = 'base_net_consumed_qty') THEN
        ALTER TABLE production_run_inputs ADD COLUMN base_net_consumed_qty NUMERIC(14, 4) NOT NULL DEFAULT 0.0000;
    END IF;

    -- 4. Clean up redundant mutable columns on invoices
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'invoices' AND column_name = 'amount_paid') THEN
        ALTER TABLE invoices DROP COLUMN amount_paid;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'invoices' AND column_name = 'balance_due') THEN
        ALTER TABLE invoices DROP COLUMN balance_due;
    END IF;

    -- 5. Upgrade inventory_ledger constraint to strict 1-to-1 source matching
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_source_integrity') THEN
        ALTER TABLE inventory_ledger DROP CONSTRAINT chk_source_integrity;
    END IF;

    ALTER TABLE inventory_ledger ADD CONSTRAINT chk_source_integrity CHECK (
        (movement_type = 'OPENING_BALANCE' AND purchase_bill_item_id IS NULL AND production_run_input_id IS NULL AND production_run_yield_id IS NULL AND dispatch_item_id IS NULL AND stock_adjustment_id IS NULL)
        OR
        (movement_type = 'PURCHASE_RECEIPT' AND purchase_bill_item_id IS NOT NULL AND production_run_input_id IS NULL AND production_run_yield_id IS NULL AND dispatch_item_id IS NULL AND stock_adjustment_id IS NULL)
        OR
        (movement_type = 'PRODUCTION_ISSUE' AND production_run_input_id IS NOT NULL AND purchase_bill_item_id IS NULL AND production_run_yield_id IS NULL AND dispatch_item_id IS NULL AND stock_adjustment_id IS NULL)
        OR
        (movement_type = 'PRODUCTION_YIELD' AND production_run_yield_id IS NOT NULL AND purchase_bill_item_id IS NULL AND production_run_input_id IS NULL AND dispatch_item_id IS NULL AND stock_adjustment_id IS NULL)
        OR
        (movement_type = 'SALES_DISPATCH' AND dispatch_item_id IS NOT NULL AND purchase_bill_item_id IS NULL AND production_run_input_id IS NULL AND production_run_yield_id IS NULL AND stock_adjustment_id IS NULL)
        OR
        (movement_type = 'STOCK_ADJUSTMENT' AND stock_adjustment_id IS NOT NULL AND purchase_bill_item_id IS NULL AND production_run_input_id IS NULL AND production_run_yield_id IS NULL AND dispatch_item_id IS NULL)
    );

END $$;

-- 6. Backfill item_stock_balances table if it does not yet have rows for existing items
CREATE TABLE IF NOT EXISTS item_stock_balances (
    item_id UUID PRIMARY KEY REFERENCES items(id) ON DELETE RESTRICT,
    current_base_qty NUMERIC(14, 4) NOT NULL DEFAULT 0.0000,
    current_moving_wac NUMERIC(12, 4) NOT NULL DEFAULT 0.0000,
    current_total_value NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
    last_transaction_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_non_negative_inventory CHECK (current_base_qty >= 0.0000)
);

INSERT INTO item_stock_balances (item_id, current_base_qty, current_moving_wac, current_total_value)
SELECT 
    i.id,
    COALESCE(SUM(l.base_quantity_delta), 0.0000) AS current_base_qty,
    i.standard_purchase_rate AS current_moving_wac,
    COALESCE(SUM(l.base_quantity_delta), 0.0000) * i.standard_purchase_rate AS current_total_value
FROM items i
LEFT JOIN inventory_ledger l ON i.id = l.item_id
GROUP BY i.id, i.standard_purchase_rate
ON CONFLICT (item_id) DO NOTHING;
