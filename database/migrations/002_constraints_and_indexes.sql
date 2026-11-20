-- ============================================================================
-- ORDER-TO-AUDIT SYSTEM: DATABASE MIGRATION 002
-- Constraints and Performance Indexes (Idempotent & Non-Destructive)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. BUSINESS INTEGRITY CONSTRAINTS
-- Wrapped in idempotent blocks to allow safe re-execution
-- ----------------------------------------------------------------------------
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_inventory_movement_sign') THEN
        ALTER TABLE inventory_ledger ADD CONSTRAINT chk_inventory_movement_sign CHECK (
            (movement_type IN ('OPENING_BALANCE', 'PURCHASE_RECEIPT', 'PRODUCTION_YIELD', 'SALES_RETURN') AND base_quantity_delta >= 0)
            OR
            (movement_type IN ('PRODUCTION_ISSUE', 'SALES_DISPATCH') AND base_quantity_delta <= 0)
            OR
            (movement_type = 'STOCK_ADJUSTMENT')
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_item_prices') THEN
        ALTER TABLE items ADD CONSTRAINT chk_item_prices CHECK (
            standard_selling_price >= 0 AND standard_purchase_rate >= 0 AND min_reorder_level >= 0
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_bom_tolerance') THEN
        ALTER TABLE boms ADD CONSTRAINT chk_bom_tolerance CHECK (
            tolerance_variance_pct >= 0 AND standard_batch_size > 0
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_production_quantities') THEN
        ALTER TABLE production_runs ADD CONSTRAINT chk_production_quantities CHECK (
            planned_batch_count > 0 AND actual_good_output_qty >= 0 AND actual_scrap_output_qty >= 0
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_order_totals') THEN
        ALTER TABLE sales_orders ADD CONSTRAINT chk_order_totals CHECK (
            subtotal_amount >= 0 AND estimated_tax_amount >= 0 AND total_order_value >= 0
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_invoice_totals') THEN
        ALTER TABLE invoices ADD CONSTRAINT chk_invoice_totals CHECK (
            taxable_value >= 0 AND cgst_amount >= 0 AND sgst_amount >= 0 AND igst_amount >= 0 AND total_invoice_value >= 0
        );
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2. BOM ACTIVE VERSION CONSTRAINT
-- Only one BOM recipe can be active per finished good at any given time
-- ----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_single_active_bom_per_product 
ON boms (finished_good_item_id) 
WHERE is_active = true;

-- ----------------------------------------------------------------------------
-- 3. INVENTORY LEDGER SOURCE INTEGRITY & UNIQUE POSTING INDEXES
-- Enforces that a source document line item can NEVER be posted more than once
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_ledger_item_timestamp 
ON inventory_ledger (item_id, transaction_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_ledger_item_batch 
ON inventory_ledger (item_id, batch_number) 
WHERE batch_number IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_purchase_item 
ON inventory_ledger (purchase_bill_item_id) 
WHERE purchase_bill_item_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_prod_input 
ON inventory_ledger (production_run_input_id) 
WHERE production_run_input_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_prod_yield 
ON inventory_ledger (production_run_yield_id) 
WHERE production_run_yield_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_dispatch_item 
ON inventory_ledger (dispatch_item_id) 
WHERE dispatch_item_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_stock_adj 
ON inventory_ledger (stock_adjustment_id) 
WHERE stock_adjustment_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 4. SALES, INVOICING & PAYMENT ALLOCATION INDEXES
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_invoices_customer_date 
ON invoices (customer_id, invoice_date DESC);

CREATE INDEX IF NOT EXISTS idx_invoices_status 
ON invoices (status);

CREATE INDEX IF NOT EXISTS idx_payments_customer_date 
ON payments (customer_id, payment_date DESC);

CREATE INDEX IF NOT EXISTS idx_payment_allocations_payment 
ON payment_allocations (payment_id);

CREATE INDEX IF NOT EXISTS idx_payment_allocations_invoice 
ON payment_allocations (invoice_id);

CREATE INDEX IF NOT EXISTS idx_sales_orders_salesman_date 
ON sales_orders (salesman_id, order_date DESC);

CREATE INDEX IF NOT EXISTS idx_sales_orders_customer_status 
ON sales_orders (customer_id, status);

CREATE INDEX IF NOT EXISTS idx_sales_orders_offline_uuid 
ON sales_orders (offline_client_uuid) 
WHERE offline_client_uuid IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 5. PRODUCTION & PROCUREMENT INDEXES
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_production_runs_item_date 
ON production_runs (finished_good_item_id, run_date DESC);

CREATE INDEX IF NOT EXISTS idx_production_runs_status 
ON production_runs (status);

CREATE INDEX IF NOT EXISTS idx_purchase_bills_supplier_date 
ON purchase_bills (supplier_id, bill_date DESC);
