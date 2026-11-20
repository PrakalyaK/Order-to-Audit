-- ============================================================================
-- ORDER-TO-AUDIT SYSTEM: DATABASE MIGRATION 000
-- Explicit Schema Upgrade Script for Existing Databases
-- ============================================================================
-- SCOPE & COMPATIBILITY SPECIFICATION:
--   Supported Source Version: Order-to-Audit Draft Schema v1.0
--     (Identified by: invoices table having mutable amount_paid and balance_due 
--      columns, and missing payment_allocations table).
--   Target Destination: Order-to-Audit Certified Schema v2.0
--   
--   WARNING: This upgrade script is tailored specifically for upgrading from v1.0.
--   It does NOT support arbitrary older schemas or untracked legacy databases.
--   For fresh installations, use database/setup.sql directly.
-- ============================================================================

-- Step A: Ensure payment_allocations table exists prior to data reconciliation
CREATE TABLE IF NOT EXISTS payment_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
    allocated_amount NUMERIC(12, 2) NOT NULL CHECK (allocated_amount > 0),
    allocated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    allocated_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    CONSTRAINT uq_payment_invoice_alloc UNIQUE (payment_id, invoice_id)
);

-- Step B: Ensure payments.payment_mode CHECK constraint permits 'legacy_reconciliation'
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_payment_mode_check') THEN
        ALTER TABLE payments DROP CONSTRAINT payments_payment_mode_check;
    END IF;
    ALTER TABLE payments ADD CONSTRAINT payments_payment_mode_check 
        CHECK (payment_mode IN ('cash', 'upi', 'neft_rtgs', 'cheque', 'legacy_reconciliation'));
END $$;

DO $$ 
DECLARE
    v_inv RECORD;
    v_actual_payment_id UUID;
BEGIN
    -- 1. Upgrade items table with packets_per_carton
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

    -- 4. PRESERVE & RECONCILE EXISTING INVOICE PAYMENT DATA BEFORE DROPPING COLUMNS
    -- If amount_paid exists and has values > 0, migrate them into payments and payment_allocations
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'invoices' AND column_name = 'amount_paid') THEN
        FOR v_inv IN 
            SELECT id, invoice_number, customer_id, invoice_date, amount_paid, approved_by 
            FROM invoices 
            WHERE COALESCE(amount_paid, 0.00) > 0.00
        LOOP
            -- Check if this invoice already has payment allocations
            IF NOT EXISTS (SELECT 1 FROM payment_allocations WHERE invoice_id = v_inv.id) THEN
                v_actual_payment_id := NULL;
                
                -- Create historical payment record or safely retrieve existing payment ID if receipt exists
                INSERT INTO payments (
                    id, receipt_number, customer_id, payment_date, total_amount, payment_mode, notes, recorded_by
                ) VALUES (
                    gen_random_uuid(),
                    'MIGRATED-REC-' || v_inv.invoice_number,
                    v_inv.customer_id,
                    v_inv.invoice_date,
                    v_inv.amount_paid,
                    'legacy_reconciliation',
                    'Automatically migrated from legacy invoice.amount_paid during v1.0 to v2.0 schema upgrade',
                    v_inv.approved_by
                ) 
                ON CONFLICT (receipt_number) DO UPDATE
                    SET notes = EXCLUDED.notes
                RETURNING id INTO v_actual_payment_id;

                -- Fallback lookup if ON CONFLICT did not return ID
                IF v_actual_payment_id IS NULL THEN
                    SELECT id INTO v_actual_payment_id 
                    FROM payments 
                    WHERE receipt_number = 'MIGRATED-REC-' || v_inv.invoice_number;
                END IF;

                -- Create allocation record using the confirmed, existing payment ID
                INSERT INTO payment_allocations (
                    payment_id, invoice_id, allocated_amount, allocated_by
                ) VALUES (
                    v_actual_payment_id,
                    v_inv.id,
                    v_inv.amount_paid,
                    v_inv.approved_by
                ) ON CONFLICT (payment_id, invoice_id) DO NOTHING;
            END IF;
        END LOOP;

        -- Safe to drop obsolete columns now that payment history is preserved
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
