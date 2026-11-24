-- ORDER-TO-AUDIT DOCKER INITIALIZATION SCRIPT

-- ==========================================
-- database/migrations/001_initial_schema.sql
-- ==========================================
-- ============================================================================
-- ORDER-TO-AUDIT SYSTEM: DATABASE MIGRATION 001
-- Non-Destructive Table Definitions & Relational Schema
-- ============================================================================

-- Extensions for UUID keys and cryptographic hashes
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. USERS & ROLES
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    phone VARCHAR(20),
    role VARCHAR(30) NOT NULL CHECK (role IN (
        'salesman',
        'factory_admin',
        'production_supervisor',
        'auditor',
        'owner'
    )),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 2. AUDIT LOGS (Immutable log of all sensitive state transitions)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(50) NOT NULL,
    entity_name VARCHAR(50) NOT NULL,
    entity_id VARCHAR(64) NOT NULL,
    old_values JSONB,
    new_values JSONB,
    ip_address VARCHAR(45),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 3. UNITS OF MEASURE
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS units_of_measure (
    id VARCHAR(10) PRIMARY KEY, -- 'KG', 'G', 'L', 'ML', 'PCS', 'PKT', 'CTN'
    name VARCHAR(50) NOT NULL,
    dimension VARCHAR(20) NOT NULL CHECK (dimension IN ('weight', 'volume', 'count', 'packaging')),
    base_unit_id VARCHAR(10) REFERENCES units_of_measure(id),
    conversion_factor_to_base NUMERIC(14, 6) NOT NULL DEFAULT 1.000000
);

-- ----------------------------------------------------------------------------
-- 4. ITEMS (Master Product and Material Catalog)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sku VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(150) NOT NULL,
    item_type VARCHAR(25) NOT NULL CHECK (item_type IN (
        'raw_material',
        'packaging',
        'work_in_progress',
        'finished_good'
    )),
    base_uom_id VARCHAR(10) NOT NULL REFERENCES units_of_measure(id),
    hsn_code VARCHAR(10) NOT NULL,
    gst_rate_pct NUMERIC(5, 2) NOT NULL DEFAULT 5.00,
    standard_selling_price NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    standard_purchase_rate NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    min_reorder_level NUMERIC(14, 4) NOT NULL DEFAULT 0.0000,
    -- Product-specific carton packing density (e.g. 20 packets/carton for Murukku 200g)
    packets_per_carton NUMERIC(10, 2) NOT NULL DEFAULT 1.00,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 5. PARTIES (Customers & Suppliers)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS parties (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    party_type VARCHAR(20) NOT NULL CHECK (party_type IN ('customer', 'supplier', 'both')),
    trade_name VARCHAR(150) NOT NULL,
    contact_person VARCHAR(100),
    phone VARCHAR(20) NOT NULL,
    email VARCHAR(100),
    gstin VARCHAR(15),
    state_code VARCHAR(2) NOT NULL, -- '33' for Tamil Nadu, '29' for Karnataka
    state_name VARCHAR(50) NOT NULL,
    billing_address TEXT NOT NULL,
    shipping_address TEXT,
    credit_limit NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    payment_terms_days INT NOT NULL DEFAULT 30,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 6. BILL OF MATERIALS (BOM) & RECIPE VERSIONING
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS boms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    finished_good_item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
    bom_code VARCHAR(50) NOT NULL,
    version_number INT NOT NULL DEFAULT 1,
    standard_batch_size NUMERIC(14, 4) NOT NULL,
    batch_uom_id VARCHAR(10) NOT NULL REFERENCES units_of_measure(id),
    tolerance_variance_pct NUMERIC(5, 2) NOT NULL DEFAULT 3.00,
    is_active BOOLEAN NOT NULL DEFAULT false,
    effective_from DATE NOT NULL,
    effective_to DATE,
    notes TEXT,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_bom_version UNIQUE (finished_good_item_id, version_number)
);

CREATE TABLE IF NOT EXISTS bom_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bom_id UUID NOT NULL REFERENCES boms(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
    standard_qty NUMERIC(14, 4) NOT NULL,
    uom_id VARCHAR(10) NOT NULL REFERENCES units_of_measure(id),
    scrap_allowance_pct NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
    CONSTRAINT uq_bom_item UNIQUE (bom_id, item_id)
);

-- ----------------------------------------------------------------------------
-- 7. PROCUREMENT (Purchases)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS purchase_bills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id UUID NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,
    bill_number VARCHAR(50) NOT NULL,
    bill_date DATE NOT NULL,
    subtotal_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    cgst_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    sgst_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    igst_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    total_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'received', 'cancelled')),
    received_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_supplier_bill UNIQUE (supplier_id, bill_number)
);

CREATE TABLE IF NOT EXISTS purchase_bill_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_bill_id UUID NOT NULL REFERENCES purchase_bills(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
    supplier_batch_no VARCHAR(50),
    expiry_date DATE,
    quantity NUMERIC(14, 4) NOT NULL, -- Quantity in transaction UOM (e.g. 1 bag)
    uom_id VARCHAR(10) NOT NULL REFERENCES units_of_measure(id),
    base_quantity NUMERIC(14, 4) NOT NULL, -- Normalized quantity in base UOM (e.g. 50 kg)
    unit_rate NUMERIC(12, 2) NOT NULL, -- Rate per transaction UOM (e.g. ₹2,250.00/bag)
    taxable_amount NUMERIC(12, 2) NOT NULL, -- quantity * unit_rate
    gst_rate_pct NUMERIC(5, 2) NOT NULL,
    tax_amount NUMERIC(12, 2) NOT NULL,
    total_amount NUMERIC(12, 2) NOT NULL,
    -- Derived effective cost rate per base UOM for inventory valuation (e.g. ₹45.00/kg)
    base_unit_rate NUMERIC(12, 4) GENERATED ALWAYS AS (
        CASE WHEN base_quantity > 0 THEN ROUND(taxable_amount / base_quantity, 4) ELSE 0.0000 END
    ) STORED,
    CONSTRAINT chk_purchase_item_math CHECK (
        taxable_amount = ROUND(quantity * unit_rate, 2) 
        AND total_amount = ROUND(taxable_amount + tax_amount, 2)
    )
);

-- ----------------------------------------------------------------------------
-- 8. PRODUCTION RUNS & ADVANCED INPUT TRACKING
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS production_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_number VARCHAR(50) UNIQUE NOT NULL,
    bom_id UUID NOT NULL REFERENCES boms(id) ON DELETE RESTRICT,
    finished_good_item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
    output_batch_number VARCHAR(50) NOT NULL,
    run_date DATE NOT NULL,
    planned_batch_count NUMERIC(8, 2) NOT NULL DEFAULT 1.00,
    standard_batch_size NUMERIC(14, 4) NOT NULL,
    planned_yield_qty NUMERIC(14, 4) NOT NULL,
    actual_good_output_qty NUMERIC(14, 4) NOT NULL DEFAULT 0.0000,
    actual_scrap_output_qty NUMERIC(14, 4) NOT NULL DEFAULT 0.0000,
    yield_variance_qty NUMERIC(14, 4) GENERATED ALWAYS AS (actual_good_output_qty - planned_yield_qty) STORED,
    yield_variance_pct NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
    is_yield_flagged BOOLEAN NOT NULL DEFAULT false,
    status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN (
        'draft',
        'materials_issued',
        'completed',
        'cancelled'
    )),
    supervisor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS production_run_inputs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    production_run_id UUID NOT NULL REFERENCES production_runs(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
    planned_qty NUMERIC(14, 4) NOT NULL,
    actual_issued_qty NUMERIC(14, 4) NOT NULL,
    good_production_qty NUMERIC(14, 4) NOT NULL DEFAULT 0.0000,
    damaged_or_scrap_qty NUMERIC(14, 4) NOT NULL DEFAULT 0.0000,
    returned_to_store_qty NUMERIC(14, 4) NOT NULL DEFAULT 0.0000,
    uom_id VARCHAR(10) NOT NULL REFERENCES units_of_measure(id),
    base_net_consumed_qty NUMERIC(14, 4) NOT NULL,
    unit_cost_applied NUMERIC(12, 4) NOT NULL, -- Pinned Moving WAC at issue time
    total_material_cost NUMERIC(12, 2) NOT NULL,
    consumption_variance_qty NUMERIC(14, 4) NOT NULL,
    consumption_variance_pct NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
    is_consumption_flagged BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT chk_production_mass_balance CHECK (
        ROUND(actual_issued_qty, 4) = ROUND(good_production_qty + damaged_or_scrap_qty + returned_to_store_qty, 4)
    )
);

CREATE TABLE IF NOT EXISTS production_run_overheads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    production_run_id UUID NOT NULL REFERENCES production_runs(id) ON DELETE CASCADE,
    overhead_type VARCHAR(50) NOT NULL CHECK (overhead_type IN ('labour', 'power_gas', 'maintenance', 'depreciation', 'other')),
    description VARCHAR(150),
    amount NUMERIC(12, 2) NOT NULL
);

CREATE TABLE IF NOT EXISTS production_run_costing (
    production_run_id UUID PRIMARY KEY REFERENCES production_runs(id) ON DELETE CASCADE,
    total_raw_material_cost NUMERIC(12, 2) NOT NULL,
    total_packaging_cost NUMERIC(12, 2) NOT NULL,
    total_direct_overhead_cost NUMERIC(12, 2) NOT NULL,
    gross_total_batch_cost NUMERIC(12, 2) NOT NULL,
    good_output_units NUMERIC(14, 4) NOT NULL,
    cost_per_packet NUMERIC(12, 4) NOT NULL,
    selling_price_per_packet NUMERIC(12, 2) NOT NULL,
    unit_gross_margin NUMERIC(12, 2) NOT NULL,
    gross_margin_pct NUMERIC(5, 2) NOT NULL,
    valuation_method_used VARCHAR(30) NOT NULL DEFAULT 'WEIGHTED_AVERAGE',
    calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 9. SALES ORDERS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number VARCHAR(50) UNIQUE NOT NULL,
    customer_id UUID NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,
    salesman_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    order_date DATE NOT NULL,
    offline_client_uuid UUID UNIQUE,
    status VARCHAR(20) NOT NULL DEFAULT 'submitted' CHECK (status IN (
        'submitted',
        'approved',
        'rejected',
        'invoiced',
        'dispatched',
        'cancelled'
    )),
    subtotal_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    estimated_tax_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    total_order_value NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    rejection_reason TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sales_order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sales_order_id UUID NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
    item_name_snapshot VARCHAR(150) NOT NULL,
    hsn_code_snapshot VARCHAR(10) NOT NULL,
    ordered_qty NUMERIC(14, 4) NOT NULL,
    approved_qty NUMERIC(14, 4),
    uom_id VARCHAR(10) NOT NULL REFERENCES units_of_measure(id),
    unit_price NUMERIC(12, 2) NOT NULL,
    gst_rate_pct NUMERIC(5, 2) NOT NULL,
    taxable_value NUMERIC(12, 2) NOT NULL,
    total_item_value NUMERIC(12, 2) NOT NULL
);

-- ----------------------------------------------------------------------------
-- 10. GST INVOICES (Non-Redundant: Balances derived from allocations)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number VARCHAR(50) UNIQUE NOT NULL,
    financial_year VARCHAR(10) NOT NULL,
    sales_order_id UUID NOT NULL REFERENCES sales_orders(id) ON DELETE RESTRICT,
    customer_id UUID NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,
    invoice_date DATE NOT NULL,
    place_of_supply_state_code VARCHAR(2) NOT NULL,
    is_interstate BOOLEAN NOT NULL,
    taxable_value NUMERIC(12, 2) NOT NULL,
    cgst_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    sgst_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    igst_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    total_invoice_value NUMERIC(12, 2) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'posted' CHECK (status IN (
        'draft',
        'posted',
        'dispatched',
        'cancelled'
    )),
    pdf_storage_path TEXT,
    approved_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_invoice_fy_number UNIQUE (financial_year, invoice_number)
);

CREATE TABLE IF NOT EXISTS invoice_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
    item_name_snapshot VARCHAR(150) NOT NULL,
    hsn_code_snapshot VARCHAR(10) NOT NULL,
    quantity NUMERIC(14, 4) NOT NULL,
    uom_id VARCHAR(10) NOT NULL REFERENCES units_of_measure(id),
    base_quantity NUMERIC(14, 4) NOT NULL,
    unit_price NUMERIC(12, 2) NOT NULL,
    taxable_value NUMERIC(12, 2) NOT NULL,
    gst_rate_pct NUMERIC(5, 2) NOT NULL,
    cgst_rate_pct NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
    cgst_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    sgst_rate_pct NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
    sgst_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    igst_rate_pct NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
    igst_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    total_item_value NUMERIC(12, 2) NOT NULL
);

-- ----------------------------------------------------------------------------
-- 11. DISPATCHES
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dispatches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dispatch_number VARCHAR(50) UNIQUE NOT NULL,
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
    dispatch_date DATE NOT NULL,
    carrier_or_vehicle_no VARCHAR(50),
    driver_name VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'dispatched', 'delivered')),
    dispatched_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dispatch_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dispatch_id UUID NOT NULL REFERENCES dispatches(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
    batch_number VARCHAR(50) NOT NULL,
    dispatched_qty NUMERIC(14, 4) NOT NULL,
    uom_id VARCHAR(10) NOT NULL REFERENCES units_of_measure(id),
    base_quantity NUMERIC(14, 4) NOT NULL
);

-- ----------------------------------------------------------------------------
-- 12. PAYMENTS & PAYMENT ALLOCATIONS
-- Supports 1 payment split across multiple invoices, partial payments & advances
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_number VARCHAR(50) UNIQUE NOT NULL,
    customer_id UUID NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,
    payment_date DATE NOT NULL,
    total_amount NUMERIC(12, 2) NOT NULL CHECK (total_amount > 0),
    payment_mode VARCHAR(30) NOT NULL CHECK (payment_mode IN ('cash', 'upi', 'neft_rtgs', 'cheque', 'legacy_reconciliation')),
    reference_txn_id VARCHAR(100),
    notes TEXT,
    recorded_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
    allocated_amount NUMERIC(12, 2) NOT NULL CHECK (allocated_amount > 0),
    allocated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    allocated_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    CONSTRAINT uq_payment_invoice_alloc UNIQUE (payment_id, invoice_id)
);

-- ----------------------------------------------------------------------------
-- 13. CREDIT NOTES
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS credit_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    credit_note_number VARCHAR(50) UNIQUE NOT NULL,
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
    customer_id UUID NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,
    issue_date DATE NOT NULL,
    reason VARCHAR(50) NOT NULL CHECK (reason IN ('order_cancellation', 'goods_returned', 'pricing_correction')),
    taxable_value NUMERIC(12, 2) NOT NULL,
    cgst_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    sgst_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    igst_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    total_credit_amount NUMERIC(12, 2) NOT NULL,
    notes TEXT,
    approved_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 14. STOCK ADJUSTMENTS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock_adjustments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    adjustment_number VARCHAR(50) UNIQUE NOT NULL,
    adjustment_date DATE NOT NULL,
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
    book_quantity NUMERIC(14, 4) NOT NULL,
    physical_quantity NUMERIC(14, 4) NOT NULL,
    discrepancy_quantity NUMERIC(14, 4) GENERATED ALWAYS AS (physical_quantity - book_quantity) STORED,
    reason TEXT NOT NULL,
    authorized_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 15. ITEM STOCK BALANCES (Real-time snapshot with strict non-negative check)
-- Row-locked during transactions to prevent concurrency race conditions
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS item_stock_balances (
    item_id UUID PRIMARY KEY REFERENCES items(id) ON DELETE RESTRICT,
    current_base_qty NUMERIC(14, 4) NOT NULL DEFAULT 0.0000,
    current_moving_wac NUMERIC(12, 4) NOT NULL DEFAULT 0.0000,
    current_total_value NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
    last_transaction_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Strict prevention of negative inventory at the database layer
    CONSTRAINT chk_non_negative_inventory CHECK (current_base_qty >= 0.0000)
);

-- Auto-initialize item_stock_balances row whenever a new item is created
CREATE OR REPLACE FUNCTION fn_trg_init_item_stock_balance()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO item_stock_balances (item_id, current_base_qty, current_moving_wac, current_total_value)
    VALUES (NEW.id, 0.0000, NEW.standard_purchase_rate, 0.00)
    ON CONFLICT (item_id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_init_item_stock_balance ON items;
CREATE TRIGGER trg_init_item_stock_balance
AFTER INSERT ON items
FOR EACH ROW
EXECUTE FUNCTION fn_trg_init_item_stock_balance();

-- ----------------------------------------------------------------------------
-- 16. THE IMMUTABLE INVENTORY LEDGER (Append-Only with Strict Source Integrity)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_ledger (
    id BIGSERIAL PRIMARY KEY,
    transaction_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
    batch_number VARCHAR(50),
    expiry_date DATE,
    movement_type VARCHAR(30) NOT NULL CHECK (movement_type IN (
        'OPENING_BALANCE',
        'PURCHASE_RECEIPT',
        'PRODUCTION_ISSUE',
        'PRODUCTION_YIELD',
        'SALES_DISPATCH',
        'SALES_RETURN',
        'STOCK_ADJUSTMENT'
    )),
    transaction_qty NUMERIC(14, 4) NOT NULL,
    transaction_uom_id VARCHAR(10) NOT NULL REFERENCES units_of_measure(id),
    base_quantity_delta NUMERIC(14, 4) NOT NULL,
    unit_cost NUMERIC(12, 4) NOT NULL DEFAULT 0.0000,
    total_cost NUMERIC(12, 2) NOT NULL,
    -- Explicit referential integrity to source transaction documents
    purchase_bill_item_id UUID REFERENCES purchase_bill_items(id) ON DELETE RESTRICT,
    production_run_input_id UUID REFERENCES production_run_inputs(id) ON DELETE RESTRICT,
    production_run_yield_id UUID REFERENCES production_runs(id) ON DELETE RESTRICT,
    dispatch_item_id UUID REFERENCES dispatch_items(id) ON DELETE RESTRICT,
    stock_adjustment_id UUID REFERENCES stock_adjustments(id) ON DELETE RESTRICT,
    source_reference_label VARCHAR(60) NOT NULL,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Enforce exact 1-to-1 matching between movement_type and corresponding source document
    CONSTRAINT chk_source_integrity CHECK (
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
    )
);


-- ==========================================
-- database/migrations/002_constraints_and_indexes.sql
-- ==========================================
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


-- ==========================================
-- database/migrations/003_audit_and_immutability.sql
-- ==========================================
-- ============================================================================
-- ORDER-TO-AUDIT SYSTEM: DATABASE MIGRATION 003
-- Tamper-Proof Audit Logging & Statutory Immutability Enforcers
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. GENUINE PROTECTION OF AUDIT LOG RECORDS
-- The audit_logs table itself is made append-only. No UPDATE or DELETE allowed.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_prevent_audit_log_modification()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Security & Compliance Violation: Audit logs are strictly immutable and cannot be updated or deleted.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protect_audit_logs ON audit_logs;
CREATE TRIGGER trg_protect_audit_logs
BEFORE UPDATE OR DELETE ON audit_logs
FOR EACH ROW
EXECUTE FUNCTION fn_prevent_audit_log_modification();

-- ----------------------------------------------------------------------------
-- 2. IMMUTABLE INVENTORY LEDGER ENFORCER
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_prevent_inventory_ledger_tampering()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Statutory Audit Violation: Inventory ledger transactions are strictly immutable. Corrections must be made via stock adjustment entries.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_immutable_inventory_ledger ON inventory_ledger;
CREATE TRIGGER trg_immutable_inventory_ledger
BEFORE UPDATE OR DELETE ON inventory_ledger
FOR EACH ROW
EXECUTE FUNCTION fn_prevent_inventory_ledger_tampering();

-- ----------------------------------------------------------------------------
-- 3. PREVENT DELETION OF POSTED BUSINESS TRANSACTIONS
-- Invoices once posted must be cancelled with a Credit Note, never deleted
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_prevent_posted_invoice_deletion()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status IN ('posted', 'dispatched') THEN
        RAISE EXCEPTION 'Statutory Audit Violation: Cannot delete invoice % with status "%". Cancel using a Credit Note.', OLD.invoice_number, OLD.status;
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_posted_invoice_delete ON invoices;
CREATE TRIGGER trg_prevent_posted_invoice_delete
BEFORE DELETE ON invoices
FOR EACH ROW
EXECUTE FUNCTION fn_prevent_posted_invoice_deletion();

-- Production runs once completed cannot be deleted
CREATE OR REPLACE FUNCTION fn_prevent_completed_production_deletion()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status = 'completed' THEN
        RAISE EXCEPTION 'Integrity Violation: Cannot delete completed production run % as inventory has already been posted.', OLD.run_number;
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_completed_production_delete ON production_runs;
CREATE TRIGGER trg_prevent_completed_production_delete
BEFORE DELETE ON production_runs
FOR EACH ROW
EXECUTE FUNCTION fn_prevent_completed_production_deletion();

-- Purchase bills once received cannot be deleted
CREATE OR REPLACE FUNCTION fn_prevent_received_purchase_deletion()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status = 'received' THEN
        RAISE EXCEPTION 'Integrity Violation: Cannot delete received purchase bill % as stock has already been received.', OLD.bill_number;
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_received_purchase_delete ON purchase_bills;
CREATE TRIGGER trg_prevent_received_purchase_delete
BEFORE DELETE ON purchase_bills
FOR EACH ROW
EXECUTE FUNCTION fn_prevent_received_purchase_deletion();

-- ----------------------------------------------------------------------------
-- 4. AUTOMATED AUDIT TRAIL LOGGING FUNCTION
-- Captures the acting user from session setting or document context
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_log_entity_audit_trail()
RETURNS TRIGGER AS $$
DECLARE
    v_user_id UUID;
    v_entity_id VARCHAR(64);
    v_session_user VARCHAR(64);
BEGIN
    -- 1. Try to read application session user context
    v_session_user := current_setting('app.current_user_id', true);
    IF v_session_user IS NOT NULL AND v_session_user <> '' THEN
        BEGIN
            v_user_id := v_session_user::UUID;
        EXCEPTION WHEN OTHERS THEN
            v_user_id := NULL;
        END;
    END IF;

    -- 2. Fall back to document-level actor field if session context is absent
    IF v_user_id IS NULL THEN
        IF TG_OP = 'DELETE' THEN
            v_entity_id := OLD.id::TEXT;
        ELSE
            v_entity_id := NEW.id::TEXT;
            -- Check for known actor columns
            IF TG_TABLE_NAME = 'invoices' THEN
                v_user_id := NEW.approved_by;
            ELSIF TG_TABLE_NAME = 'production_runs' THEN
                v_user_id := NEW.supervisor_id;
            ELSIF TG_TABLE_NAME = 'purchase_bills' THEN
                v_user_id := NEW.received_by;
            ELSIF TG_TABLE_NAME = 'payments' THEN
                v_user_id := NEW.recorded_by;
            ELSIF TG_TABLE_NAME = 'payment_allocations' THEN
                v_user_id := NEW.allocated_by;
            ELSIF TG_TABLE_NAME = 'credit_notes' THEN
                v_user_id := NEW.approved_by;
            END IF;
        END IF;
    ELSE
        IF TG_OP = 'DELETE' THEN
            v_entity_id := OLD.id::TEXT;
        ELSE
            v_entity_id := NEW.id::TEXT;
        END IF;
    END IF;

    -- 3. Record audit trail entry
    INSERT INTO audit_logs (
        user_id,
        action,
        entity_name,
        entity_id,
        old_values,
        new_values
    ) VALUES (
        v_user_id,
        TG_OP || '_' || UPPER(TG_TABLE_NAME),
        TG_TABLE_NAME,
        v_entity_id,
        CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
        CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END
    );

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Attach audit triggers (capturing INSERT, UPDATE, and DELETE)
DROP TRIGGER IF EXISTS trg_audit_invoices ON invoices;
CREATE TRIGGER trg_audit_invoices
AFTER INSERT OR UPDATE OR DELETE ON invoices
FOR EACH ROW
EXECUTE FUNCTION fn_log_entity_audit_trail();

DROP TRIGGER IF EXISTS trg_audit_production_runs ON production_runs;
CREATE TRIGGER trg_audit_production_runs
AFTER INSERT OR UPDATE OR DELETE ON production_runs
FOR EACH ROW
EXECUTE FUNCTION fn_log_entity_audit_trail();

DROP TRIGGER IF EXISTS trg_audit_purchase_bills ON purchase_bills;
CREATE TRIGGER trg_audit_purchase_bills
AFTER INSERT OR UPDATE OR DELETE ON purchase_bills
FOR EACH ROW
EXECUTE FUNCTION fn_log_entity_audit_trail();

DROP TRIGGER IF EXISTS trg_audit_payments ON payments;
CREATE TRIGGER trg_audit_payments
AFTER INSERT OR UPDATE OR DELETE ON payments
FOR EACH ROW
EXECUTE FUNCTION fn_log_entity_audit_trail();

DROP TRIGGER IF EXISTS trg_audit_payment_allocations ON payment_allocations;
CREATE TRIGGER trg_audit_payment_allocations
AFTER INSERT OR UPDATE OR DELETE ON payment_allocations
FOR EACH ROW
EXECUTE FUNCTION fn_log_entity_audit_trail();

DROP TRIGGER IF EXISTS trg_audit_credit_notes ON credit_notes;
CREATE TRIGGER trg_audit_credit_notes
AFTER INSERT OR UPDATE OR DELETE ON credit_notes
FOR EACH ROW
EXECUTE FUNCTION fn_log_entity_audit_trail();


-- ==========================================
-- database/migrations/004_inventory_posting_engine.sql
-- ==========================================
-- ============================================================================
-- ORDER-TO-AUDIT SYSTEM: DATABASE MIGRATION 004
-- Transactional Inventory Posting Engine & Moving WAC Management
-- Incorporates:
--   1. Strict Base UOM Validation & Product-Specific Carton Conversion
--   2. Parent Row Locking for Missing Stock Balance Concurrency Protection
--   3. Absolute Source Integrity & Unique Single-Posting Enforcers
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. BASE UNIT CONVERSION VALIDATOR & COMPUTATION
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_compute_base_quantity(
    p_item_id UUID,
    p_quantity NUMERIC,
    p_uom_id VARCHAR
)
RETURNS NUMERIC AS $$
DECLARE
    v_base_uom VARCHAR(10);
    v_packets_per_carton NUMERIC(10, 2);
    v_conv_factor NUMERIC(14, 6);
    v_uom_base VARCHAR(10);
    v_target_base VARCHAR(10);
BEGIN
    IF p_quantity IS NULL THEN
        RAISE EXCEPTION 'UOM Conversion Error: Quantity cannot be null.';
    END IF;

    SELECT base_uom_id, packets_per_carton 
    INTO v_base_uom, v_packets_per_carton 
    FROM items 
    WHERE id = p_item_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Item with ID % not found.', p_item_id;
    END IF;

    -- Identity conversion (already in base UOM)
    IF p_uom_id = v_base_uom THEN
        RETURN ROUND(p_quantity, 4);
    END IF;

    -- Product-specific carton to packet conversion
    IF p_uom_id = 'CTN' AND v_base_uom = 'PKT' THEN
        IF v_packets_per_carton IS NULL OR v_packets_per_carton <= 0 THEN
            RAISE EXCEPTION 'Configuration Error: Item % has invalid packets_per_carton (%)', p_item_id, v_packets_per_carton;
        END IF;
        RETURN ROUND(p_quantity * v_packets_per_carton, 4);
    END IF;

    -- Product-specific packet to carton conversion (if base unit is CTN)
    IF p_uom_id = 'PKT' AND v_base_uom = 'CTN' THEN
        IF v_packets_per_carton IS NULL OR v_packets_per_carton <= 0 THEN
            RAISE EXCEPTION 'Configuration Error: Item % has invalid packets_per_carton (%)', p_item_id, v_packets_per_carton;
        END IF;
        RETURN ROUND(p_quantity / v_packets_per_carton, 4);
    END IF;

    -- Standard conversion table lookup (from p_uom_id -> base_unit)
    SELECT conversion_factor_to_base, base_unit_id
    INTO v_conv_factor, v_uom_base
    FROM units_of_measure
    WHERE id = p_uom_id;

    IF FOUND AND v_uom_base = v_base_uom THEN
        RETURN ROUND(p_quantity * v_conv_factor, 4);
    END IF;

    -- Standard conversion table reverse lookup (from base_unit -> p_uom_id)
    SELECT conversion_factor_to_base, base_unit_id
    INTO v_conv_factor, v_target_base
    FROM units_of_measure
    WHERE id = v_base_uom;

    IF FOUND AND v_target_base = p_uom_id THEN
        IF v_conv_factor = 0 THEN
            RAISE EXCEPTION 'Division by zero in UOM conversion factor for %', v_base_uom;
        END IF;
        RETURN ROUND(p_quantity / v_conv_factor, 4);
    END IF;

    RAISE EXCEPTION 'Incompatible UOM conversion: cannot convert % to item base unit % for item %',
        p_uom_id, v_base_uom, p_item_id;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 2. ATOMIC PURCHASE RECEIPT POSTING
-- Safe First-Time Concurrency via Parent Item Row Lock + UOM Validation
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_post_purchase_receipt(
    p_purchase_bill_id UUID,
    p_user_id UUID
)
RETURNS VOID AS $$
DECLARE
    v_bill RECORD;
    v_item RECORD;
    v_stock RECORD;
    v_computed_base_qty NUMERIC(14, 4);
    v_receipt_cost NUMERIC(12, 2);
    v_effective_base_rate NUMERIC(12, 4);
    v_new_qty NUMERIC(14, 4);
    v_new_val NUMERIC(14, 2);
    v_new_wac NUMERIC(12, 4);
BEGIN
    -- 1. Lock purchase bill header to prevent concurrent duplicate postings
    SELECT * INTO v_bill 
    FROM purchase_bills 
    WHERE id = p_purchase_bill_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Purchase bill % not found.', p_purchase_bill_id;
    END IF;

    IF v_bill.status <> 'draft' THEN
        RAISE EXCEPTION 'Duplicate Posting Error: Purchase bill % is already in status "%"', v_bill.bill_number, v_bill.status;
    END IF;

    -- 2. Process each inward line item
    FOR v_item IN 
        SELECT * FROM purchase_bill_items WHERE purchase_bill_id = p_purchase_bill_id
    LOOP
        -- Enforce base UOM conversion inside the database
        v_computed_base_qty := fn_compute_base_quantity(v_item.item_id, v_item.quantity, v_item.uom_id);

        IF v_item.base_quantity IS NOT NULL AND ROUND(v_item.base_quantity, 4) <> v_computed_base_qty THEN
            RAISE EXCEPTION 'UOM Conversion Error: Purchase item % base quantity mismatch. Declared: %, Computed: %',
                v_item.id, v_item.base_quantity, v_computed_base_qty;
        END IF;

        -- Validate taxable amount consistency with entered quantity and unit_rate
        IF v_item.taxable_amount <> ROUND(v_item.quantity * v_item.unit_rate, 2) THEN
            RAISE EXCEPTION 'Math Error: Purchase item % taxable_amount (%) != quantity (%) * unit_rate (%)',
                v_item.id, v_item.taxable_amount, v_item.quantity, v_item.unit_rate;
        END IF;

        -- Cost added to inventory is taxable_amount (GST is an input credit, not capitalized into inventory)
        v_receipt_cost := v_item.taxable_amount;
        v_effective_base_rate := ROUND(v_receipt_cost / v_computed_base_qty, 4);

        -- Update purchase_bill_item with validated base quantity
        UPDATE purchase_bill_items 
        SET base_quantity = v_computed_base_qty 
        WHERE id = v_item.id;

        -- CONCURRENCY SAFEGUARD:
        -- Lock parent item record first. Because the item ALWAYS exists in items table,
        -- this guarantees strict serialization across concurrent first-time receipts!
        PERFORM 1 FROM items WHERE id = v_item.item_id FOR UPDATE;

        -- Safely initialize row if missing
        INSERT INTO item_stock_balances (item_id, current_base_qty, current_moving_wac, current_total_value)
        VALUES (v_item.item_id, 0.0000, 0.0000, 0.00)
        ON CONFLICT (item_id) DO NOTHING;

        -- Now safely lock the guaranteed-to-exist stock balance row
        SELECT * INTO v_stock 
        FROM item_stock_balances 
        WHERE item_id = v_item.item_id 
        FOR UPDATE;

        -- Moving WAC formula on receipt: (Current Value + Receipt Value) / (Current Qty + Receipt Qty)
        v_new_qty := v_stock.current_base_qty + v_computed_base_qty;
        v_new_val := ROUND(v_stock.current_total_value + v_receipt_cost, 2);
        
        IF v_new_qty > 0 THEN
            v_new_wac := ROUND(v_new_val / v_new_qty, 4);
        ELSE
            v_new_wac := v_effective_base_rate;
        END IF;

        UPDATE item_stock_balances 
        SET current_base_qty = v_new_qty,
            current_moving_wac = v_new_wac,
            current_total_value = v_new_val,
            last_transaction_timestamp = NOW(),
            updated_at = NOW()
        WHERE item_id = v_item.item_id;

        -- Record immutable inventory ledger entry (Enforced by partial unique index uq_ledger_purchase_item)
        INSERT INTO inventory_ledger (
            transaction_timestamp,
            item_id,
            batch_number,
            expiry_date,
            movement_type,
            transaction_qty,
            transaction_uom_id,
            base_quantity_delta,
            unit_cost,
            total_cost,
            purchase_bill_item_id,
            source_reference_label,
            created_by
        ) VALUES (
            NOW(),
            v_item.item_id,
            v_item.supplier_batch_no,
            v_item.expiry_date,
            'PURCHASE_RECEIPT',
            v_item.quantity,
            v_item.uom_id,
            v_computed_base_qty,
            v_effective_base_rate,
            v_receipt_cost,
            v_item.id,
            v_bill.bill_number,
            p_user_id
        );
    END LOOP;

    -- Update bill status atomically
    UPDATE purchase_bills 
    SET status = 'received' 
    WHERE id = p_purchase_bill_id;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 3. ATOMIC PRODUCTION ISSUE POSTING
-- Unit Conversion Enforcement + Negative Stock Prevention
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_post_production_issue(
    p_production_run_id UUID,
    p_user_id UUID
)
RETURNS VOID AS $$
DECLARE
    v_run RECORD;
    v_input RECORD;
    v_stock RECORD;
    v_item_name VARCHAR(150);
    v_computed_issued NUMERIC(14, 4);
    v_computed_returned NUMERIC(14, 4);
    v_computed_good NUMERIC(14, 4);
    v_computed_scrap NUMERIC(14, 4);
    v_net_consumed NUMERIC(14, 4);
    v_issue_cost NUMERIC(12, 2);
BEGIN
    SELECT * INTO v_run 
    FROM production_runs 
    WHERE id = p_production_run_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Production run % not found.', p_production_run_id;
    END IF;

    IF v_run.status <> 'draft' THEN
        RAISE EXCEPTION 'Duplicate Posting Error: Production run % is already in status "%"', v_run.run_number, v_run.status;
    END IF;

    FOR v_input IN 
        SELECT * FROM production_run_inputs WHERE production_run_id = p_production_run_id
    LOOP
        SELECT name INTO v_item_name FROM items WHERE id = v_input.item_id;

        -- Validate mass balance in entered units
        IF ROUND(v_input.actual_issued_qty, 4) <> ROUND(v_input.good_production_qty + v_input.damaged_or_scrap_qty + v_input.returned_to_store_qty, 4) THEN
            RAISE EXCEPTION 'Mass Balance Error for item "%": Issued (%) != Good (%) + Scrap (%) + Returned (%)',
                v_item_name, v_input.actual_issued_qty, v_input.good_production_qty, v_input.damaged_or_scrap_qty, v_input.returned_to_store_qty;
        END IF;

        -- Enforce base UOM conversion inside database
        v_computed_issued := fn_compute_base_quantity(v_input.item_id, v_input.actual_issued_qty, v_input.uom_id);
        v_computed_returned := fn_compute_base_quantity(v_input.item_id, v_input.returned_to_store_qty, v_input.uom_id);
        v_net_consumed := v_computed_issued - v_computed_returned;

        IF v_input.base_net_consumed_qty IS NOT NULL AND ROUND(v_input.base_net_consumed_qty, 4) <> v_net_consumed THEN
            RAISE EXCEPTION 'UOM Conversion Error: Production input % base net quantity mismatch. Declared: %, Computed: %',
                v_input.id, v_input.base_net_consumed_qty, v_net_consumed;
        END IF;

        -- Update input row with validated base net consumed
        UPDATE production_run_inputs 
        SET base_net_consumed_qty = v_net_consumed 
        WHERE id = v_input.id;

        -- CONCURRENCY SAFEGUARD:
        -- Lock parent item record first, then lock stock balance row
        PERFORM 1 FROM items WHERE id = v_input.item_id FOR UPDATE;

        SELECT * INTO v_stock 
        FROM item_stock_balances 
        WHERE item_id = v_input.item_id 
        FOR UPDATE;

        IF NOT FOUND OR v_stock.current_base_qty < v_net_consumed THEN
            RAISE EXCEPTION 'Negative Inventory Prevention: Insufficient stock for "%". Required: %, Available: %',
                v_item_name, v_net_consumed, COALESCE(v_stock.current_base_qty, 0);
        END IF;

        v_issue_cost := ROUND(v_net_consumed * v_stock.current_moving_wac, 2);

        -- Update production input line with the pinned Moving WAC
        UPDATE production_run_inputs 
        SET unit_cost_applied = v_stock.current_moving_wac,
            total_material_cost = v_issue_cost
        WHERE id = v_input.id;

        -- Decrement stock in item_stock_balances (Moving WAC unit rate remains unchanged upon issue)
        UPDATE item_stock_balances 
        SET current_base_qty = current_base_qty - v_net_consumed,
            current_total_value = ROUND((current_base_qty - v_net_consumed) * current_moving_wac, 2),
            last_transaction_timestamp = NOW(),
            updated_at = NOW()
        WHERE item_id = v_input.item_id;

        -- Record immutable inventory ledger entry (Enforced by partial unique index uq_ledger_prod_input)
        INSERT INTO inventory_ledger (
            transaction_timestamp,
            item_id,
            movement_type,
            transaction_qty,
            transaction_uom_id,
            base_quantity_delta,
            unit_cost,
            total_cost,
            production_run_input_id,
            source_reference_label,
            created_by
        ) VALUES (
            NOW(),
            v_input.item_id,
            'PRODUCTION_ISSUE',
            v_net_consumed,
            v_input.uom_id,
            -v_net_consumed,
            v_stock.current_moving_wac,
            -v_issue_cost,
            v_input.id,
            v_run.run_number,
            p_user_id
        );
    END LOOP;

    UPDATE production_runs 
    SET status = 'materials_issued' 
    WHERE id = p_production_run_id;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 4. ATOMIC PRODUCTION YIELD & FINISHED GOODS MOVING WAC POSTING
-- Safe First-Time Concurrency for Finished Goods Stock
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_post_production_yield(
    p_production_run_id UUID,
    p_user_id UUID
)
RETURNS VOID AS $$
DECLARE
    v_run RECORD;
    v_stock RECORD;
    v_raw_cost NUMERIC(12, 2) := 0.00;
    v_pkg_cost NUMERIC(12, 2) := 0.00;
    v_ovh_cost NUMERIC(12, 2) := 0.00;
    v_total_batch_cost NUMERIC(12, 2) := 0.00;
    v_cost_per_pkt NUMERIC(12, 4);
    v_selling_price NUMERIC(12, 2);
    v_new_fg_qty NUMERIC(14, 4);
    v_new_fg_val NUMERIC(14, 2);
    v_new_fg_wac NUMERIC(12, 4);
BEGIN
    SELECT * INTO v_run 
    FROM production_runs 
    WHERE id = p_production_run_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Production run % not found.', p_production_run_id;
    END IF;

    IF v_run.status <> 'materials_issued' THEN
        RAISE EXCEPTION 'Sequence Error: Production run % must have materials issued before yield can be posted (current: "%")',
            v_run.run_number, v_run.status;
    END IF;

    IF v_run.actual_good_output_qty <= 0 THEN
        RAISE EXCEPTION 'Output Error: Actual good output quantity must be greater than zero.';
    END IF;

    -- Aggregate material costs
    SELECT 
        COALESCE(SUM(CASE WHEN i.item_type = 'raw_material' THEN pri.total_material_cost ELSE 0 END), 0.00),
        COALESCE(SUM(CASE WHEN i.item_type = 'packaging' THEN pri.total_material_cost ELSE 0 END), 0.00)
    INTO v_raw_cost, v_pkg_cost
    FROM production_run_inputs pri
    JOIN items i ON pri.item_id = i.id
    WHERE pri.production_run_id = p_production_run_id;

    -- Aggregate overhead costs
    SELECT COALESCE(SUM(amount), 0.00) 
    INTO v_ovh_cost 
    FROM production_run_overheads 
    WHERE production_run_id = p_production_run_id;

    v_total_batch_cost := v_raw_cost + v_pkg_cost + v_ovh_cost;
    v_cost_per_pkt := ROUND(v_total_batch_cost / v_run.actual_good_output_qty, 4);

    SELECT standard_selling_price INTO v_selling_price 
    FROM items 
    WHERE id = v_run.finished_good_item_id;

    -- Upsert batch costing record
    INSERT INTO production_run_costing (
        production_run_id,
        total_raw_material_cost,
        total_packaging_cost,
        total_direct_overhead_cost,
        gross_total_batch_cost,
        good_output_units,
        cost_per_packet,
        selling_price_per_packet,
        unit_gross_margin,
        gross_margin_pct,
        valuation_method_used
    ) VALUES (
        p_production_run_id,
        v_raw_cost,
        v_pkg_cost,
        v_ovh_cost,
        v_total_batch_cost,
        v_run.actual_good_output_qty,
        v_cost_per_pkt,
        v_selling_price,
        ROUND(v_selling_price - v_cost_per_pkt, 2),
        ROUND(((v_selling_price - v_cost_per_pkt) / v_selling_price) * 100.0, 2),
        'WEIGHTED_AVERAGE'
    ) ON CONFLICT (production_run_id) DO UPDATE SET
        total_raw_material_cost = EXCLUDED.total_raw_material_cost,
        total_packaging_cost = EXCLUDED.total_packaging_cost,
        total_direct_overhead_cost = EXCLUDED.total_direct_overhead_cost,
        gross_total_batch_cost = EXCLUDED.gross_total_batch_cost,
        good_output_units = EXCLUDED.good_output_units,
        cost_per_packet = EXCLUDED.cost_per_packet,
        unit_gross_margin = EXCLUDED.unit_gross_margin,
        gross_margin_pct = EXCLUDED.gross_margin_pct;

    -- CONCURRENCY SAFEGUARD:
    -- Lock parent item record first for the finished good item
    PERFORM 1 FROM items WHERE id = v_run.finished_good_item_id FOR UPDATE;

    INSERT INTO item_stock_balances (item_id, current_base_qty, current_moving_wac, current_total_value)
    VALUES (v_run.finished_good_item_id, 0.0000, 0.0000, 0.00)
    ON CONFLICT (item_id) DO NOTHING;

    SELECT * INTO v_stock 
    FROM item_stock_balances 
    WHERE item_id = v_run.finished_good_item_id 
    FOR UPDATE;

    -- Moving WAC across opening finished goods stock and newly produced batch
    v_new_fg_qty := v_stock.current_base_qty + v_run.actual_good_output_qty;
    v_new_fg_val := ROUND(v_stock.current_total_value + v_total_batch_cost, 2);
    
    IF v_new_fg_qty > 0 THEN
        v_new_fg_wac := ROUND(v_new_fg_val / v_new_fg_qty, 4);
    ELSE
        v_new_fg_wac := v_cost_per_pkt;
    END IF;

    UPDATE item_stock_balances 
    SET current_base_qty = v_new_fg_qty,
        current_moving_wac = v_new_fg_wac,
        current_total_value = v_new_fg_val,
        last_transaction_timestamp = NOW(),
        updated_at = NOW()
    WHERE item_id = v_run.finished_good_item_id;

    -- Record finished goods receipt in inventory ledger (Enforced by partial unique index uq_ledger_prod_yield)
    INSERT INTO inventory_ledger (
        transaction_timestamp,
        item_id,
        batch_number,
        movement_type,
        transaction_qty,
        transaction_uom_id,
        base_quantity_delta,
        unit_cost,
        total_cost,
        production_run_yield_id,
        source_reference_label,
        created_by
    ) VALUES (
        NOW(),
        v_run.finished_good_item_id,
        v_run.output_batch_number,
        'PRODUCTION_YIELD',
        v_run.actual_good_output_qty,
        'PKT',
        v_run.actual_good_output_qty,
        v_cost_per_pkt,
        v_total_batch_cost,
        v_run.id,
        v_run.run_number,
        p_user_id
    );

    UPDATE production_runs 
    SET status = 'completed' 
    WHERE id = p_production_run_id;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 5. ATOMIC SALES DISPATCH POSTING
-- Unit Conversion Enforcement + Finished Goods Deduction at Moving WAC
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_post_sales_dispatch(
    p_dispatch_id UUID,
    p_user_id UUID
)
RETURNS VOID AS $$
DECLARE
    v_dispatch RECORD;
    v_item RECORD;
    v_stock RECORD;
    v_item_name VARCHAR(150);
    v_computed_base_qty NUMERIC(14, 4);
    v_cost_amount NUMERIC(12, 2);
BEGIN
    SELECT * INTO v_dispatch 
    FROM dispatches 
    WHERE id = p_dispatch_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Dispatch % not found.', p_dispatch_id;
    END IF;

    IF v_dispatch.status <> 'ready' THEN
        RAISE EXCEPTION 'Duplicate Posting Error: Dispatch % is already in status "%"',
            v_dispatch.dispatch_number, v_dispatch.status;
    END IF;

    FOR v_item IN 
        SELECT * FROM dispatch_items WHERE dispatch_id = p_dispatch_id
    LOOP
        SELECT name INTO v_item_name FROM items WHERE id = v_item.item_id;

        -- Enforce base UOM conversion inside database
        v_computed_base_qty := fn_compute_base_quantity(v_item.item_id, v_item.dispatched_qty, v_item.uom_id);

        IF v_item.base_quantity IS NOT NULL AND ROUND(v_item.base_quantity, 4) <> v_computed_base_qty THEN
            RAISE EXCEPTION 'UOM Conversion Error: Dispatch item % base quantity mismatch. Declared: %, Computed: %',
                v_item.id, v_item.base_quantity, v_computed_base_qty;
        END IF;

        UPDATE dispatch_items 
        SET base_quantity = v_computed_base_qty 
        WHERE id = v_item.id;

        -- CONCURRENCY SAFEGUARD:
        -- Lock parent item record first, then lock stock balance row
        PERFORM 1 FROM items WHERE id = v_item.item_id FOR UPDATE;

        SELECT * INTO v_stock 
        FROM item_stock_balances 
        WHERE item_id = v_item.item_id 
        FOR UPDATE;

        IF NOT FOUND OR v_stock.current_base_qty < v_computed_base_qty THEN
            RAISE EXCEPTION 'Negative Inventory Prevention: Insufficient finished stock for "%". Required: %, Available: %',
                v_item_name, v_computed_base_qty, COALESCE(v_stock.current_base_qty, 0);
        END IF;

        v_cost_amount := ROUND(v_computed_base_qty * v_stock.current_moving_wac, 2);

        -- Deduct from item_stock_balances (Moving WAC unit rate remains unchanged)
        UPDATE item_stock_balances 
        SET current_base_qty = current_base_qty - v_computed_base_qty,
            current_total_value = ROUND((current_base_qty - v_computed_base_qty) * current_moving_wac, 2),
            last_transaction_timestamp = NOW(),
            updated_at = NOW()
        WHERE item_id = v_item.item_id;

        -- Record sales dispatch in inventory ledger (Enforced by partial unique index uq_ledger_dispatch_item)
        INSERT INTO inventory_ledger (
            transaction_timestamp,
            item_id,
            batch_number,
            movement_type,
            transaction_qty,
            transaction_uom_id,
            base_quantity_delta,
            unit_cost,
            total_cost,
            dispatch_item_id,
            source_reference_label,
            created_by
        ) VALUES (
            NOW(),
            v_item.item_id,
            v_item.batch_number,
            'SALES_DISPATCH',
            v_item.dispatched_qty,
            v_item.uom_id,
            -v_computed_base_qty,
            v_stock.current_moving_wac,
            -v_cost_amount,
            v_item.id,
            v_dispatch.dispatch_number,
            p_user_id
        );
    END LOOP;

    -- Update statuses atomically across Dispatch, Invoice, and Sales Order
    UPDATE dispatches SET status = 'dispatched' WHERE id = p_dispatch_id;
    UPDATE invoices SET status = 'dispatched' WHERE id = v_dispatch.invoice_id;
    UPDATE sales_orders SET status = 'dispatched' 
    WHERE id = (SELECT sales_order_id FROM invoices WHERE id = v_dispatch.invoice_id);
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 6. ATOMIC PAYMENT ALLOCATION WITH OVER-PAYMENT & MISMATCH GUARDS
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_allocate_payment(
    p_payment_id UUID,
    p_invoice_id UUID,
    p_amount NUMERIC,
    p_user_id UUID
)
RETURNS VOID AS $$
DECLARE
    v_pay RECORD;
    v_inv RECORD;
    v_allocated_so_far NUMERIC(12, 2);
    v_inv_paid_so_far NUMERIC(12, 2);
    v_inv_credit_so_far NUMERIC(12, 2);
BEGIN
    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Allocation Error: Amount must be positive.';
    END IF;

    -- Lock payment record
    SELECT * INTO v_pay 
    FROM payments 
    WHERE id = p_payment_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment % not found.', p_payment_id;
    END IF;

    -- Lock invoice record
    SELECT * INTO v_inv 
    FROM invoices 
    WHERE id = p_invoice_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invoice % not found.', p_invoice_id;
    END IF;

    -- 1. Prevent allocating across different customers
    IF v_pay.customer_id <> v_inv.customer_id THEN
        RAISE EXCEPTION 'Customer Mismatch: Invoice % belongs to customer %, but payment % is from customer %',
            v_inv.invoice_number, v_inv.customer_id, v_pay.receipt_number, v_pay.customer_id;
    END IF;

    -- 2. Guard against allocating more than the total payment amount
    SELECT COALESCE(SUM(allocated_amount), 0.00) 
    INTO v_allocated_so_far 
    FROM payment_allocations 
    WHERE payment_id = p_payment_id;

    IF (v_allocated_so_far + p_amount) > v_pay.total_amount THEN
        RAISE EXCEPTION 'Over-allocation Error: Total allocated (%) plus attempted (%) exceeds payment total (%)',
            v_allocated_so_far, p_amount, v_pay.total_amount;
    END IF;

    -- 3. Guard against overpaying the invoice (accounting for credit notes)
    SELECT COALESCE(SUM(allocated_amount), 0.00) 
    INTO v_inv_paid_so_far 
    FROM payment_allocations 
    WHERE invoice_id = p_invoice_id;

    SELECT COALESCE(SUM(total_credit_amount), 0.00) 
    INTO v_inv_credit_so_far 
    FROM credit_notes 
    WHERE invoice_id = p_invoice_id;

    IF (v_inv_paid_so_far + v_inv_credit_so_far + p_amount) > v_inv.total_invoice_value THEN
        RAISE EXCEPTION 'Invoice Overpayment: Invoice total is %, already settled %, attempted allocation is %',
            v_inv.total_invoice_value, (v_inv_paid_so_far + v_inv_credit_so_far), p_amount;
    END IF;

    -- 4. Insert allocation
    INSERT INTO payment_allocations (
        payment_id,
        invoice_id,
        allocated_amount,
        allocated_by
    ) VALUES (
        p_payment_id,
        p_invoice_id,
        p_amount,
        p_user_id
    );
END;
$$ LANGUAGE plpgsql;


-- ==========================================
-- database/migrations/005_views.sql
-- ==========================================
-- ============================================================================
-- ORDER-TO-AUDIT SYSTEM: DATABASE MIGRATION 005
-- Analytical Views: True Moving WAC Stock, Allocations & Statutory Reports
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. REAL-TIME CURRENT STOCK BALANCE & TRUE MOVING WAC VIEW
-- Uses item_stock_balances (maintained via transactional posting engine)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_current_stock AS
SELECT 
    i.id AS item_id,
    i.sku,
    i.name AS item_name,
    i.item_type,
    i.base_uom_id,
    i.packets_per_carton,
    COALESCE(sb.current_base_qty, 0.0000) AS closing_stock_base_qty,
    -- Equivalent cartons for finished goods based on product-specific conversion
    CASE 
        WHEN i.packets_per_carton > 1 AND i.item_type = 'finished_good'
        THEN ROUND(COALESCE(sb.current_base_qty, 0.0000) / i.packets_per_carton, 2)
        ELSE NULL
    END AS equivalent_cartons,
    -- Continuous Moving Weighted Average Cost (WAC)
    COALESCE(sb.current_moving_wac, i.standard_purchase_rate) AS current_moving_wac,
    COALESCE(sb.current_total_value, 0.00) AS total_stock_valuation,
    i.min_reorder_level,
    CASE 
        WHEN COALESCE(sb.current_base_qty, 0.0000) <= i.min_reorder_level 
        THEN true 
        ELSE false 
    END AS is_low_stock_alert,
    sb.last_transaction_timestamp
FROM items i
LEFT JOIN item_stock_balances sb ON i.id = sb.item_id;

-- ----------------------------------------------------------------------------
-- 2. AUDITOR STOCK LEDGER (Detailed Movement Register)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_stock_ledger AS
SELECT 
    l.id AS ledger_id,
    l.transaction_timestamp,
    i.sku,
    i.name AS item_name,
    i.item_type,
    l.movement_type,
    l.transaction_qty,
    l.transaction_uom_id,
    l.base_quantity_delta,
    i.base_uom_id,
    l.unit_cost,
    l.total_cost,
    l.source_reference_label,
    l.batch_number,
    l.expiry_date,
    u.full_name AS recorded_by_user
FROM inventory_ledger l
JOIN items i ON l.item_id = i.id
JOIN users u ON l.created_by = u.id
ORDER BY l.transaction_timestamp DESC, l.id DESC;

-- ----------------------------------------------------------------------------
-- 3. INVOICE BALANCES & PAYMENT STATUS DERIVED FROM ALLOCATIONS
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_invoice_balances AS
SELECT 
    inv.id AS invoice_id,
    inv.invoice_number,
    inv.financial_year,
    inv.invoice_date,
    p.id AS customer_id,
    p.trade_name AS customer_name,
    p.state_code AS customer_state_code,
    inv.place_of_supply_state_code,
    inv.is_interstate,
    inv.taxable_value,
    inv.cgst_amount,
    inv.sgst_amount,
    inv.igst_amount,
    inv.total_invoice_value,
    COALESCE(pa.total_allocated, 0.00) AS total_paid_amount,
    COALESCE(cn.total_credited, 0.00) AS total_credited_amount,
    ROUND(inv.total_invoice_value - COALESCE(pa.total_allocated, 0.00) - COALESCE(cn.total_credited, 0.00), 2) AS outstanding_balance,
    CASE 
        WHEN inv.status = 'cancelled' THEN 'cancelled'
        WHEN (inv.total_invoice_value - COALESCE(pa.total_allocated, 0.00) - COALESCE(cn.total_credited, 0.00)) <= 0 THEN 'paid'
        WHEN COALESCE(pa.total_allocated, 0.00) > 0 THEN 'partially_paid'
        ELSE 'unpaid'
    END AS derived_payment_status,
    inv.status AS invoice_status,
    inv.created_at
FROM invoices inv
JOIN parties p ON inv.customer_id = p.id
LEFT JOIN (
    SELECT invoice_id, SUM(allocated_amount) AS total_allocated
    FROM payment_allocations
    GROUP BY invoice_id
) pa ON inv.id = pa.invoice_id
LEFT JOIN (
    SELECT invoice_id, SUM(total_credit_amount) AS total_credited
    FROM credit_notes
    GROUP BY invoice_id
) cn ON inv.id = cn.invoice_id;

-- ----------------------------------------------------------------------------
-- 4. CUSTOMER RECEIVABLES & UNALLOCATED ADVANCES SUMMARY
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_customer_outstanding AS
SELECT 
    p.id AS customer_id,
    p.trade_name AS customer_name,
    p.state_name,
    p.phone,
    p.credit_limit,
    COALESCE(SUM(ib.total_invoice_value), 0.00) AS total_billed,
    COALESCE(SUM(ib.total_paid_amount), 0.00) AS total_allocated_to_invoices,
    COALESCE(pay_tot.total_payments, 0.00) AS total_payments_received,
    -- Any excess payment not yet allocated to an invoice is an on-account advance
    ROUND(COALESCE(pay_tot.total_payments, 0.00) - COALESCE(SUM(ib.total_paid_amount), 0.00), 2) AS unallocated_advances,
    COALESCE(SUM(ib.total_credited_amount), 0.00) AS total_credited,
    COALESCE(SUM(ib.outstanding_balance), 0.00) AS net_invoice_receivables,
    -- Statutory ageing buckets based on invoice date
    COALESCE(SUM(CASE WHEN CURRENT_DATE - ib.invoice_date <= 30 THEN ib.outstanding_balance ELSE 0 END), 0.00) AS ageing_0_to_30_days,
    COALESCE(SUM(CASE WHEN CURRENT_DATE - ib.invoice_date BETWEEN 31 AND 60 THEN ib.outstanding_balance ELSE 0 END), 0.00) AS ageing_31_to_60_days,
    COALESCE(SUM(CASE WHEN CURRENT_DATE - ib.invoice_date BETWEEN 61 AND 90 THEN ib.outstanding_balance ELSE 0 END), 0.00) AS ageing_61_to_90_days,
    COALESCE(SUM(CASE WHEN CURRENT_DATE - ib.invoice_date > 90 THEN ib.outstanding_balance ELSE 0 END), 0.00) AS ageing_over_90_days
FROM parties p
LEFT JOIN v_invoice_balances ib ON p.id = ib.customer_id AND ib.invoice_status <> 'cancelled'
LEFT JOIN (
    SELECT customer_id, SUM(total_amount) AS total_payments
    FROM payments
    GROUP BY customer_id
) pay_tot ON p.id = pay_tot.customer_id
WHERE p.party_type IN ('customer', 'both')
GROUP BY p.id, p.trade_name, p.state_name, p.phone, p.credit_limit, pay_tot.total_payments;

-- ----------------------------------------------------------------------------
-- 5. PRODUCTION VARIANCE & MASS BALANCE VIEW
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_production_variance AS
SELECT 
    pr.id AS production_run_id,
    pr.run_number,
    pr.run_date,
    fg.sku AS finished_good_sku,
    fg.name AS finished_good_name,
    b.bom_code,
    b.version_number AS bom_version,
    pr.planned_batch_count,
    pr.planned_yield_qty,
    pr.actual_good_output_qty,
    pr.actual_scrap_output_qty,
    pr.yield_variance_qty,
    pr.yield_variance_pct,
    pr.is_yield_flagged,
    i.name AS material_name,
    i.item_type AS material_type,
    r_in.planned_qty,
    r_in.actual_issued_qty,
    r_in.good_production_qty,
    r_in.damaged_or_scrap_qty,
    r_in.returned_to_store_qty,
    r_in.base_net_consumed_qty,
    r_in.consumption_variance_qty,
    r_in.consumption_variance_pct,
    r_in.is_consumption_flagged,
    r_in.unit_cost_applied,
    r_in.total_material_cost
FROM production_runs pr
JOIN boms b ON pr.bom_id = b.id
JOIN items fg ON pr.finished_good_item_id = fg.id
JOIN production_run_inputs r_in ON pr.id = r_in.production_run_id
JOIN items i ON r_in.item_id = i.id
ORDER BY pr.run_date DESC, pr.run_number, i.name;

-- ----------------------------------------------------------------------------
-- 6. GST OUTWARD SUPPLIES REGISTER (GSTR-1 / GSTR-3B Mapping)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_gst_outward_summary AS
SELECT 
    inv.financial_year,
    TO_CHAR(inv.invoice_date, 'YYYY-MM') AS tax_period,
    inv.place_of_supply_state_code,
    inv.is_interstate,
    ii.gst_rate_pct,
    COUNT(DISTINCT inv.id) AS invoice_count,
    SUM(ii.taxable_value) AS total_taxable_value,
    SUM(ii.cgst_amount) AS total_cgst,
    SUM(ii.sgst_amount) AS total_sgst,
    SUM(ii.igst_amount) AS total_igst,
    SUM(ii.total_item_value) AS total_gross_value
FROM invoices inv
JOIN invoice_items ii ON inv.id = ii.invoice_id
WHERE inv.status <> 'cancelled'
GROUP BY 
    inv.financial_year, 
    TO_CHAR(inv.invoice_date, 'YYYY-MM'), 
    inv.place_of_supply_state_code, 
    inv.is_interstate, 
    ii.gst_rate_pct
ORDER BY tax_period DESC, place_of_supply_state_code;


-- ==========================================
-- database/migrations/006_production_hardening_and_immutability.sql
-- ==========================================
-- ============================================================================
-- ORDER-TO-AUDIT SYSTEM: DATABASE MIGRATION 006
-- Production Hardening, Immutability Guards, Costing Accuracy & Audit Coverage
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. SCHEMA HARDENING FOR ZERO SELLING PRICE MARGINS
-- When standard selling price is zero or unassigned, gross margin percentage is undefined.
-- Allow NULL values instead of forcing division by zero or arbitrary numbers.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    ALTER TABLE production_run_costing ALTER COLUMN unit_gross_margin DROP NOT NULL;
    ALTER TABLE production_run_costing ALTER COLUMN gross_margin_pct DROP NOT NULL;
EXCEPTION
    WHEN OTHERS THEN
        NULL; -- Idempotent if already dropped
END $$;

-- ----------------------------------------------------------------------------
-- 2. HARDENED PRODUCTION YIELD POSTING FUNCTION
-- Fixes:
--   A. Dynamic finished goods base UOM instead of hardcoded 'PKT'
--   B. Inclusion of work_in_progress (WIP) in direct material costs
--   C. Safe zero selling price handling (prevents division by zero)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_post_production_yield(
    p_production_run_id UUID,
    p_user_id UUID
)
RETURNS VOID AS $$
DECLARE
    v_run RECORD;
    v_stock RECORD;
    v_raw_cost NUMERIC(12, 2) := 0.00;
    v_pkg_cost NUMERIC(12, 2) := 0.00;
    v_ovh_cost NUMERIC(12, 2) := 0.00;
    v_total_batch_cost NUMERIC(12, 2) := 0.00;
    v_cost_per_unit NUMERIC(12, 4);
    v_selling_price NUMERIC(12, 2);
    v_fg_base_uom VARCHAR(10);
    v_unit_margin NUMERIC(12, 2);
    v_margin_pct NUMERIC(5, 2);
    v_new_fg_qty NUMERIC(14, 4);
    v_new_fg_val NUMERIC(14, 2);
    v_new_fg_wac NUMERIC(12, 4);
BEGIN
    SELECT * INTO v_run 
    FROM production_runs 
    WHERE id = p_production_run_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Production run % not found.', p_production_run_id;
    END IF;

    IF v_run.status <> 'materials_issued' THEN
        RAISE EXCEPTION 'Sequence Error: Production run % must have materials issued before yield can be posted (current: "%")',
            v_run.run_number, v_run.status;
    END IF;

    IF v_run.actual_good_output_qty <= 0 THEN
        RAISE EXCEPTION 'Output Error: Actual good output quantity must be greater than zero.';
    END IF;

    -- Aggregate material costs: Include both raw_material and work_in_progress in direct materials!
    SELECT 
        COALESCE(SUM(CASE WHEN i.item_type IN ('raw_material', 'work_in_progress') THEN pri.total_material_cost ELSE 0 END), 0.00),
        COALESCE(SUM(CASE WHEN i.item_type = 'packaging' THEN pri.total_material_cost ELSE 0 END), 0.00)
    INTO v_raw_cost, v_pkg_cost
    FROM production_run_inputs pri
    JOIN items i ON pri.item_id = i.id
    WHERE pri.production_run_id = p_production_run_id;

    -- Aggregate overhead costs
    SELECT COALESCE(SUM(amount), 0.00) 
    INTO v_ovh_cost 
    FROM production_run_overheads 
    WHERE production_run_id = p_production_run_id;

    v_total_batch_cost := v_raw_cost + v_pkg_cost + v_ovh_cost;
    v_cost_per_unit := ROUND(v_total_batch_cost / v_run.actual_good_output_qty, 4);

    -- Retrieve finished good's actual base UOM and standard selling price
    SELECT base_uom_id, standard_selling_price 
    INTO v_fg_base_uom, v_selling_price 
    FROM items 
    WHERE id = v_run.finished_good_item_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Finished good item % not found.', v_run.finished_good_item_id;
    END IF;

    -- Zero selling price handling:
    -- If selling price > 0, calculate standard margin.
    -- If selling price = 0 or NULL, avoid division by zero; return NULL for undefined margin.
    IF v_selling_price IS NOT NULL AND v_selling_price > 0 THEN
        v_unit_margin := ROUND(v_selling_price - v_cost_per_unit, 2);
        v_margin_pct := ROUND(((v_selling_price - v_cost_per_unit) / v_selling_price) * 100.0, 2);
    ELSE
        v_unit_margin := NULL;
        v_margin_pct := NULL;
    END IF;

    -- Upsert batch costing record
    INSERT INTO production_run_costing (
        production_run_id,
        total_raw_material_cost,
        total_packaging_cost,
        total_direct_overhead_cost,
        gross_total_batch_cost,
        good_output_units,
        cost_per_packet,
        selling_price_per_packet,
        unit_gross_margin,
        gross_margin_pct,
        valuation_method_used
    ) VALUES (
        p_production_run_id,
        v_raw_cost,
        v_pkg_cost,
        v_ovh_cost,
        v_total_batch_cost,
        v_run.actual_good_output_qty,
        v_cost_per_unit,
        COALESCE(v_selling_price, 0.00),
        v_unit_margin,
        v_margin_pct,
        'WEIGHTED_AVERAGE'
    ) ON CONFLICT (production_run_id) DO UPDATE SET
        total_raw_material_cost = EXCLUDED.total_raw_material_cost,
        total_packaging_cost = EXCLUDED.total_packaging_cost,
        total_direct_overhead_cost = EXCLUDED.total_direct_overhead_cost,
        gross_total_batch_cost = EXCLUDED.gross_total_batch_cost,
        good_output_units = EXCLUDED.good_output_units,
        cost_per_packet = EXCLUDED.cost_per_packet,
        selling_price_per_packet = EXCLUDED.selling_price_per_packet,
        unit_gross_margin = EXCLUDED.unit_gross_margin,
        gross_margin_pct = EXCLUDED.gross_margin_pct;

    -- CONCURRENCY SAFEGUARD:
    -- Lock parent item record first for the finished good item
    PERFORM 1 FROM items WHERE id = v_run.finished_good_item_id FOR UPDATE;

    INSERT INTO item_stock_balances (item_id, current_base_qty, current_moving_wac, current_total_value)
    VALUES (v_run.finished_good_item_id, 0.0000, 0.0000, 0.00)
    ON CONFLICT (item_id) DO NOTHING;

    SELECT * INTO v_stock 
    FROM item_stock_balances 
    WHERE item_id = v_run.finished_good_item_id 
    FOR UPDATE;

    -- Moving WAC across opening finished goods stock and newly produced batch
    v_new_fg_qty := v_stock.current_base_qty + v_run.actual_good_output_qty;
    v_new_fg_val := ROUND(v_stock.current_total_value + v_total_batch_cost, 2);
    
    IF v_new_fg_qty > 0 THEN
        v_new_fg_wac := ROUND(v_new_fg_val / v_new_fg_qty, 4);
    ELSE
        v_new_fg_wac := v_cost_per_unit;
    END IF;

    UPDATE item_stock_balances 
    SET current_base_qty = v_new_fg_qty,
        current_moving_wac = v_new_fg_wac,
        current_total_value = v_new_fg_val,
        last_transaction_timestamp = NOW(),
        updated_at = NOW()
    WHERE item_id = v_run.finished_good_item_id;

    -- Record finished goods receipt in inventory ledger using the finished good's actual base UOM (v_fg_base_uom)
    INSERT INTO inventory_ledger (
        transaction_timestamp,
        item_id,
        batch_number,
        movement_type,
        transaction_qty,
        transaction_uom_id,
        base_quantity_delta,
        unit_cost,
        total_cost,
        production_run_yield_id,
        source_reference_label,
        created_by
    ) VALUES (
        NOW(),
        v_run.finished_good_item_id,
        v_run.output_batch_number,
        'PRODUCTION_YIELD',
        v_run.actual_good_output_qty,
        v_fg_base_uom,
        v_run.actual_good_output_qty,
        v_cost_per_unit,
        v_total_batch_cost,
        v_run.id,
        v_run.run_number,
        p_user_id
    );

    UPDATE production_runs 
    SET status = 'completed' 
    WHERE id = p_production_run_id;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 3. PRODUCTION IMMUTABILITY ENFORCERS
-- Protect completed production runs, inputs, overheads, and costing from historical alteration
-- ----------------------------------------------------------------------------

-- A. Production Runs Header Immutability
CREATE OR REPLACE FUNCTION fn_prevent_completed_production_modification()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.status IN ('completed', 'materials_issued') THEN
            RAISE EXCEPTION 'Integrity Violation: Cannot delete production run % in status "%" as inventory movements have been posted.',
                OLD.run_number, OLD.status;
        END IF;
        RETURN OLD;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF OLD.status = 'completed' THEN
            RAISE EXCEPTION 'Integrity Violation: Production run % is completed and immutable. Modifications are prohibited.',
                OLD.run_number;
        END IF;

        IF OLD.status = 'materials_issued' AND NEW.status NOT IN ('materials_issued', 'completed') THEN
            RAISE EXCEPTION 'Integrity Violation: Cannot revert production run % from "materials_issued" to "%".',
                OLD.run_number, NEW.status;
        END IF;

        RETURN NEW;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_completed_production_delete ON production_runs;
DROP TRIGGER IF EXISTS trg_prevent_completed_production_modify ON production_runs;
CREATE TRIGGER trg_prevent_completed_production_modify
BEFORE UPDATE OR DELETE ON production_runs
FOR EACH ROW
EXECUTE FUNCTION fn_prevent_completed_production_modification();

-- B. Production Inputs Immutability
CREATE OR REPLACE FUNCTION fn_prevent_posted_production_input_modification()
RETURNS TRIGGER AS $$
DECLARE
    v_run_status VARCHAR(20);
    v_run_number VARCHAR(50);
    v_target_run_id UUID;
BEGIN
    v_target_run_id := COALESCE(OLD.production_run_id, NEW.production_run_id);
    SELECT status, run_number INTO v_run_status, v_run_number 
    FROM production_runs 
    WHERE id = v_target_run_id;

    IF v_run_status IN ('materials_issued', 'completed') THEN
        RAISE EXCEPTION 'Integrity Violation: Cannot % production input for production run % in status "%". Historical input records are immutable.',
            TG_OP, v_run_number, v_run_status;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_posted_production_input_modify ON production_run_inputs;
CREATE TRIGGER trg_prevent_posted_production_input_modify
BEFORE UPDATE OR DELETE ON production_run_inputs
FOR EACH ROW
EXECUTE FUNCTION fn_prevent_posted_production_input_modification();

-- C. Production Overheads Immutability
CREATE OR REPLACE FUNCTION fn_prevent_posted_production_overhead_modification()
RETURNS TRIGGER AS $$
DECLARE
    v_run_status VARCHAR(20);
    v_run_number VARCHAR(50);
    v_target_run_id UUID;
BEGIN
    v_target_run_id := COALESCE(OLD.production_run_id, NEW.production_run_id);
    SELECT status, run_number INTO v_run_status, v_run_number 
    FROM production_runs 
    WHERE id = v_target_run_id;

    IF v_run_status = 'completed' THEN
        RAISE EXCEPTION 'Integrity Violation: Cannot % production overhead for completed production run %. Overhead records are immutable.',
            TG_OP, v_run_number;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_posted_production_overhead_modify ON production_run_overheads;
CREATE TRIGGER trg_prevent_posted_production_overhead_modify
BEFORE UPDATE OR DELETE ON production_run_overheads
FOR EACH ROW
EXECUTE FUNCTION fn_prevent_posted_production_overhead_modification();

-- D. Production Run Costing Immutability
CREATE OR REPLACE FUNCTION fn_prevent_completed_costing_modification()
RETURNS TRIGGER AS $$
DECLARE
    v_run_status VARCHAR(20);
    v_run_number VARCHAR(50);
BEGIN
    SELECT status, run_number INTO v_run_status, v_run_number 
    FROM production_runs 
    WHERE id = COALESCE(OLD.production_run_id, NEW.production_run_id);

    IF v_run_status = 'completed' THEN
        RAISE EXCEPTION 'Integrity Violation: Cannot % batch costing for completed production run %. Historical costing is immutable.',
            TG_OP, v_run_number;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_completed_costing_modify ON production_run_costing;
CREATE TRIGGER trg_prevent_completed_costing_modify
BEFORE UPDATE OR DELETE ON production_run_costing
FOR EACH ROW
EXECUTE FUNCTION fn_prevent_completed_costing_modification();

-- ----------------------------------------------------------------------------
-- 4. EXTENDED AUDIT TRAIL LOGGING FUNCTION & TRIGGERS
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_log_entity_audit_trail()
RETURNS TRIGGER AS $$
DECLARE
    v_user_id UUID;
    v_entity_id VARCHAR(64);
    v_session_user VARCHAR(64);
    v_old_values JSONB;
    v_new_values JSONB;
BEGIN
    -- 1. Try to read application session user context
    v_session_user := current_setting('app.current_user_id', true);
    IF v_session_user IS NOT NULL AND v_session_user <> '' THEN
        BEGIN
            v_user_id := v_session_user::UUID;
        EXCEPTION WHEN OTHERS THEN
            v_user_id := NULL;
        END;
    END IF;

    -- 2. Fall back to document-level actor field if session context is absent
    IF v_user_id IS NULL THEN
        IF TG_OP = 'DELETE' THEN
            IF TG_TABLE_NAME = 'production_run_costing' THEN
                v_entity_id := OLD.production_run_id::TEXT;
            ELSE
                v_entity_id := OLD.id::TEXT;
            END IF;
        ELSE
            IF TG_TABLE_NAME = 'production_run_costing' THEN
                v_entity_id := NEW.production_run_id::TEXT;
            ELSE
                v_entity_id := NEW.id::TEXT;
            END IF;

            -- Check for known actor columns
            IF TG_TABLE_NAME = 'invoices' THEN
                v_user_id := NEW.approved_by;
            ELSIF TG_TABLE_NAME = 'production_runs' THEN
                v_user_id := NEW.supervisor_id;
            ELSIF TG_TABLE_NAME = 'production_run_inputs' THEN
                SELECT supervisor_id INTO v_user_id FROM production_runs WHERE id = NEW.production_run_id;
            ELSIF TG_TABLE_NAME = 'production_run_overheads' THEN
                SELECT supervisor_id INTO v_user_id FROM production_runs WHERE id = NEW.production_run_id;
            ELSIF TG_TABLE_NAME = 'production_run_costing' THEN
                SELECT supervisor_id INTO v_user_id FROM production_runs WHERE id = NEW.production_run_id;
            ELSIF TG_TABLE_NAME = 'purchase_bills' THEN
                v_user_id := NEW.received_by;
            ELSIF TG_TABLE_NAME = 'payments' THEN
                v_user_id := NEW.recorded_by;
            ELSIF TG_TABLE_NAME = 'payment_allocations' THEN
                v_user_id := NEW.allocated_by;
            ELSIF TG_TABLE_NAME = 'credit_notes' THEN
                v_user_id := NEW.approved_by;
            END IF;
        END IF;
    ELSE
        IF TG_OP = 'DELETE' THEN
            IF TG_TABLE_NAME = 'production_run_costing' THEN
                v_entity_id := OLD.production_run_id::TEXT;
            ELSE
                v_entity_id := OLD.id::TEXT;
            END IF;
        ELSE
            IF TG_TABLE_NAME = 'production_run_costing' THEN
                v_entity_id := NEW.production_run_id::TEXT;
            ELSE
                v_entity_id := NEW.id::TEXT;
            END IF;
        END IF;
    END IF;

    -- Prepare old and new JSON values
    v_old_values := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END;
    v_new_values := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END;

    -- Redact sensitive user credentials (passwords) from audit logs
    IF TG_TABLE_NAME = 'users' THEN
        IF v_old_values ? 'password_hash' THEN
            v_old_values := v_old_values - 'password_hash' || '{"password_hash": "[REDACTED]"}'::JSONB;
        END IF;
        IF v_new_values ? 'password_hash' THEN
            v_new_values := v_new_values - 'password_hash' || '{"password_hash": "[REDACTED]"}'::JSONB;
        END IF;
    END IF;

    -- 3. Record audit trail entry
    INSERT INTO audit_logs (
        user_id,
        action,
        entity_name,
        entity_id,
        old_values,
        new_values
    ) VALUES (
        v_user_id,
        TG_OP || '_' || UPPER(TG_TABLE_NAME),
        TG_TABLE_NAME,
        v_entity_id,
        v_old_values,
        v_new_values
    );

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Attach audit triggers to production tables
DROP TRIGGER IF EXISTS trg_audit_production_run_inputs ON production_run_inputs;
CREATE TRIGGER trg_audit_production_run_inputs
AFTER INSERT OR UPDATE OR DELETE ON production_run_inputs
FOR EACH ROW
EXECUTE FUNCTION fn_log_entity_audit_trail();

DROP TRIGGER IF EXISTS trg_audit_production_run_overheads ON production_run_overheads;
CREATE TRIGGER trg_audit_production_run_overheads
AFTER INSERT OR UPDATE OR DELETE ON production_run_overheads
FOR EACH ROW
EXECUTE FUNCTION fn_log_entity_audit_trail();

DROP TRIGGER IF EXISTS trg_audit_production_run_costing ON production_run_costing;
CREATE TRIGGER trg_audit_production_run_costing
AFTER INSERT OR UPDATE OR DELETE ON production_run_costing
FOR EACH ROW
EXECUTE FUNCTION fn_log_entity_audit_trail();

DROP TRIGGER IF EXISTS trg_audit_users ON users;
CREATE TRIGGER trg_audit_users
AFTER INSERT OR UPDATE OR DELETE ON users
FOR EACH ROW
EXECUTE FUNCTION fn_log_entity_audit_trail();


-- ==========================================
-- database/migrations/007_purchases_and_inventory_hardening.sql
-- ==========================================
-- ============================================================================
-- ORDER-TO-AUDIT SYSTEM: DATABASE MIGRATION 007
-- Purchases Immutability Enforcers & Inventory Hardening
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. PURCHASE BILLS IMMUTABILITY TRIGGER
-- Prevents updating or deleting received purchase bills, and prevents reverting status.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_prevent_received_purchase_modification()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.status = 'received' THEN
            RAISE EXCEPTION 'Integrity Violation: Cannot delete received purchase bill % as inventory has already been posted.',
                OLD.bill_number;
        END IF;
        RETURN OLD;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        -- If already received, prevent modifying financial/inventory data or reverting status
        IF OLD.status = 'received' THEN
            IF NEW.status <> 'received' THEN
                RAISE EXCEPTION 'Integrity Violation: Cannot revert received purchase bill % to "%".',
                    OLD.bill_number, NEW.status;
            END IF;

            IF NEW.supplier_id <> OLD.supplier_id OR
               NEW.bill_number <> OLD.bill_number OR
               NEW.bill_date <> OLD.bill_date OR
               NEW.subtotal_amount <> OLD.subtotal_amount OR
               NEW.cgst_amount <> OLD.cgst_amount OR
               NEW.sgst_amount <> OLD.sgst_amount OR
               NEW.igst_amount <> OLD.igst_amount OR
               NEW.total_amount <> OLD.total_amount THEN
                RAISE EXCEPTION 'Integrity Violation: Purchase bill % is already received. Modifying financial values or items is prohibited.',
                    OLD.bill_number;
            END IF;
        END IF;

        -- If cancelled, prevent re-opening
        IF OLD.status = 'cancelled' AND NEW.status <> 'cancelled' THEN
            RAISE EXCEPTION 'Integrity Violation: Cannot re-open cancelled purchase bill %.',
                OLD.bill_number;
        END IF;

        RETURN NEW;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_received_purchase_delete ON purchase_bills;
DROP TRIGGER IF EXISTS trg_prevent_received_purchase_modify ON purchase_bills;
CREATE TRIGGER trg_prevent_received_purchase_modify
BEFORE UPDATE OR DELETE ON purchase_bills
FOR EACH ROW
EXECUTE FUNCTION fn_prevent_received_purchase_modification();

-- ----------------------------------------------------------------------------
-- 2. PURCHASE BILL ITEMS IMMUTABILITY TRIGGER
-- Prevents INSERT, UPDATE, or DELETE on purchase bill line items once the bill is received.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_prevent_received_purchase_item_modification()
RETURNS TRIGGER AS $$
DECLARE
    v_bill_status VARCHAR(20);
    v_bill_number VARCHAR(50);
    v_target_bill_id UUID;
BEGIN
    v_target_bill_id := COALESCE(OLD.purchase_bill_id, NEW.purchase_bill_id);
    SELECT status, bill_number INTO v_bill_status, v_bill_number
    FROM purchase_bills
    WHERE id = v_target_bill_id;

    IF v_bill_status = 'received' THEN
        RAISE EXCEPTION 'Integrity Violation: Cannot % line item for received purchase bill %. Historical purchase items are immutable.',
            TG_OP, v_bill_number;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_received_purchase_item_modify ON purchase_bill_items;
CREATE TRIGGER trg_prevent_received_purchase_item_modify
BEFORE INSERT OR UPDATE OR DELETE ON purchase_bill_items
FOR EACH ROW
EXECUTE FUNCTION fn_prevent_received_purchase_item_modification();

-- ----------------------------------------------------------------------------
-- 3. AUDIT TRIGGER FOR PURCHASE BILL ITEMS
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_audit_purchase_bill_items ON purchase_bill_items;
CREATE TRIGGER trg_audit_purchase_bill_items
AFTER INSERT OR UPDATE OR DELETE ON purchase_bill_items
FOR EACH ROW
EXECUTE FUNCTION fn_log_entity_audit_trail();


-- ==========================================
-- database/migrations/008_sales_dispatch_invoicing_hardening.sql
-- ==========================================
-- ============================================================================
-- MIGRATION 008: SALES, DISPATCH & INVOICING HARDENING & AUDIT TRAIL
-- Immutability triggers and statutory audit trail logging for sales transactions
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. SALES ORDER IMMUTABILITY ENFORCERS
-- ----------------------------------------------------------------------------

-- A. Prevent modification or deletion of invoiced or dispatched sales orders
CREATE OR REPLACE FUNCTION fn_prevent_invoiced_or_dispatched_so_modification()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.status IN ('invoiced', 'dispatched') THEN
            RAISE EXCEPTION 'Integrity Violation: Cannot delete sales order % in status "%" as commercial or dispatch commitments exist.',
                OLD.order_number, OLD.status;
        END IF;
        RETURN OLD;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF OLD.status = 'dispatched' AND NEW.status <> 'dispatched' THEN
            RAISE EXCEPTION 'Integrity Violation: Sales order % is dispatched and immutable. Status cannot be changed from "dispatched" to "%".',
                OLD.order_number, NEW.status;
        END IF;

        IF OLD.status = 'invoiced' AND NEW.status NOT IN ('invoiced', 'dispatched', 'cancelled', 'approved') THEN
            RAISE EXCEPTION 'Integrity Violation: Cannot revert invoiced sales order % to status "%".',
                OLD.order_number, NEW.status;
        END IF;

        RETURN NEW;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_invoiced_or_dispatched_so_modify ON sales_orders;
CREATE TRIGGER trg_prevent_invoiced_or_dispatched_so_modify
BEFORE UPDATE OR DELETE ON sales_orders
FOR EACH ROW
EXECUTE FUNCTION fn_prevent_invoiced_or_dispatched_so_modification();

-- B. Prevent modification of line items on invoiced or dispatched sales orders
CREATE OR REPLACE FUNCTION fn_prevent_invoiced_or_dispatched_so_item_modification()
RETURNS TRIGGER AS $$
DECLARE
    v_order_status VARCHAR(20);
    v_order_number VARCHAR(50);
    v_target_order_id UUID;
BEGIN
    v_target_order_id := COALESCE(OLD.sales_order_id, NEW.sales_order_id);
    SELECT status, order_number INTO v_order_status, v_order_number
    FROM sales_orders
    WHERE id = v_target_order_id;

    IF v_order_status IN ('invoiced', 'dispatched') THEN
        RAISE EXCEPTION 'Integrity Violation: Cannot % line item for sales order % in status "%". Invoiced and dispatched order items are immutable.',
            TG_OP, v_order_number, v_order_status;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_invoiced_or_dispatched_so_item_modify ON sales_order_items;
CREATE TRIGGER trg_prevent_invoiced_or_dispatched_so_item_modify
BEFORE INSERT OR UPDATE OR DELETE ON sales_order_items
FOR EACH ROW
EXECUTE FUNCTION fn_prevent_invoiced_or_dispatched_so_item_modification();

-- ----------------------------------------------------------------------------
-- 2. INVOICE FINANCIAL IMMUTABILITY ENFORCERS
-- ----------------------------------------------------------------------------

-- A. Prevent alteration of financial amounts on posted/dispatched invoices
CREATE OR REPLACE FUNCTION fn_prevent_posted_invoice_modification()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.status IN ('posted', 'dispatched') THEN
            RAISE EXCEPTION 'Statutory Audit Violation: Cannot delete invoice % with status "%". Cancel using a Credit Note.',
                OLD.invoice_number, OLD.status;
        END IF;
        RETURN OLD;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF OLD.status = 'dispatched' AND NEW.status NOT IN ('dispatched', 'cancelled') THEN
            RAISE EXCEPTION 'Integrity Violation: Dispatched invoice % is immutable. Cannot revert status to "%".',
                OLD.invoice_number, NEW.status;
        END IF;

        IF OLD.status IN ('posted', 'dispatched') THEN
            -- Check for modification of financial invariants
            IF OLD.taxable_value <> NEW.taxable_value OR
               OLD.cgst_amount <> NEW.cgst_amount OR
               OLD.sgst_amount <> NEW.sgst_amount OR
               OLD.igst_amount <> NEW.igst_amount OR
               OLD.total_invoice_value <> NEW.total_invoice_value OR
               OLD.customer_id <> NEW.customer_id OR
               OLD.place_of_supply_state_code <> NEW.place_of_supply_state_code THEN
                RAISE EXCEPTION 'Statutory Audit Violation: Cannot modify financial terms of invoice % in status "%". Issue a Credit Note to adjust.',
                    OLD.invoice_number, OLD.status;
            END IF;
        END IF;

        RETURN NEW;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_posted_invoice_modify ON invoices;
CREATE TRIGGER trg_prevent_posted_invoice_modify
BEFORE UPDATE OR DELETE ON invoices
FOR EACH ROW
EXECUTE FUNCTION fn_prevent_posted_invoice_modification();

-- B. Prevent modification of line items on posted or dispatched invoices
CREATE OR REPLACE FUNCTION fn_prevent_posted_invoice_item_modification()
RETURNS TRIGGER AS $$
DECLARE
    v_inv_status VARCHAR(20);
    v_inv_number VARCHAR(50);
    v_target_inv_id UUID;
BEGIN
    v_target_inv_id := COALESCE(OLD.invoice_id, NEW.invoice_id);
    SELECT status, invoice_number INTO v_inv_status, v_inv_number
    FROM invoices
    WHERE id = v_target_inv_id;

    IF v_inv_status IN ('posted', 'dispatched') THEN
        RAISE EXCEPTION 'Statutory Audit Violation: Cannot % line item for invoice % in status "%". Line items of posted/dispatched invoices are immutable.',
            TG_OP, v_inv_number, v_inv_status;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_posted_invoice_item_modify ON invoice_items;
CREATE TRIGGER trg_prevent_posted_invoice_item_modify
BEFORE INSERT OR UPDATE OR DELETE ON invoice_items
FOR EACH ROW
EXECUTE FUNCTION fn_prevent_posted_invoice_item_modification();

-- ----------------------------------------------------------------------------
-- 3. DISPATCH IMMUTABILITY ENFORCERS
-- ----------------------------------------------------------------------------

-- A. Prevent modification or deletion of posted dispatches
CREATE OR REPLACE FUNCTION fn_prevent_dispatched_record_modification()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.status IN ('dispatched', 'delivered') THEN
            RAISE EXCEPTION 'Integrity Violation: Cannot delete dispatch % in status "%" as stock movements have been posted.',
                OLD.dispatch_number, OLD.status;
        END IF;
        RETURN OLD;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF OLD.status IN ('dispatched', 'delivered') AND NEW.status = 'ready' THEN
            RAISE EXCEPTION 'Integrity Violation: Cannot revert dispatch % from "%" back to "ready".',
                OLD.dispatch_number, OLD.status;
        END IF;
        RETURN NEW;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_dispatched_record_modify ON dispatches;
CREATE TRIGGER trg_prevent_dispatched_record_modify
BEFORE UPDATE OR DELETE ON dispatches
FOR EACH ROW
EXECUTE FUNCTION fn_prevent_dispatched_record_modification();

-- B. Prevent modification of items on posted dispatches
CREATE OR REPLACE FUNCTION fn_prevent_dispatched_item_modification()
RETURNS TRIGGER AS $$
DECLARE
    v_dsp_status VARCHAR(20);
    v_dsp_number VARCHAR(50);
    v_target_dsp_id UUID;
BEGIN
    v_target_dsp_id := COALESCE(OLD.dispatch_id, NEW.dispatch_id);
    SELECT status, dispatch_number INTO v_dsp_status, v_dsp_number
    FROM dispatches
    WHERE id = v_target_dsp_id;

    IF v_dsp_status IN ('dispatched', 'delivered') THEN
        RAISE EXCEPTION 'Integrity Violation: Cannot % line item for dispatch % in status "%". Dispatched items are immutable.',
            TG_OP, v_dsp_number, v_dsp_status;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_dispatched_item_modify ON dispatch_items;
CREATE TRIGGER trg_prevent_dispatched_item_modify
BEFORE INSERT OR UPDATE OR DELETE ON dispatch_items
FOR EACH ROW
EXECUTE FUNCTION fn_prevent_dispatched_item_modification();

-- ----------------------------------------------------------------------------
-- 4. STATUTORY AUDIT TRAIL LOGGING ENHANCEMENTS
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_log_entity_audit_trail()
RETURNS TRIGGER AS $$
DECLARE
    v_user_id UUID;
    v_entity_id VARCHAR(64);
    v_session_user VARCHAR(64);
    v_old_values JSONB;
    v_new_values JSONB;
BEGIN
    -- 1. Try to read application session user context
    v_session_user := current_setting('app.current_user_id', true);
    IF v_session_user IS NOT NULL AND v_session_user <> '' THEN
        BEGIN
            v_user_id := v_session_user::UUID;
        EXCEPTION WHEN OTHERS THEN
            v_user_id := NULL;
        END;
    END IF;

    -- 2. Fall back to document-level actor field if session context is absent
    IF v_user_id IS NULL THEN
        IF TG_OP = 'DELETE' THEN
            IF TG_TABLE_NAME = 'production_run_costing' THEN
                v_entity_id := OLD.production_run_id::TEXT;
            ELSE
                v_entity_id := OLD.id::TEXT;
            END IF;
        ELSE
            IF TG_TABLE_NAME = 'production_run_costing' THEN
                v_entity_id := NEW.production_run_id::TEXT;
            ELSE
                v_entity_id := NEW.id::TEXT;
            END IF;

            -- Check for known actor columns
            IF TG_TABLE_NAME = 'invoices' THEN
                v_user_id := NEW.approved_by;
            ELSIF TG_TABLE_NAME = 'invoice_items' THEN
                SELECT approved_by INTO v_user_id FROM invoices WHERE id = NEW.invoice_id;
            ELSIF TG_TABLE_NAME = 'sales_orders' THEN
                v_user_id := NEW.salesman_id;
            ELSIF TG_TABLE_NAME = 'sales_order_items' THEN
                SELECT salesman_id INTO v_user_id FROM sales_orders WHERE id = NEW.sales_order_id;
            ELSIF TG_TABLE_NAME = 'dispatches' THEN
                v_user_id := NEW.dispatched_by;
            ELSIF TG_TABLE_NAME = 'dispatch_items' THEN
                SELECT dispatched_by INTO v_user_id FROM dispatches WHERE id = NEW.dispatch_id;
            ELSIF TG_TABLE_NAME = 'production_runs' THEN
                v_user_id := NEW.supervisor_id;
            ELSIF TG_TABLE_NAME = 'production_run_inputs' THEN
                SELECT supervisor_id INTO v_user_id FROM production_runs WHERE id = NEW.production_run_id;
            ELSIF TG_TABLE_NAME = 'production_run_overheads' THEN
                SELECT supervisor_id INTO v_user_id FROM production_runs WHERE id = NEW.production_run_id;
            ELSIF TG_TABLE_NAME = 'production_run_costing' THEN
                SELECT supervisor_id INTO v_user_id FROM production_runs WHERE id = NEW.production_run_id;
            ELSIF TG_TABLE_NAME = 'purchase_bills' THEN
                v_user_id := NEW.received_by;
            ELSIF TG_TABLE_NAME = 'purchase_bill_items' THEN
                SELECT received_by INTO v_user_id FROM purchase_bills WHERE id = NEW.purchase_bill_id;
            ELSIF TG_TABLE_NAME = 'payments' THEN
                v_user_id := NEW.recorded_by;
            ELSIF TG_TABLE_NAME = 'payment_allocations' THEN
                v_user_id := NEW.allocated_by;
            ELSIF TG_TABLE_NAME = 'credit_notes' THEN
                v_user_id := NEW.approved_by;
            END IF;
        END IF;
    ELSE
        IF TG_OP = 'DELETE' THEN
            IF TG_TABLE_NAME = 'production_run_costing' THEN
                v_entity_id := OLD.production_run_id::TEXT;
            ELSE
                v_entity_id := OLD.id::TEXT;
            END IF;
        ELSE
            IF TG_TABLE_NAME = 'production_run_costing' THEN
                v_entity_id := NEW.production_run_id::TEXT;
            ELSE
                v_entity_id := NEW.id::TEXT;
            END IF;
        END IF;
    END IF;

    -- Prepare old and new JSON values
    v_old_values := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END;
    v_new_values := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END;

    -- Redact sensitive user credentials (passwords) from audit logs
    IF TG_TABLE_NAME = 'users' THEN
        IF v_old_values ? 'password_hash' THEN
            v_old_values := v_old_values - 'password_hash' || '{"password_hash": "[REDACTED]"}'::JSONB;
        END IF;
        IF v_new_values ? 'password_hash' THEN
            v_new_values := v_new_values - 'password_hash' || '{"password_hash": "[REDACTED]"}'::JSONB;
        END IF;
    END IF;

    -- Fallback to factory owner if actor cannot be determined
    IF v_user_id IS NULL THEN
        SELECT id INTO v_user_id FROM users WHERE role = 'owner' LIMIT 1;
    END IF;

    INSERT INTO audit_logs (
        created_at,
        user_id,
        action,
        entity_name,
        entity_id,
        old_values,
        new_values
    ) VALUES (
        NOW(),
        v_user_id,
        TG_OP || '_' || UPPER(TG_TABLE_NAME),
        TG_TABLE_NAME,
        v_entity_id,
        v_old_values,
        v_new_values
    );

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Attach audit triggers
DROP TRIGGER IF EXISTS trg_audit_sales_orders ON sales_orders;
CREATE TRIGGER trg_audit_sales_orders
AFTER INSERT OR UPDATE OR DELETE ON sales_orders
FOR EACH ROW
EXECUTE FUNCTION fn_log_entity_audit_trail();

DROP TRIGGER IF EXISTS trg_audit_sales_order_items ON sales_order_items;
CREATE TRIGGER trg_audit_sales_order_items
AFTER INSERT OR UPDATE OR DELETE ON sales_order_items
FOR EACH ROW
EXECUTE FUNCTION fn_log_entity_audit_trail();

DROP TRIGGER IF EXISTS trg_audit_invoice_items ON invoice_items;
CREATE TRIGGER trg_audit_invoice_items
AFTER INSERT OR UPDATE OR DELETE ON invoice_items
FOR EACH ROW
EXECUTE FUNCTION fn_log_entity_audit_trail();

DROP TRIGGER IF EXISTS trg_audit_dispatches ON dispatches;
CREATE TRIGGER trg_audit_dispatches
AFTER INSERT OR UPDATE OR DELETE ON dispatches
FOR EACH ROW
EXECUTE FUNCTION fn_log_entity_audit_trail();

DROP TRIGGER IF EXISTS trg_audit_dispatch_items ON dispatch_items;
CREATE TRIGGER trg_audit_dispatch_items
AFTER INSERT OR UPDATE OR DELETE ON dispatch_items
FOR EACH ROW
EXECUTE FUNCTION fn_log_entity_audit_trail();


-- ==========================================
-- database/migrations/009_payments_receivables_hardening.sql
-- ==========================================
-- ============================================================================
-- ORDER-TO-AUDIT SYSTEM: MIGRATION 009
-- PHASE 8: PAYMENT MANAGEMENT, ALLOCATIONS & RECEIVABLES HARDENING
-- ============================================================================
-- 1. Enhances `payments` table with status lifecycle, bank details, and reversal tracking.
-- 2. Enhances `payment_allocations` table with status lifecycle and reversal tracking.
-- 3. Updates views `v_invoice_balances` and `v_customer_outstanding` to respect active/posted statuses.
-- 4. Enhances `fn_allocate_payment` with invoice validation and concurrency locks.
-- 5. Introduces `fn_reverse_payment` and `fn_unallocate_payment` for atomic financial reversals.
-- 6. Enforces database-level immutability triggers on posted payments and allocations.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. ENHANCE PAYMENTS TABLE
-- ----------------------------------------------------------------------------

-- Add status column (default 'posted' so existing benchmark REC-2026-0001 is posted)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'payments' AND column_name = 'status'
    ) THEN
        ALTER TABLE payments 
        ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'posted' 
        CHECK (status IN ('draft', 'posted', 'cancelled', 'reversed'));
    END IF;
END $$;

-- Add bank details columns
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'payments' AND column_name = 'bank_name'
    ) THEN
        ALTER TABLE payments ADD COLUMN bank_name VARCHAR(100);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'payments' AND column_name = 'bank_branch'
    ) THEN
        ALTER TABLE payments ADD COLUMN bank_branch VARCHAR(100);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'payments' AND column_name = 'cheque_number'
    ) THEN
        ALTER TABLE payments ADD COLUMN cheque_number VARCHAR(50);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'payments' AND column_name = 'cheque_date'
    ) THEN
        ALTER TABLE payments ADD COLUMN cheque_date DATE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'payments' AND column_name = 'reversed_at'
    ) THEN
        ALTER TABLE payments ADD COLUMN reversed_at TIMESTAMPTZ;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'payments' AND column_name = 'reversed_by'
    ) THEN
        ALTER TABLE payments ADD COLUMN reversed_by UUID REFERENCES users(id) ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'payments' AND column_name = 'reversal_reason'
    ) THEN
        ALTER TABLE payments ADD COLUMN reversal_reason TEXT;
    END IF;
END $$;

-- Expand payment_mode check constraint to also permit 'bank_transfer'
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'payments_payment_mode_check'
    ) THEN
        ALTER TABLE payments DROP CONSTRAINT payments_payment_mode_check;
    END IF;

    ALTER TABLE payments ADD CONSTRAINT payments_payment_mode_check 
    CHECK (payment_mode IN ('cash', 'upi', 'neft_rtgs', 'bank_transfer', 'cheque', 'legacy_reconciliation'));
END $$;

-- ----------------------------------------------------------------------------
-- 2. ENHANCE PAYMENT_ALLOCATIONS TABLE
-- ----------------------------------------------------------------------------

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'payment_allocations' AND column_name = 'status'
    ) THEN
        ALTER TABLE payment_allocations 
        ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'active' 
        CHECK (status IN ('active', 'reversed'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'payment_allocations' AND column_name = 'reversed_at'
    ) THEN
        ALTER TABLE payment_allocations ADD COLUMN reversed_at TIMESTAMPTZ;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'payment_allocations' AND column_name = 'reversed_by'
    ) THEN
        ALTER TABLE payment_allocations ADD COLUMN reversed_by UUID REFERENCES users(id) ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'payment_allocations' AND column_name = 'reversal_reason'
    ) THEN
        ALTER TABLE payment_allocations ADD COLUMN reversal_reason TEXT;
    END IF;
END $$;

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments (status);
CREATE INDEX IF NOT EXISTS idx_payment_allocations_status ON payment_allocations (status);
CREATE INDEX IF NOT EXISTS idx_payment_allocations_payment_status ON payment_allocations (payment_id, status);
CREATE INDEX IF NOT EXISTS idx_payment_allocations_invoice_status ON payment_allocations (invoice_id, status);

-- ----------------------------------------------------------------------------
-- 3. UPDATE STATUTORY & ANALYTICAL VIEWS
-- ----------------------------------------------------------------------------

-- View: v_invoice_balances (considers only active payment allocations)
CREATE OR REPLACE VIEW v_invoice_balances AS
SELECT 
    inv.id AS invoice_id,
    inv.invoice_number,
    inv.financial_year,
    inv.invoice_date,
    inv.customer_id,
    p.trade_name AS customer_name,
    p.state_code AS customer_state_code,
    inv.place_of_supply_state_code,
    inv.is_interstate,
    inv.taxable_value,
    inv.cgst_amount,
    inv.sgst_amount,
    inv.igst_amount,
    inv.total_invoice_value,
    COALESCE(pa.total_allocated, 0.00) AS total_paid_amount,
    COALESCE(cn.total_credited, 0.00) AS total_credited_amount,
    ROUND(inv.total_invoice_value - COALESCE(pa.total_allocated, 0.00) - COALESCE(cn.total_credited, 0.00), 2) AS outstanding_balance,
    CASE 
        WHEN inv.status = 'cancelled' THEN 'cancelled'
        WHEN (inv.total_invoice_value - COALESCE(pa.total_allocated, 0.00) - COALESCE(cn.total_credited, 0.00)) <= 0 THEN 'paid'
        WHEN COALESCE(pa.total_allocated, 0.00) > 0 THEN 'partially_paid'
        ELSE 'unpaid'
    END AS derived_payment_status,
    inv.status AS invoice_status,
    inv.created_at
FROM invoices inv
JOIN parties p ON inv.customer_id = p.id
LEFT JOIN (
    SELECT invoice_id, SUM(allocated_amount) AS total_allocated
    FROM payment_allocations
    WHERE status = 'active'
    GROUP BY invoice_id
) pa ON inv.id = pa.invoice_id
LEFT JOIN (
    SELECT invoice_id, SUM(total_credit_amount) AS total_credited
    FROM credit_notes
    GROUP BY invoice_id
) cn ON inv.id = cn.invoice_id;

-- View: v_customer_outstanding (considers only posted payments and active allocations)
CREATE OR REPLACE VIEW v_customer_outstanding AS
SELECT 
    p.id AS customer_id,
    p.trade_name AS customer_name,
    p.state_name,
    p.phone,
    p.credit_limit,
    COALESCE(SUM(ib.total_invoice_value), 0.00) AS total_billed,
    COALESCE(SUM(ib.total_paid_amount), 0.00) AS total_allocated_to_invoices,
    COALESCE(pay_tot.total_payments, 0.00) AS total_payments_received,
    -- Any excess posted payment not yet allocated to an invoice is an unallocated advance
    ROUND(COALESCE(pay_tot.total_payments, 0.00) - COALESCE(SUM(ib.total_paid_amount), 0.00), 2) AS unallocated_advances,
    COALESCE(SUM(ib.total_credited_amount), 0.00) AS total_credited,
    COALESCE(SUM(ib.outstanding_balance), 0.00) AS net_invoice_receivables,
    -- Statutory ageing buckets based on invoice date
    COALESCE(SUM(CASE WHEN CURRENT_DATE - ib.invoice_date <= 30 THEN ib.outstanding_balance ELSE 0 END), 0.00) AS ageing_0_to_30_days,
    COALESCE(SUM(CASE WHEN CURRENT_DATE - ib.invoice_date BETWEEN 31 AND 60 THEN ib.outstanding_balance ELSE 0 END), 0.00) AS ageing_31_to_60_days,
    COALESCE(SUM(CASE WHEN CURRENT_DATE - ib.invoice_date BETWEEN 61 AND 90 THEN ib.outstanding_balance ELSE 0 END), 0.00) AS ageing_61_to_90_days,
    COALESCE(SUM(CASE WHEN CURRENT_DATE - ib.invoice_date > 90 THEN ib.outstanding_balance ELSE 0 END), 0.00) AS ageing_over_90_days
FROM parties p
LEFT JOIN v_invoice_balances ib ON p.id = ib.customer_id AND ib.invoice_status <> 'cancelled'
LEFT JOIN (
    SELECT customer_id, SUM(total_amount) AS total_payments
    FROM payments
    WHERE status = 'posted'
    GROUP BY customer_id
) pay_tot ON p.id = pay_tot.customer_id
WHERE p.party_type IN ('customer', 'both')
GROUP BY p.id, p.trade_name, p.state_name, p.phone, p.credit_limit, pay_tot.total_payments;

-- ----------------------------------------------------------------------------
-- 4. ATOMIC PAYMENT ALLOCATION ENGINE (ENHANCED)
-- ----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS fn_allocate_payment(UUID, UUID, NUMERIC, UUID);
CREATE OR REPLACE FUNCTION fn_allocate_payment(
    p_payment_id UUID,
    p_invoice_id UUID,
    p_amount NUMERIC,
    p_user_id UUID
)
RETURNS UUID AS $$
DECLARE
    v_pay RECORD;
    v_inv RECORD;
    v_allocated_so_far NUMERIC(12, 2);
    v_inv_paid_so_far NUMERIC(12, 2);
    v_inv_credit_so_far NUMERIC(12, 2);
    v_allocation_id UUID;
    v_existing_alloc RECORD;
BEGIN
    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Allocation Error: Amount must be positive.';
    END IF;

    -- Lock payment record
    SELECT * INTO v_pay 
    FROM payments 
    WHERE id = p_payment_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment % not found.', p_payment_id;
    END IF;

    IF v_pay.status <> 'posted' THEN
        RAISE EXCEPTION 'Allocation Error: Payment % is in status "%", only posted payments can be allocated.',
            v_pay.receipt_number, v_pay.status;
    END IF;

    -- Lock invoice record
    SELECT * INTO v_inv 
    FROM invoices 
    WHERE id = p_invoice_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invoice % not found.', p_invoice_id;
    END IF;

    IF v_inv.status NOT IN ('posted', 'dispatched') THEN
        RAISE EXCEPTION 'Allocation Error: Cannot allocate payment to invoice % in status "%". Invoice must be posted or dispatched.',
            v_inv.invoice_number, v_inv.status;
    END IF;

    -- 1. Prevent allocating across different customers
    IF v_pay.customer_id <> v_inv.customer_id THEN
        RAISE EXCEPTION 'Customer Mismatch: Invoice % belongs to customer %, but payment % is from customer %',
            v_inv.invoice_number, v_inv.customer_id, v_pay.receipt_number, v_pay.customer_id;
    END IF;

    -- Check if there's already an active allocation for this (payment_id, invoice_id)
    SELECT * INTO v_existing_alloc
    FROM payment_allocations
    WHERE payment_id = p_payment_id AND invoice_id = p_invoice_id AND status = 'active';

    -- 2. Guard against allocating more than the total payment amount
    SELECT COALESCE(SUM(allocated_amount), 0.00) 
    INTO v_allocated_so_far 
    FROM payment_allocations 
    WHERE payment_id = p_payment_id AND status = 'active';

    IF (v_allocated_so_far + p_amount) > v_pay.total_amount THEN
        RAISE EXCEPTION 'Over-allocation Error: Total allocated (%) plus attempted (%) exceeds payment total (%)',
            v_allocated_so_far, p_amount, v_pay.total_amount;
    END IF;

    -- 3. Guard against overpaying the invoice (accounting for active credit notes & allocations)
    SELECT COALESCE(SUM(allocated_amount), 0.00) 
    INTO v_inv_paid_so_far 
    FROM payment_allocations 
    WHERE invoice_id = p_invoice_id AND status = 'active';

    SELECT COALESCE(SUM(total_credit_amount), 0.00) 
    INTO v_inv_credit_so_far 
    FROM credit_notes 
    WHERE invoice_id = p_invoice_id;

    IF (v_inv_paid_so_far + v_inv_credit_so_far + p_amount) > v_inv.total_invoice_value THEN
        RAISE EXCEPTION 'Invoice Overpayment: Invoice total is %, already settled %, attempted allocation is %',
            v_inv.total_invoice_value, (v_inv_paid_so_far + v_inv_credit_so_far), p_amount;
    END IF;

    -- 4. Insert or update allocation
    IF v_existing_alloc.id IS NOT NULL THEN
        UPDATE payment_allocations
        SET allocated_amount = allocated_amount + p_amount,
            allocated_at = NOW(),
            allocated_by = p_user_id
        WHERE id = v_existing_alloc.id
        RETURNING id INTO v_allocation_id;
    ELSE
        -- If an old reversed allocation exists with this (payment_id, invoice_id), reuse or insert
        SELECT id INTO v_allocation_id
        FROM payment_allocations
        WHERE payment_id = p_payment_id AND invoice_id = p_invoice_id AND status = 'reversed';

        IF v_allocation_id IS NOT NULL THEN
            UPDATE payment_allocations
            SET allocated_amount = p_amount,
                status = 'active',
                allocated_at = NOW(),
                allocated_by = p_user_id,
                reversed_at = NULL,
                reversed_by = NULL,
                reversal_reason = NULL
            WHERE id = v_allocation_id;
        ELSE
            INSERT INTO payment_allocations (
                payment_id,
                invoice_id,
                allocated_amount,
                allocated_by,
                status
            ) VALUES (
                p_payment_id,
                p_invoice_id,
                p_amount,
                p_user_id,
                'active'
            )
            RETURNING id INTO v_allocation_id;
        END IF;
    END IF;

    RETURN v_allocation_id;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 5. ATOMIC PAYMENT REVERSAL & UNALLOCATION FUNCTIONS
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_reverse_payment(
    p_payment_id UUID,
    p_user_id UUID,
    p_reason TEXT
)
RETURNS VOID AS $$
DECLARE
    v_pay RECORD;
BEGIN
    IF p_reason IS NULL OR TRIM(p_reason) = '' THEN
        RAISE EXCEPTION 'Payment Reversal Error: Reversal reason is required.';
    END IF;

    SELECT * INTO v_pay 
    FROM payments 
    WHERE id = p_payment_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment % not found.', p_payment_id;
    END IF;

    IF v_pay.status = 'reversed' THEN
        RAISE EXCEPTION 'Payment Reversal Error: Payment % is already reversed.', v_pay.receipt_number;
    END IF;

    IF v_pay.status = 'cancelled' THEN
        RAISE EXCEPTION 'Payment Reversal Error: Payment % is cancelled.', v_pay.receipt_number;
    END IF;

    -- Update payment status to reversed
    UPDATE payments 
    SET status = 'reversed',
        reversed_at = NOW(),
        reversed_by = p_user_id,
        reversal_reason = TRIM(p_reason)
    WHERE id = p_payment_id;

    -- Mark all active allocations for this payment as reversed
    UPDATE payment_allocations 
    SET status = 'reversed',
        reversed_at = NOW(),
        reversed_by = p_user_id,
        reversal_reason = TRIM(p_reason)
    WHERE payment_id = p_payment_id AND status = 'active';

END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_unallocate_payment(
    p_allocation_id UUID,
    p_user_id UUID,
    p_reason TEXT
)
RETURNS VOID AS $$
DECLARE
    v_alloc RECORD;
    v_pay RECORD;
BEGIN
    IF p_reason IS NULL OR TRIM(p_reason) = '' THEN
        RAISE EXCEPTION 'Unallocation Error: Reversal reason is required.';
    END IF;

    SELECT * INTO v_alloc 
    FROM payment_allocations 
    WHERE id = p_allocation_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment allocation % not found.', p_allocation_id;
    END IF;

    IF v_alloc.status = 'reversed' THEN
        RAISE EXCEPTION 'Unallocation Error: Allocation is already reversed.';
    END IF;

    SELECT * INTO v_pay 
    FROM payments 
    WHERE id = v_alloc.payment_id 
    FOR UPDATE;

    -- Update allocation status to reversed
    UPDATE payment_allocations 
    SET status = 'reversed',
        reversed_at = NOW(),
        reversed_by = p_user_id,
        reversal_reason = TRIM(p_reason)
    WHERE id = p_allocation_id;

END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 6. IMMUTABILITY ENFORCEMENT TRIGGERS
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_prevent_posted_payment_modification()
RETURNS TRIGGER AS $$
BEGIN
    IF current_setting('session_replication_role', true) = 'replica' THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;

    IF TG_OP = 'DELETE' THEN
        IF OLD.status IN ('posted', 'reversed') THEN
            RAISE EXCEPTION 'Statutory Audit Violation: Cannot DELETE % payment "%". Financial transactions must be reversed via correction entries.',
                OLD.status, OLD.receipt_number;
        END IF;
        RETURN OLD;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF OLD.status = 'reversed' THEN
            RAISE EXCEPTION 'Statutory Audit Violation: Reversed payment "%" is strictly immutable and cannot be updated.',
                OLD.receipt_number;
        END IF;

        IF OLD.status = 'cancelled' THEN
            RAISE EXCEPTION 'Statutory Audit Violation: Cancelled payment "%" is immutable.',
                OLD.receipt_number;
        END IF;

        IF OLD.status = 'posted' THEN
            -- Only allow transition to 'reversed' with valid reversal metadata
            IF NEW.status = 'reversed' THEN
                IF NEW.total_amount <> OLD.total_amount OR
                   NEW.customer_id <> OLD.customer_id OR
                   NEW.payment_mode <> OLD.payment_mode OR
                   NEW.receipt_number <> OLD.receipt_number THEN
                    RAISE EXCEPTION 'Statutory Audit Violation: Core payment details cannot be altered during reversal.';
                END IF;
                RETURN NEW;
            ELSE
                RAISE EXCEPTION 'Statutory Audit Violation: Posted payment "%" cannot be modified. It must be reversed through the reversal workflow.',
                    OLD.receipt_number;
            END IF;
        END IF;

        IF OLD.status = 'draft' AND NEW.status NOT IN ('draft', 'posted', 'cancelled') THEN
            RAISE EXCEPTION 'Invalid status transition for draft payment from "%" to "%".',
                OLD.status, NEW.status;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_posted_payment_modify ON payments;
CREATE TRIGGER trg_prevent_posted_payment_modify
BEFORE UPDATE OR DELETE ON payments
FOR EACH ROW EXECUTE FUNCTION fn_prevent_posted_payment_modification();

CREATE OR REPLACE FUNCTION fn_prevent_payment_allocation_modification()
RETURNS TRIGGER AS $$
BEGIN
    IF current_setting('session_replication_role', true) = 'replica' THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;

    IF TG_OP = 'DELETE' THEN
        IF OLD.status = 'active' THEN
            RAISE EXCEPTION 'Statutory Audit Violation: Active payment allocations cannot be directly deleted. The allocation or payment must be reversed.';
        END IF;
        RETURN OLD;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF OLD.status = 'reversed' AND NEW.status <> 'active' THEN
            RAISE EXCEPTION 'Statutory Audit Violation: Reversed payment allocation is strictly immutable.';
        END IF;

        -- Allow status transition from active to reversed
        IF OLD.status = 'active' AND NEW.status = 'reversed' THEN
            RETURN NEW;
        END IF;

        -- Allow reactivating a previously reversed allocation (via fn_allocate_payment reuse)
        IF OLD.status = 'reversed' AND NEW.status = 'active' THEN
            RETURN NEW;
        END IF;

        -- Allow increasing allocation amount via fn_allocate_payment
        IF OLD.status = 'active' AND NEW.status = 'active' AND NEW.allocated_amount >= OLD.allocated_amount THEN
            RETURN NEW;
        END IF;

        RAISE EXCEPTION 'Statutory Audit Violation: Payment allocation cannot be modified.';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_active_allocation_modify ON payment_allocations;
CREATE TRIGGER trg_prevent_active_allocation_modify
BEFORE UPDATE OR DELETE ON payment_allocations
FOR EACH ROW EXECUTE FUNCTION fn_prevent_payment_allocation_modification();


-- ==========================================
-- database/migrations/010_financial_accounting.sql
-- ==========================================
-- ============================================================================
-- ORDER-TO-AUDIT SYSTEM: MIGRATION 010
-- PHASE 9: FINANCIAL ACCOUNTING, GENERAL LEDGER & STATUTORY REPORTING
-- ============================================================================
-- 1. Creates `chart_of_accounts` with hierarchical account classifications.
-- 2. Creates `journal_entries` and `journal_entry_lines` for double-entry ledger.
-- 3. Seeds the standard Chart of Accounts for food manufacturing.
-- 4. Installs `fn_post_journal_entry` and `fn_reverse_journal_entry`.
-- 5. Builds views: `v_general_ledger`, `v_trial_balance`, `v_profit_and_loss`,
--    `v_balance_sheet`, `v_cash_bank_summary`, `v_gst_reconciliation`.
-- 6. Enforces database-level immutability on posted journal entries and lines.
-- 7. Integrates audit triggers.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. CHART OF ACCOUNTS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chart_of_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_code VARCHAR(20) UNIQUE NOT NULL,
    account_name VARCHAR(100) NOT NULL,
    account_type VARCHAR(30) NOT NULL CHECK (account_type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
    category VARCHAR(50) NOT NULL,
    normal_balance VARCHAR(10) NOT NULL CHECK (normal_balance IN ('debit', 'credit')),
    parent_account_id UUID REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
    description TEXT,
    is_system BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_coa_account_type ON chart_of_accounts (account_type);
CREATE INDEX IF NOT EXISTS idx_coa_category ON chart_of_accounts (category);
CREATE INDEX IF NOT EXISTS idx_coa_is_active ON chart_of_accounts (is_active);

-- ----------------------------------------------------------------------------
-- 2. JOURNAL ENTRIES & LINE ITEMS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS journal_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_number VARCHAR(50) UNIQUE NOT NULL,
    entry_date DATE NOT NULL,
    accounting_date DATE NOT NULL,
    source_type VARCHAR(50) NOT NULL CHECK (source_type IN (
        'PURCHASE_BILL',
        'SALES_INVOICE',
        'SALES_DISPATCH',
        'PRODUCTION_RUN',
        'CUSTOMER_PAYMENT',
        'PAYMENT_REVERSAL',
        'MANUAL'
    )),
    source_id UUID,
    source_reference VARCHAR(100),
    narration TEXT NOT NULL,
    total_debit NUMERIC(15, 2) NOT NULL DEFAULT 0.00 CHECK (total_debit >= 0),
    total_credit NUMERIC(15, 2) NOT NULL DEFAULT 0.00 CHECK (total_credit >= 0),
    status VARCHAR(20) NOT NULL DEFAULT 'posted' CHECK (status IN ('draft', 'posted', 'reversed')),
    posted_at TIMESTAMPTZ,
    posted_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    reversed_at TIMESTAMPTZ,
    reversed_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    reversal_entry_id UUID REFERENCES journal_entries(id) ON DELETE RESTRICT,
    reversal_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_journal_entry_balanced CHECK (status = 'draft' OR total_debit = total_credit)
);

-- Partial unique index ensuring strictly one posted journal entry per operational source transaction
CREATE UNIQUE INDEX IF NOT EXISTS uq_je_source 
ON journal_entries (source_type, source_id) 
WHERE status = 'posted' AND source_type <> 'MANUAL';

CREATE INDEX IF NOT EXISTS idx_je_entry_date ON journal_entries (entry_date);
CREATE INDEX IF NOT EXISTS idx_je_accounting_date ON journal_entries (accounting_date);
CREATE INDEX IF NOT EXISTS idx_je_status ON journal_entries (status);

CREATE TABLE IF NOT EXISTS journal_entry_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    journal_entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
    line_number INT NOT NULL,
    debit_amount NUMERIC(15, 2) NOT NULL DEFAULT 0.00 CHECK (debit_amount >= 0),
    credit_amount NUMERIC(15, 2) NOT NULL DEFAULT 0.00 CHECK (credit_amount >= 0),
    description VARCHAR(255),
    party_id UUID REFERENCES parties(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_line_debit_or_credit CHECK (
        (debit_amount > 0 AND credit_amount = 0) OR 
        (credit_amount > 0 AND debit_amount = 0)
    ),
    CONSTRAINT uq_journal_line_number UNIQUE (journal_entry_id, line_number)
);

CREATE INDEX IF NOT EXISTS idx_jel_entry_id ON journal_entry_lines (journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_jel_account_id ON journal_entry_lines (account_id);
CREATE INDEX IF NOT EXISTS idx_jel_party_id ON journal_entry_lines (party_id);

-- ----------------------------------------------------------------------------
-- 3. SEED STANDARD CHART OF ACCOUNTS FOR FOOD MANUFACTURING
-- ----------------------------------------------------------------------------
INSERT INTO chart_of_accounts (account_code, account_name, account_type, category, normal_balance, description, is_system)
VALUES
    -- 1000-1999: ASSETS
    ('1110', 'Cash in Hand', 'asset', 'cash_bank', 'debit', 'Physical cash on premises for operational expenses', true),
    ('1120', 'Bank Account - Operating', 'asset', 'cash_bank', 'debit', 'Primary commercial checking and clearing bank account', true),
    ('1200', 'Accounts Receivable (Debtors)', 'asset', 'accounts_receivable', 'debit', 'Customer outstanding invoices and trade receivables', true),
    ('1310', 'Raw Materials Inventory', 'asset', 'inventory', 'debit', 'Purchased food ingredients and packaging materials', true),
    ('1320', 'Work-in-Progress (WIP) Inventory', 'asset', 'inventory', 'debit', 'Materials currently in production floor processing', true),
    ('1330', 'Finished Goods Inventory', 'asset', 'inventory', 'debit', 'Manufactured packaged products ready for commercial dispatch', true),
    ('1410', 'CGST Input Tax Credit', 'asset', 'tax_input', 'debit', 'Central GST paid on inward supply eligible for set-off', true),
    ('1420', 'SGST Input Tax Credit', 'asset', 'tax_input', 'debit', 'State GST paid on inward supply eligible for set-off', true),
    ('1430', 'IGST Input Tax Credit', 'asset', 'tax_input', 'debit', 'Integrated GST paid on interstate purchases eligible for set-off', true),

    -- 2000-2999: LIABILITIES
    ('2100', 'Accounts Payable (Creditors)', 'liability', 'accounts_payable', 'credit', 'Vendor obligations for raw material and service purchases', true),
    ('2210', 'CGST Output Tax Liability', 'liability', 'tax_output', 'credit', 'Central GST collected on intra-state outward sales', true),
    ('2220', 'SGST Output Tax Liability', 'liability', 'tax_output', 'credit', 'State GST collected on intra-state outward sales', true),
    ('2230', 'IGST Output Tax Liability', 'liability', 'tax_output', 'credit', 'Integrated GST collected on interstate outward sales', true),
    ('2300', 'Customer Advances', 'liability', 'customer_advances', 'credit', 'Unallocated customer receipts held on-account', true),

    -- 3000-3999: EQUITY
    ('3100', 'Owner Capital', 'equity', 'equity', 'credit', 'Initial and ongoing equity contributed by business owner', true),
    ('3200', 'Retained Earnings', 'equity', 'equity', 'credit', 'Accumulated cumulative earnings retained in the business', true),

    -- 4000-4999: REVENUE
    ('4100', 'Sales Revenue - Food Products', 'revenue', 'operating_revenue', 'credit', 'Gross revenue from commercial sale of manufactured food items', true),
    ('4200', 'Other Operating Income', 'revenue', 'operating_revenue', 'credit', 'Ancillary operating receipts including scrap sales', true),

    -- 5000-5999: COST OF GOODS SOLD & PRODUCTION OVERHEADS
    ('5100', 'Cost of Goods Sold - Direct Materials', 'expense', 'cost_of_goods_sold', 'debit', 'Material cost of finished goods dispatched and sold', true),
    ('5200', 'Direct Labour Cost', 'expense', 'cost_of_goods_sold', 'debit', 'Wages paid to factory production floor operators', true),
    ('5300', 'Factory Overhead - Power & Fuel', 'expense', 'manufacturing_overhead', 'debit', 'Electricity, gas, and energy utilized in production', true),
    ('5400', 'Factory Overhead - Machine Maintenance', 'expense', 'manufacturing_overhead', 'debit', 'Repair and servicing of manufacturing machinery', true),
    ('5900', 'Manufacturing Overheads Absorbed', 'expense', 'manufacturing_overhead', 'credit', 'Absorption clearing credit for overheads allocated to batches', true),

    -- 6000-6999: OPERATING EXPENSES
    ('6100', 'Salaries & Administrative Wages', 'expense', 'operating_expense', 'debit', 'Executive, office, sales, and managerial staff compensation', true),
    ('6200', 'Rent & Office Utilities', 'expense', 'operating_expense', 'debit', 'Premises rental and office utilities', true),
    ('6300', 'Freight & Outward Delivery Charges', 'expense', 'operating_expense', 'debit', 'Logistics and delivery costs to customer destinations', true),
    ('6400', 'Administrative & General Expenses', 'expense', 'operating_expense', 'debit', 'General business overheads and compliance costs', true)
ON CONFLICT (account_code) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 4. ATOMIC POSTING & REVERSAL FUNCTIONS
-- ----------------------------------------------------------------------------

-- Function: Post draft journal entry after verifying balance
CREATE OR REPLACE FUNCTION fn_post_journal_entry(
    p_entry_id UUID,
    p_user_id UUID
)
RETURNS VOID AS $$
DECLARE
    v_entry RECORD;
    v_total_debit NUMERIC(15, 2);
    v_total_credit NUMERIC(15, 2);
    v_line_count INT;
BEGIN
    SELECT * INTO v_entry 
    FROM journal_entries 
    WHERE id = p_entry_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Journal entry % not found.', p_entry_id;
    END IF;

    IF v_entry.status = 'posted' THEN
        RAISE EXCEPTION 'Journal entry % is already posted.', v_entry.entry_number;
    END IF;

    IF v_entry.status = 'reversed' THEN
        RAISE EXCEPTION 'Cannot post reversed journal entry %.', v_entry.entry_number;
    END IF;

    SELECT 
        COUNT(*),
        COALESCE(SUM(debit_amount), 0.00),
        COALESCE(SUM(credit_amount), 0.00)
    INTO v_line_count, v_total_debit, v_total_credit
    FROM journal_entry_lines 
    WHERE journal_entry_id = p_entry_id;

    IF v_line_count < 2 THEN
        RAISE EXCEPTION 'Accounting Error: Journal entry must contain at least 2 line items.';
    END IF;

    IF v_total_debit <= 0 OR v_total_credit <= 0 THEN
        RAISE EXCEPTION 'Accounting Error: Journal entry must have positive debit and credit amounts.';
    END IF;

    IF v_total_debit <> v_total_credit THEN
        RAISE EXCEPTION 'Accounting Error: Unbalanced journal entry. Total Debits (₹%) do not equal Total Credits (₹%).',
            v_total_debit, v_total_credit;
    END IF;

    UPDATE journal_entries
    SET status = 'posted',
        total_debit = v_total_debit,
        total_credit = v_total_credit,
        posted_at = NOW(),
        posted_by = p_user_id,
        updated_at = NOW()
    WHERE id = p_entry_id;
END;
$$ LANGUAGE plpgsql;

-- Function: Controlled reversal of a posted journal entry
CREATE OR REPLACE FUNCTION fn_reverse_journal_entry(
    p_entry_id UUID,
    p_user_id UUID,
    p_reason TEXT
)
RETURNS UUID AS $$
DECLARE
    v_orig RECORD;
    v_reversal_id UUID;
    v_new_entry_number VARCHAR(50);
    v_line RECORD;
    v_line_num INT := 1;
    v_year INT;
    v_seq INT := 1;
    v_prefix VARCHAR(20);
    v_last_je VARCHAR(50);
BEGIN
    IF p_reason IS NULL OR TRIM(p_reason) = '' THEN
        RAISE EXCEPTION 'Reversal Error: Reversal reason is required.';
    END IF;

    SELECT * INTO v_orig 
    FROM journal_entries 
    WHERE id = p_entry_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Journal entry % not found.', p_entry_id;
    END IF;

    IF v_orig.status <> 'posted' THEN
        RAISE EXCEPTION 'Reversal Error: Only posted journal entries can be reversed (status is "%").', v_orig.status;
    END IF;

    IF v_orig.reversal_entry_id IS NOT NULL THEN
        RAISE EXCEPTION 'Reversal Error: Journal entry % is already reversed.', v_orig.entry_number;
    END IF;

    -- Generate sequential reversal entry number
    v_year := EXTRACT(YEAR FROM CURRENT_DATE)::INT;
    v_prefix := 'JE-' || v_year || '-';

    SELECT entry_number INTO v_last_je
    FROM journal_entries
    WHERE entry_number LIKE v_prefix || '%'
    ORDER BY entry_number DESC
    LIMIT 1;

    IF v_last_je IS NOT NULL THEN
        v_seq := (SUBSTRING(v_last_je FROM '[0-9]+$')::INT) + 1;
    END IF;

    v_new_entry_number := v_prefix || LPAD(v_seq::TEXT, 4, '0');

    -- Insert reversal journal entry header
    INSERT INTO journal_entries (
        entry_number,
        entry_date,
        accounting_date,
        source_type,
        source_id,
        source_reference,
        narration,
        total_debit,
        total_credit,
        status,
        posted_at,
        posted_by,
        reversal_reason
    ) VALUES (
        v_new_entry_number,
        CURRENT_DATE,
        CURRENT_DATE,
        v_orig.source_type,
        v_orig.source_id,
        v_orig.entry_number,
        'REVERSAL of ' || v_orig.entry_number || ': ' || TRIM(p_reason),
        v_orig.total_credit,
        v_orig.total_debit,
        'posted',
        NOW(),
        p_user_id,
        TRIM(p_reason)
    ) RETURNING id INTO v_reversal_id;

    -- Insert reciprocal line items (invert debits and credits)
    FOR v_line IN 
        SELECT * FROM journal_entry_lines 
        WHERE journal_entry_id = p_entry_id 
        ORDER BY line_number ASC
    LOOP
        INSERT INTO journal_entry_lines (
            journal_entry_id,
            account_id,
            line_number,
            debit_amount,
            credit_amount,
            description,
            party_id
        ) VALUES (
            v_reversal_id,
            v_line.account_id,
            v_line_num,
            v_line.credit_amount,  -- Swap credit to debit
            v_line.debit_amount,   -- Swap debit to credit
            'Reversal: ' || COALESCE(v_line.description, 'Line reversal'),
            v_line.party_id
        );
        v_line_num := v_line_num + 1;
    END LOOP;

    -- Update original journal entry to reversed and link reversal entry
    UPDATE journal_entries
    SET status = 'reversed',
        reversed_at = NOW(),
        reversed_by = p_user_id,
        reversal_entry_id = v_reversal_id,
        reversal_reason = TRIM(p_reason),
        updated_at = NOW()
    WHERE id = p_entry_id;

    RETURN v_reversal_id;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 5. ANALYTICAL & STATUTORY FINANCIAL VIEWS
-- ----------------------------------------------------------------------------

-- View: v_general_ledger
CREATE OR REPLACE VIEW v_general_ledger AS
SELECT 
    jel.id AS line_id,
    je.id AS journal_entry_id,
    je.entry_number,
    je.entry_date,
    je.accounting_date,
    je.source_type,
    je.source_id,
    je.source_reference,
    je.status AS entry_status,
    coa.id AS account_id,
    coa.account_code,
    coa.account_name,
    coa.account_type,
    coa.category,
    coa.normal_balance,
    jel.line_number,
    jel.debit_amount,
    jel.credit_amount,
    CASE 
        WHEN coa.normal_balance = 'debit' THEN (jel.debit_amount - jel.credit_amount)
        ELSE (jel.credit_amount - jel.debit_amount)
    END AS net_line_amount,
    jel.description AS line_description,
    je.narration,
    jel.party_id,
    p.trade_name AS party_name,
    je.created_at
FROM journal_entry_lines jel
JOIN journal_entries je ON jel.journal_entry_id = je.id
JOIN chart_of_accounts coa ON jel.account_id = coa.id
LEFT JOIN parties p ON jel.party_id = p.id
WHERE je.status = 'posted';

-- View: v_trial_balance
CREATE OR REPLACE VIEW v_trial_balance AS
SELECT 
    coa.id AS account_id,
    coa.account_code,
    coa.account_name,
    coa.account_type,
    coa.category,
    coa.normal_balance,
    COALESCE(SUM(jel.debit_amount), 0.00) AS total_debit,
    COALESCE(SUM(jel.credit_amount), 0.00) AS total_credit,
    CASE 
        WHEN COALESCE(SUM(jel.debit_amount), 0.00) >= COALESCE(SUM(jel.credit_amount), 0.00) 
        THEN ROUND(COALESCE(SUM(jel.debit_amount), 0.00) - COALESCE(SUM(jel.credit_amount), 0.00), 2)
        ELSE 0.00
    END AS net_debit_balance,
    CASE 
        WHEN COALESCE(SUM(jel.credit_amount), 0.00) > COALESCE(SUM(jel.debit_amount), 0.00) 
        THEN ROUND(COALESCE(SUM(jel.credit_amount), 0.00) - COALESCE(SUM(jel.debit_amount), 0.00), 2)
        ELSE 0.00
    END AS net_credit_balance
FROM chart_of_accounts coa
LEFT JOIN journal_entry_lines jel ON coa.id = jel.account_id
LEFT JOIN journal_entries je ON jel.journal_entry_id = je.id AND je.status = 'posted'
WHERE coa.is_active = true
GROUP BY coa.id, coa.account_code, coa.account_name, coa.account_type, coa.category, coa.normal_balance;

-- View: v_profit_and_loss
CREATE OR REPLACE VIEW v_profit_and_loss AS
SELECT 
    coa.account_type,
    coa.category,
    coa.account_code,
    coa.account_name,
    CASE 
        WHEN coa.account_type = 'revenue' 
        THEN ROUND(COALESCE(SUM(jel.credit_amount), 0.00) - COALESCE(SUM(jel.debit_amount), 0.00), 2)
        ELSE ROUND(COALESCE(SUM(jel.debit_amount), 0.00) - COALESCE(SUM(jel.credit_amount), 0.00), 2)
    END AS net_amount
FROM chart_of_accounts coa
LEFT JOIN journal_entry_lines jel ON coa.id = jel.account_id
LEFT JOIN journal_entries je ON jel.journal_entry_id = je.id AND je.status = 'posted'
WHERE coa.account_type IN ('revenue', 'expense') AND coa.is_active = true
GROUP BY coa.account_type, coa.category, coa.account_code, coa.account_name;

-- View: v_cash_bank_summary
CREATE OR REPLACE VIEW v_cash_bank_summary AS
SELECT 
    coa.account_code,
    coa.account_name,
    COALESCE(SUM(jel.debit_amount), 0.00) AS total_receipts,
    COALESCE(SUM(jel.credit_amount), 0.00) AS total_payments,
    ROUND(COALESCE(SUM(jel.debit_amount), 0.00) - COALESCE(SUM(jel.credit_amount), 0.00), 2) AS current_balance
FROM chart_of_accounts coa
LEFT JOIN journal_entry_lines jel ON coa.id = jel.account_id
LEFT JOIN journal_entries je ON jel.journal_entry_id = je.id AND je.status = 'posted'
WHERE coa.category = 'cash_bank' AND coa.is_active = true
GROUP BY coa.account_code, coa.account_name;

-- View: v_gst_reconciliation
CREATE OR REPLACE VIEW v_gst_reconciliation AS
WITH tax_summary AS (
    SELECT 
        coa.account_code,
        coa.account_name,
        coa.category,
        COALESCE(SUM(jel.debit_amount), 0.00) AS total_debit,
        COALESCE(SUM(jel.credit_amount), 0.00) AS total_credit
    FROM chart_of_accounts coa
    LEFT JOIN journal_entry_lines jel ON coa.id = jel.account_id
    LEFT JOIN journal_entries je ON jel.journal_entry_id = je.id AND je.status = 'posted'
    WHERE coa.category IN ('tax_input', 'tax_output') AND coa.is_active = true
    GROUP BY coa.account_code, coa.account_name, coa.category
)
SELECT 
    (SELECT ROUND(COALESCE(SUM(total_debit - total_credit), 0.00), 2) FROM tax_summary WHERE account_code = '1410') AS cgst_input_credit,
    (SELECT ROUND(COALESCE(SUM(total_debit - total_credit), 0.00), 2) FROM tax_summary WHERE account_code = '1420') AS sgst_input_credit,
    (SELECT ROUND(COALESCE(SUM(total_debit - total_credit), 0.00), 2) FROM tax_summary WHERE account_code = '1430') AS igst_input_credit,
    (SELECT ROUND(COALESCE(SUM(total_credit - total_debit), 0.00), 2) FROM tax_summary WHERE account_code = '2210') AS cgst_output_liability,
    (SELECT ROUND(COALESCE(SUM(total_credit - total_debit), 0.00), 2) FROM tax_summary WHERE account_code = '2220') AS sgst_output_liability,
    (SELECT ROUND(COALESCE(SUM(total_credit - total_debit), 0.00), 2) FROM tax_summary WHERE account_code = '2230') AS igst_output_liability,
    (SELECT ROUND(COALESCE(SUM(total_debit - total_credit), 0.00), 2) FROM tax_summary WHERE category = 'tax_input') AS total_input_tax_credit,
    (SELECT ROUND(COALESCE(SUM(total_credit - total_debit), 0.00), 2) FROM tax_summary WHERE category = 'tax_output') AS total_output_tax_liability,
    ROUND(
        (SELECT COALESCE(SUM(total_credit - total_debit), 0.00) FROM tax_summary WHERE category = 'tax_output') - 
        (SELECT COALESCE(SUM(total_debit - total_credit), 0.00) FROM tax_summary WHERE category = 'tax_input'), 
        2
    ) AS net_gst_payable_or_refundable;

-- ----------------------------------------------------------------------------
-- 6. IMMUTABILITY ENFORCEMENT TRIGGERS
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_prevent_posted_journal_entry_modification()
RETURNS TRIGGER AS $$
BEGIN
    IF current_setting('session_replication_role', true) = 'replica' THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;

    IF TG_OP = 'DELETE' THEN
        IF OLD.status IN ('posted', 'reversed') THEN
            RAISE EXCEPTION 'Statutory Audit Violation: Posted journal entry % is immutable and cannot be deleted.',
                OLD.entry_number;
        END IF;
        RETURN OLD;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF OLD.status = 'reversed' THEN
            RAISE EXCEPTION 'Statutory Audit Violation: Reversed journal entry % is immutable and cannot be modified.',
                OLD.entry_number;
        END IF;

        IF OLD.status = 'posted' THEN
            -- Only allow status transition to reversed
            IF NEW.status = 'reversed' THEN
                IF NEW.total_debit <> OLD.total_debit OR 
                   NEW.total_credit <> OLD.total_credit OR
                   NEW.entry_number <> OLD.entry_number OR
                   NEW.entry_date <> OLD.entry_date THEN
                    RAISE EXCEPTION 'Statutory Audit Violation: Core financial parameters of journal entry % cannot be altered during reversal.',
                        OLD.entry_number;
                END IF;
                RETURN NEW;
            ELSE
                RAISE EXCEPTION 'Statutory Audit Violation: Posted journal entry % is immutable. Corrections must be made via reversal entries.',
                    OLD.entry_number;
            END IF;
        END IF;

        IF OLD.status = 'draft' AND NEW.status NOT IN ('draft', 'posted') THEN
            RAISE EXCEPTION 'Invalid status transition for draft journal entry from "%" to "%".',
                OLD.status, NEW.status;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_posted_journal_entry_modify ON journal_entries;
CREATE TRIGGER trg_prevent_posted_journal_entry_modify
BEFORE UPDATE OR DELETE ON journal_entries
FOR EACH ROW EXECUTE FUNCTION fn_prevent_posted_journal_entry_modification();

CREATE OR REPLACE FUNCTION fn_prevent_posted_journal_line_modification()
RETURNS TRIGGER AS $$
DECLARE
    v_status VARCHAR(20);
    v_entry_num VARCHAR(50);
BEGIN
    IF current_setting('session_replication_role', true) = 'replica' THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;

    IF TG_OP = 'DELETE' THEN
        SELECT status, entry_number INTO v_status, v_entry_num 
        FROM journal_entries WHERE id = OLD.journal_entry_id;

        IF v_status IN ('posted', 'reversed') THEN
            RAISE EXCEPTION 'Statutory Audit Violation: Cannot delete line item of % journal entry %.',
                v_status, v_entry_num;
        END IF;
        RETURN OLD;
    END IF;

    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        SELECT status, entry_number INTO v_status, v_entry_num 
        FROM journal_entries WHERE id = NEW.journal_entry_id;

        IF v_status IN ('posted', 'reversed') THEN
            -- Allow insert during the creation phase of an entry that is being created as posted or reversed
            IF TG_OP = 'INSERT' AND v_status = 'posted' THEN
                RETURN NEW;
            END IF;

            RAISE EXCEPTION 'Statutory Audit Violation: Cannot modify line items of % journal entry %.',
                v_status, v_entry_num;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_posted_journal_line_modify ON journal_entry_lines;
CREATE TRIGGER trg_prevent_posted_journal_line_modify
BEFORE INSERT OR UPDATE OR DELETE ON journal_entry_lines
FOR EACH ROW EXECUTE FUNCTION fn_prevent_posted_journal_line_modification();

-- ----------------------------------------------------------------------------
-- 7. AUDIT TRAIL TRIGGERS
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_audit_journal_entries ON journal_entries;
CREATE TRIGGER trg_audit_journal_entries
AFTER INSERT OR UPDATE OR DELETE ON journal_entries
FOR EACH ROW EXECUTE FUNCTION fn_log_entity_audit_trail();

DROP TRIGGER IF EXISTS trg_audit_chart_of_accounts ON chart_of_accounts;
CREATE TRIGGER trg_audit_chart_of_accounts
AFTER INSERT OR UPDATE OR DELETE ON chart_of_accounts
FOR EACH ROW EXECUTE FUNCTION fn_log_entity_audit_trail();


-- ==========================================
-- database/migrations/011_advanced_erp_operations.sql
-- ==========================================
-- ============================================================================
-- ORDER-TO-AUDIT SYSTEM: MIGRATION 011
-- PHASE 10: ADVANCED ERP OPERATIONS
-- ============================================================================
-- 1. Supplier Payments & Accounts Payable
-- 2. Multi-Warehouse Management & Stock Transfers
-- 3. Batch, Lot & Expiry Tracking (FEFO Traceability)
-- 4. Inventory Adjustments & Write-Off Workflows
-- 5. Employee & Payroll Management (Controlled Scope)
-- 6. Financial Accounting Integrations
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. SUPPLIER PAYMENTS & ALLOCATIONS (ACCOUNTS PAYABLE)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS supplier_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_number VARCHAR(50) UNIQUE NOT NULL,
    supplier_id UUID NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,
    payment_date DATE NOT NULL,
    total_amount NUMERIC(15, 2) NOT NULL CHECK (total_amount > 0),
    payment_mode VARCHAR(30) NOT NULL CHECK (payment_mode IN (
        'cash', 'upi', 'neft_rtgs', 'bank_transfer', 'cheque', 'legacy_reconciliation'
    )),
    reference_txn_id VARCHAR(100),
    bank_name VARCHAR(100),
    bank_branch VARCHAR(100),
    cheque_number VARCHAR(50),
    cheque_date DATE,
    notes TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'posted' CHECK (status IN ('draft', 'posted', 'cancelled', 'reversed')),
    recorded_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    reversed_at TIMESTAMPTZ,
    reversed_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    reversal_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_spay_supplier_id ON supplier_payments (supplier_id);
CREATE INDEX IF NOT EXISTS idx_spay_status ON supplier_payments (status);
CREATE INDEX IF NOT EXISTS idx_spay_payment_date ON supplier_payments (payment_date);

CREATE TABLE IF NOT EXISTS supplier_payment_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_payment_id UUID NOT NULL REFERENCES supplier_payments(id) ON DELETE CASCADE,
    purchase_bill_id UUID NOT NULL REFERENCES purchase_bills(id) ON DELETE RESTRICT,
    allocated_amount NUMERIC(15, 2) NOT NULL CHECK (allocated_amount > 0),
    allocated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    allocated_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'reversed')),
    reversed_at TIMESTAMPTZ,
    reversed_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    reversal_reason TEXT,
    CONSTRAINT uq_spay_bill_alloc UNIQUE (supplier_payment_id, purchase_bill_id)
);

CREATE INDEX IF NOT EXISTS idx_spay_alloc_payment_id ON supplier_payment_allocations (supplier_payment_id);
CREATE INDEX IF NOT EXISTS idx_spay_alloc_bill_id ON supplier_payment_allocations (purchase_bill_id);
CREATE INDEX IF NOT EXISTS idx_spay_alloc_status ON supplier_payment_allocations (status);

-- View: Purchase Bill Balances
CREATE OR REPLACE VIEW v_purchase_bill_balances AS
SELECT 
    pb.id AS purchase_bill_id,
    pb.bill_number,
    pb.bill_date,
    pb.supplier_id,
    p.trade_name AS supplier_name,
    pb.subtotal_amount,
    pb.cgst_amount,
    pb.sgst_amount,
    pb.igst_amount,
    pb.total_amount AS total_bill_amount,
    COALESCE(SUM(spa.allocated_amount) FILTER (WHERE spa.status = 'active'), 0.00) AS total_paid_amount,
    ROUND(pb.total_amount - COALESCE(SUM(spa.allocated_amount) FILTER (WHERE spa.status = 'active'), 0.00), 2) AS outstanding_balance,
    CASE 
        WHEN COALESCE(SUM(spa.allocated_amount) FILTER (WHERE spa.status = 'active'), 0.00) = 0.00 THEN 'unpaid'
        WHEN COALESCE(SUM(spa.allocated_amount) FILTER (WHERE spa.status = 'active'), 0.00) >= pb.total_amount THEN 'paid'
        ELSE 'partially_paid'
    END AS payment_status,
    pb.status AS bill_status,
    pb.created_at
FROM purchase_bills pb
JOIN parties p ON pb.supplier_id = p.id
LEFT JOIN supplier_payment_allocations spa ON pb.id = spa.purchase_bill_id
GROUP BY pb.id, pb.bill_number, pb.bill_date, pb.supplier_id, p.trade_name, pb.subtotal_amount, 
         pb.cgst_amount, pb.sgst_amount, pb.igst_amount, pb.total_amount, pb.status, pb.created_at;

-- View: Supplier Outstanding Summary
CREATE OR REPLACE VIEW v_supplier_outstanding AS
WITH bill_summary AS (
    SELECT 
        supplier_id,
        COUNT(id) AS total_bills_count,
        COALESCE(SUM(total_amount), 0.00) AS total_billed_amount
    FROM purchase_bills
    WHERE status = 'received'
    GROUP BY supplier_id
),
payment_summary AS (
    SELECT 
        supplier_id,
        COALESCE(SUM(total_amount), 0.00) AS total_paid_amount
    FROM supplier_payments
    WHERE status = 'posted'
    GROUP BY supplier_id
),
allocation_summary AS (
    SELECT 
        sp.supplier_id,
        COALESCE(SUM(spa.allocated_amount), 0.00) AS total_allocated_amount
    FROM supplier_payment_allocations spa
    JOIN supplier_payments sp ON spa.supplier_payment_id = sp.id
    WHERE spa.status = 'active' AND sp.status = 'posted'
    GROUP BY sp.supplier_id
)
SELECT 
    p.id AS supplier_id,
    p.trade_name AS supplier_name,
    p.phone,
    p.email,
    p.gstin,
    p.state_code,
    COALESCE(bs.total_bills_count, 0) AS total_bills_count,
    COALESCE(bs.total_billed_amount, 0.00) AS total_billed_amount,
    COALESCE(ps.total_paid_amount, 0.00) AS total_paid_amount,
    COALESCE(als.total_allocated_amount, 0.00) AS total_allocated_amount,
    ROUND(COALESCE(bs.total_billed_amount, 0.00) - COALESCE(als.total_allocated_amount, 0.00), 2) AS current_outstanding,
    ROUND(COALESCE(ps.total_paid_amount, 0.00) - COALESCE(als.total_allocated_amount, 0.00), 2) AS unallocated_advances,
    ROUND(
        (COALESCE(bs.total_billed_amount, 0.00) - COALESCE(als.total_allocated_amount, 0.00)) - 
        (COALESCE(ps.total_paid_amount, 0.00) - COALESCE(als.total_allocated_amount, 0.00)), 
        2
    ) AS net_payable_balance
FROM parties p
LEFT JOIN bill_summary bs ON p.id = bs.supplier_id
LEFT JOIN payment_summary ps ON p.id = ps.supplier_id
LEFT JOIN allocation_summary als ON p.id = als.supplier_id
WHERE p.party_type IN ('supplier', 'both');

-- Function: Atomic Supplier Payment Allocation
CREATE OR REPLACE FUNCTION fn_allocate_supplier_payment(
    p_payment_id UUID,
    p_bill_id UUID,
    p_amount NUMERIC(15, 2),
    p_user_id UUID
)
RETURNS UUID AS $$
DECLARE
    v_payment RECORD;
    v_bill RECORD;
    v_already_allocated NUMERIC(15, 2);
    v_unallocated NUMERIC(15, 2);
    v_bill_paid NUMERIC(15, 2);
    v_bill_outstanding NUMERIC(15, 2);
    v_alloc_id UUID;
BEGIN
    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Allocation Error: Allocation amount must be strictly greater than 0.';
    END IF;

    -- Lock and validate supplier payment
    SELECT * INTO v_payment 
    FROM supplier_payments 
    WHERE id = p_payment_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Allocation Error: Supplier payment % not found.', p_payment_id;
    END IF;

    IF v_payment.status <> 'posted' THEN
        RAISE EXCEPTION 'Allocation Error: Payment % is in status "%" (must be "posted").', 
            v_payment.payment_number, v_payment.status;
    END IF;

    -- Lock and validate purchase bill
    SELECT * INTO v_bill 
    FROM purchase_bills 
    WHERE id = p_bill_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Allocation Error: Purchase bill % not found.', p_bill_id;
    END IF;

    IF v_bill.status <> 'received' THEN
        RAISE EXCEPTION 'Allocation Error: Purchase bill % is not in "received" status.', v_bill.bill_number;
    END IF;

    IF v_bill.supplier_id <> v_payment.supplier_id THEN
        RAISE EXCEPTION 'Allocation Error: Supplier mismatch. Payment supplier (%) does not match bill supplier (%).',
            v_payment.supplier_id, v_bill.supplier_id;
    END IF;

    -- Calculate payment available unallocated balance
    SELECT COALESCE(SUM(allocated_amount), 0.00) INTO v_already_allocated
    FROM supplier_payment_allocations
    WHERE supplier_payment_id = p_payment_id AND status = 'active';

    v_unallocated := v_payment.total_amount - v_already_allocated;

    IF p_amount > v_unallocated THEN
        RAISE EXCEPTION 'Allocation Error: Requested allocation (₹%) exceeds payment available unallocated balance (₹%).',
            p_amount, v_unallocated;
    END IF;

    -- Calculate bill outstanding balance
    SELECT COALESCE(SUM(allocated_amount), 0.00) INTO v_bill_paid
    FROM supplier_payment_allocations
    WHERE purchase_bill_id = p_bill_id AND status = 'active';

    v_bill_outstanding := v_bill.total_amount - v_bill_paid;

    IF p_amount > v_bill_outstanding THEN
        RAISE EXCEPTION 'Allocation Error: Requested allocation (₹%) exceeds purchase bill outstanding balance (₹%).',
            p_amount, v_bill_outstanding;
    END IF;

    -- Insert or update allocation
    INSERT INTO supplier_payment_allocations (
        supplier_payment_id,
        purchase_bill_id,
        allocated_amount,
        allocated_by,
        status
    ) VALUES (
        p_payment_id,
        p_bill_id,
        p_amount,
        p_user_id,
        'active'
    )
    ON CONFLICT (supplier_payment_id, purchase_bill_id)
    DO UPDATE SET 
        allocated_amount = supplier_payment_allocations.allocated_amount + EXCLUDED.allocated_amount,
        allocated_at = NOW(),
        status = 'active',
        reversed_at = NULL,
        reversed_by = NULL,
        reversal_reason = NULL
    RETURNING id INTO v_alloc_id;

    RETURN v_alloc_id;
END;
$$ LANGUAGE plpgsql;

-- Function: Atomic Supplier Payment Reversal
CREATE OR REPLACE FUNCTION fn_reverse_supplier_payment(
    p_payment_id UUID,
    p_user_id UUID,
    p_reason TEXT
)
RETURNS VOID AS $$
DECLARE
    v_payment RECORD;
BEGIN
    IF p_reason IS NULL OR TRIM(p_reason) = '' THEN
        RAISE EXCEPTION 'Reversal Error: Reversal reason is mandatory.';
    END IF;

    SELECT * INTO v_payment 
    FROM supplier_payments 
    WHERE id = p_payment_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Reversal Error: Supplier payment % not found.', p_payment_id;
    END IF;

    IF v_payment.status <> 'posted' THEN
        RAISE EXCEPTION 'Reversal Error: Only posted payments can be reversed. Current status is "%".', v_payment.status;
    END IF;

    -- Deactivate all active allocations
    UPDATE supplier_payment_allocations
    SET status = 'reversed',
        reversed_at = NOW(),
        reversed_by = p_user_id,
        reversal_reason = TRIM(p_reason)
    WHERE supplier_payment_id = p_payment_id AND status = 'active';

    -- Mark payment as reversed
    UPDATE supplier_payments
    SET status = 'reversed',
        reversed_at = NOW(),
        reversed_by = p_user_id,
        reversal_reason = TRIM(p_reason),
        updated_at = NOW()
    WHERE id = p_payment_id;
END;
$$ LANGUAGE plpgsql;

-- Immutability triggers for supplier payments
CREATE OR REPLACE FUNCTION fn_prevent_posted_supplier_payment_modification()
RETURNS TRIGGER AS $$
BEGIN
    IF current_setting('session_replication_role', true) = 'replica' THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;

    IF TG_OP = 'DELETE' THEN
        IF OLD.status IN ('posted', 'reversed') THEN
            RAISE EXCEPTION 'Statutory Audit Violation: Posted supplier payment % is immutable and cannot be deleted.',
                OLD.payment_number;
        END IF;
        RETURN OLD;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF OLD.status = 'reversed' THEN
            RAISE EXCEPTION 'Statutory Audit Violation: Reversed supplier payment % cannot be modified.',
                OLD.payment_number;
        END IF;

        IF OLD.status = 'posted' THEN
            IF NEW.status = 'reversed' THEN
                IF NEW.total_amount <> OLD.total_amount OR 
                   NEW.supplier_id <> OLD.supplier_id OR 
                   NEW.payment_number <> OLD.payment_number THEN
                    RAISE EXCEPTION 'Statutory Audit Violation: Financial terms of posted payment % cannot be altered during reversal.',
                        OLD.payment_number;
                END IF;
                RETURN NEW;
            ELSE
                RAISE EXCEPTION 'Statutory Audit Violation: Posted supplier payment % is immutable. Reversals must be executed via official reversal workflow.',
                    OLD.payment_number;
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_posted_supplier_payment_modify ON supplier_payments;
CREATE TRIGGER trg_prevent_posted_supplier_payment_modify
BEFORE UPDATE OR DELETE ON supplier_payments
FOR EACH ROW EXECUTE FUNCTION fn_prevent_posted_supplier_payment_modification();

DROP TRIGGER IF EXISTS trg_audit_supplier_payments ON supplier_payments;
CREATE TRIGGER trg_audit_supplier_payments
AFTER INSERT OR UPDATE OR DELETE ON supplier_payments
FOR EACH ROW EXECUTE FUNCTION fn_log_entity_audit_trail();

DROP TRIGGER IF EXISTS trg_audit_supplier_payment_allocations ON supplier_payment_allocations;
CREATE TRIGGER trg_audit_supplier_payment_allocations
AFTER INSERT OR UPDATE OR DELETE ON supplier_payment_allocations
FOR EACH ROW EXECUTE FUNCTION fn_log_entity_audit_trail();

-- ----------------------------------------------------------------------------
-- 2. MULTI-WAREHOUSE MANAGEMENT & STOCK TRANSFERS
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS warehouses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_code VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    address TEXT,
    city VARCHAR(50),
    state_code VARCHAR(10),
    is_primary BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed default primary warehouse for existing benchmark inventory
INSERT INTO warehouses (id, warehouse_code, name, city, state_code, is_primary, is_active)
VALUES ('ee000001-0000-0000-0000-000000000001', 'WH-MAIN', 'Main Plant Central Warehouse', 'Tiruchirappalli', '33', true, true)
ON CONFLICT (warehouse_code) DO NOTHING;

-- Seed secondary satellite warehouse for transfers
INSERT INTO warehouses (id, warehouse_code, name, city, state_code, is_primary, is_active)
VALUES ('ee000002-0000-0000-0000-000000000002', 'WH-DISP-01', 'Chennai Regional Distribution Hub', 'Chennai', '33', false, true)
ON CONFLICT (warehouse_code) DO NOTHING;

-- Add warehouse_id to inventory_ledger
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'inventory_ledger' AND column_name = 'warehouse_id'
    ) THEN
        SET session_replication_role = 'replica';
        ALTER TABLE inventory_ledger 
        ADD COLUMN warehouse_id UUID REFERENCES warehouses(id) ON DELETE RESTRICT DEFAULT 'ee000001-0000-0000-0000-000000000001';
        SET session_replication_role = 'origin';
    END IF;
END $$;

-- Stock Transfers table
CREATE TABLE IF NOT EXISTS warehouse_transfers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transfer_number VARCHAR(50) UNIQUE NOT NULL,
    source_warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    destination_warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    transfer_date DATE NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'requested' CHECK (status IN (
        'draft', 'requested', 'approved', 'in_transit', 'received', 'cancelled'
    )),
    requested_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    approved_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    approved_at TIMESTAMPTZ,
    dispatched_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    dispatched_at TIMESTAMPTZ,
    received_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    received_at TIMESTAMPTZ,
    cancelled_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    cancelled_at TIMESTAMPTZ,
    cancellation_reason TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_different_warehouses CHECK (source_warehouse_id <> destination_warehouse_id)
);

CREATE INDEX IF NOT EXISTS idx_wt_source_wh ON warehouse_transfers (source_warehouse_id);
CREATE INDEX IF NOT EXISTS idx_wt_dest_wh ON warehouse_transfers (destination_warehouse_id);
CREATE INDEX IF NOT EXISTS idx_wt_status ON warehouse_transfers (status);

CREATE TABLE IF NOT EXISTS warehouse_transfer_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transfer_id UUID NOT NULL REFERENCES warehouse_transfers(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
    batch_number VARCHAR(50),
    requested_qty NUMERIC(14, 4) NOT NULL CHECK (requested_qty > 0),
    dispatched_qty NUMERIC(14, 4) NOT NULL DEFAULT 0.0000 CHECK (dispatched_qty >= 0),
    received_qty NUMERIC(14, 4) NOT NULL DEFAULT 0.0000 CHECK (received_qty >= 0),
    uom_id VARCHAR(10) NOT NULL REFERENCES units_of_measure(id),
    base_quantity NUMERIC(14, 4) NOT NULL,
    unit_cost NUMERIC(12, 4) NOT NULL DEFAULT 0.0000,
    total_cost NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wti_transfer_id ON warehouse_transfer_items (transfer_id);
CREATE INDEX IF NOT EXISTS idx_wti_item_id ON warehouse_transfer_items (item_id);

-- Add warehouse_transfer_item_id to inventory_ledger
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'inventory_ledger' AND column_name = 'warehouse_transfer_item_id'
    ) THEN
        ALTER TABLE inventory_ledger 
        ADD COLUMN warehouse_transfer_item_id UUID REFERENCES warehouse_transfer_items(id) ON DELETE RESTRICT;
    END IF;
END $$;

-- Expand inventory_ledger movement_type and source check constraints
DO $$
BEGIN
    ALTER TABLE inventory_ledger DROP CONSTRAINT IF EXISTS inventory_ledger_movement_type_check;
    ALTER TABLE inventory_ledger ADD CONSTRAINT inventory_ledger_movement_type_check 
    CHECK (movement_type IN (
        'OPENING_BALANCE',
        'PURCHASE_RECEIPT',
        'PRODUCTION_ISSUE',
        'PRODUCTION_YIELD',
        'SALES_DISPATCH',
        'SALES_RETURN',
        'STOCK_ADJUSTMENT',
        'WAREHOUSE_TRANSFER_OUT',
        'WAREHOUSE_TRANSFER_IN'
    ));

    ALTER TABLE inventory_ledger DROP CONSTRAINT IF EXISTS chk_source_integrity;
    ALTER TABLE inventory_ledger ADD CONSTRAINT chk_source_integrity CHECK (
        (movement_type = 'OPENING_BALANCE' AND purchase_bill_item_id IS NULL AND production_run_input_id IS NULL AND production_run_yield_id IS NULL AND dispatch_item_id IS NULL AND stock_adjustment_id IS NULL AND warehouse_transfer_item_id IS NULL)
        OR
        (movement_type = 'PURCHASE_RECEIPT' AND purchase_bill_item_id IS NOT NULL AND production_run_input_id IS NULL AND production_run_yield_id IS NULL AND dispatch_item_id IS NULL AND stock_adjustment_id IS NULL AND warehouse_transfer_item_id IS NULL)
        OR
        (movement_type = 'PRODUCTION_ISSUE' AND production_run_input_id IS NOT NULL AND purchase_bill_item_id IS NULL AND production_run_yield_id IS NULL AND dispatch_item_id IS NULL AND stock_adjustment_id IS NULL AND warehouse_transfer_item_id IS NULL)
        OR
        (movement_type = 'PRODUCTION_YIELD' AND production_run_yield_id IS NOT NULL AND purchase_bill_item_id IS NULL AND production_run_input_id IS NULL AND dispatch_item_id IS NULL AND stock_adjustment_id IS NULL AND warehouse_transfer_item_id IS NULL)
        OR
        (movement_type = 'SALES_DISPATCH' AND dispatch_item_id IS NOT NULL AND purchase_bill_item_id IS NULL AND production_run_input_id IS NULL AND production_run_yield_id IS NULL AND stock_adjustment_id IS NULL AND warehouse_transfer_item_id IS NULL)
        OR
        (movement_type = 'STOCK_ADJUSTMENT' AND stock_adjustment_id IS NOT NULL AND purchase_bill_item_id IS NULL AND production_run_input_id IS NULL AND production_run_yield_id IS NULL AND dispatch_item_id IS NULL AND warehouse_transfer_item_id IS NULL)
        OR
        (movement_type = 'WAREHOUSE_TRANSFER_OUT' AND warehouse_transfer_item_id IS NOT NULL AND purchase_bill_item_id IS NULL AND production_run_input_id IS NULL AND production_run_yield_id IS NULL AND dispatch_item_id IS NULL AND stock_adjustment_id IS NULL)
        OR
        (movement_type = 'WAREHOUSE_TRANSFER_IN' AND warehouse_transfer_item_id IS NOT NULL AND purchase_bill_item_id IS NULL AND production_run_input_id IS NULL AND production_run_yield_id IS NULL AND dispatch_item_id IS NULL AND stock_adjustment_id IS NULL)
    );

    ALTER TABLE inventory_ledger DROP CONSTRAINT IF EXISTS chk_inventory_movement_sign;
    ALTER TABLE inventory_ledger ADD CONSTRAINT chk_inventory_movement_sign CHECK (
        (movement_type IN ('OPENING_BALANCE', 'PURCHASE_RECEIPT', 'PRODUCTION_YIELD', 'SALES_RETURN', 'WAREHOUSE_TRANSFER_IN') AND base_quantity_delta >= 0)
        OR
        (movement_type IN ('PRODUCTION_ISSUE', 'SALES_DISPATCH', 'WAREHOUSE_TRANSFER_OUT') AND base_quantity_delta <= 0)
        OR
        (movement_type = 'STOCK_ADJUSTMENT')
    );
END $$;

-- View: Warehouse Stock Balances
CREATE OR REPLACE VIEW v_warehouse_stock AS
SELECT 
    w.id AS warehouse_id,
    w.warehouse_code,
    w.name AS warehouse_name,
    w.is_primary,
    i.id AS item_id,
    i.sku,
    i.name AS item_name,
    i.item_type,
    i.base_uom_id,
    COALESCE(SUM(il.base_quantity_delta), 0.0000) AS current_stock_qty,
    isb.current_moving_wac,
    ROUND(COALESCE(SUM(il.base_quantity_delta), 0.0000) * isb.current_moving_wac, 2) AS warehouse_stock_valuation
FROM warehouses w
CROSS JOIN items i
LEFT JOIN inventory_ledger il ON w.id = il.warehouse_id AND i.id = il.item_id
JOIN item_stock_balances isb ON i.id = isb.item_id
WHERE w.is_active = true AND i.is_active = true
GROUP BY w.id, w.warehouse_code, w.name, w.is_primary, i.id, i.sku, i.name, i.item_type, i.base_uom_id, isb.current_moving_wac;

-- ----------------------------------------------------------------------------
-- 3. BATCH, LOT & EXPIRY TRACKING (FEFO)
-- ----------------------------------------------------------------------------

-- View: Batch-Level Inventory Balances & Expiry Tracking
CREATE OR REPLACE VIEW v_batch_stock AS
SELECT 
    il.item_id,
    i.sku,
    i.name AS item_name,
    i.item_type,
    i.base_uom_id,
    il.batch_number,
    il.expiry_date,
    il.warehouse_id,
    w.warehouse_code,
    w.name AS warehouse_name,
    COALESCE(SUM(il.base_quantity_delta), 0.0000) AS available_qty,
    isb.current_moving_wac AS unit_cost,
    ROUND(COALESCE(SUM(il.base_quantity_delta), 0.0000) * isb.current_moving_wac, 2) AS batch_valuation,
    CASE 
        WHEN il.expiry_date IS NOT NULL THEN (il.expiry_date - CURRENT_DATE)
        ELSE NULL 
    END AS days_to_expiry,
    CASE 
        WHEN il.expiry_date IS NOT NULL AND il.expiry_date < CURRENT_DATE THEN true 
        ELSE false 
    END AS is_expired,
    CASE 
        WHEN il.expiry_date IS NOT NULL AND il.expiry_date >= CURRENT_DATE AND (il.expiry_date - CURRENT_DATE) <= 30 THEN true 
        ELSE false 
    END AS is_near_expiry
FROM inventory_ledger il
JOIN items i ON il.item_id = i.id
JOIN warehouses w ON il.warehouse_id = w.id
JOIN item_stock_balances isb ON i.id = isb.item_id
WHERE il.batch_number IS NOT NULL
GROUP BY il.item_id, i.sku, i.name, i.item_type, i.base_uom_id, il.batch_number, il.expiry_date, 
         il.warehouse_id, w.warehouse_code, w.name, isb.current_moving_wac
HAVING COALESCE(SUM(il.base_quantity_delta), 0.0000) > 0;

-- ----------------------------------------------------------------------------
-- 4. INVENTORY ADJUSTMENTS & WRITE-OFF WORKFLOWS
-- ----------------------------------------------------------------------------

-- Enhance stock_adjustments table
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'stock_adjustments' AND column_name = 'status'
    ) THEN
        ALTER TABLE stock_adjustments 
        ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'posted' 
        CHECK (status IN ('draft', 'approved', 'posted', 'rejected'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'stock_adjustments' AND column_name = 'adjustment_type'
    ) THEN
        ALTER TABLE stock_adjustments 
        ADD COLUMN adjustment_type VARCHAR(30) NOT NULL DEFAULT 'physical_count' 
        CHECK (adjustment_type IN ('physical_count', 'damage_write_off', 'expiry_write_off', 'scrap', 'sampling'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'stock_adjustments' AND column_name = 'batch_number'
    ) THEN
        ALTER TABLE stock_adjustments ADD COLUMN batch_number VARCHAR(50);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'stock_adjustments' AND column_name = 'warehouse_id'
    ) THEN
        ALTER TABLE stock_adjustments 
        ADD COLUMN warehouse_id UUID REFERENCES warehouses(id) DEFAULT 'ee000001-0000-0000-0000-000000000001';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'stock_adjustments' AND column_name = 'unit_cost'
    ) THEN
        ALTER TABLE stock_adjustments ADD COLUMN unit_cost NUMERIC(12, 4) NOT NULL DEFAULT 0.0000;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'stock_adjustments' AND column_name = 'total_cost'
    ) THEN
        ALTER TABLE stock_adjustments ADD COLUMN total_cost NUMERIC(14, 2) NOT NULL DEFAULT 0.00;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'stock_adjustments' AND column_name = 'posted_at'
    ) THEN
        ALTER TABLE stock_adjustments ADD COLUMN posted_at TIMESTAMPTZ;
    END IF;
END $$;

-- Function: Atomic Stock Adjustment Posting
CREATE OR REPLACE FUNCTION fn_post_stock_adjustment(
    p_adjustment_id UUID,
    p_user_id UUID
)
RETURNS VOID AS $$
DECLARE
    v_adj RECORD;
    v_bal RECORD;
    v_item RECORD;
    v_unit_cost NUMERIC(12, 4);
    v_total_cost NUMERIC(14, 2);
    v_delta NUMERIC(14, 4);
BEGIN
    SELECT * INTO v_adj 
    FROM stock_adjustments 
    WHERE id = p_adjustment_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Stock adjustment % not found.', p_adjustment_id;
    END IF;

    IF v_adj.status = 'posted' THEN
        RAISE EXCEPTION 'Stock adjustment % is already posted.', v_adj.adjustment_number;
    END IF;

    SELECT * INTO v_item FROM items WHERE id = v_adj.item_id;

    -- Lock stock balance
    SELECT * INTO v_bal 
    FROM item_stock_balances 
    WHERE item_id = v_adj.item_id 
    FOR UPDATE;

    v_delta := v_adj.discrepancy_quantity;
    v_unit_cost := v_bal.current_moving_wac;
    v_total_cost := ROUND(ABS(v_delta) * v_unit_cost, 2);

    IF v_delta < 0 AND (v_bal.current_base_qty + v_delta) < 0 THEN
        RAISE EXCEPTION 'Stock adjustment rejected: Insufficient stock. Current stock (%) cannot support adjustment reduction (%).',
            v_bal.current_base_qty, ABS(v_delta);
    END IF;

    -- Insert into immutable inventory ledger
    INSERT INTO inventory_ledger (
        item_id,
        warehouse_id,
        batch_number,
        movement_type,
        transaction_qty,
        transaction_uom_id,
        base_quantity_delta,
        unit_cost,
        total_cost,
        stock_adjustment_id,
        source_reference_label,
        created_by
    ) VALUES (
        v_adj.item_id,
        COALESCE(v_adj.warehouse_id, 'ee000001-0000-0000-0000-000000000001'),
        v_adj.batch_number,
        'STOCK_ADJUSTMENT',
        ABS(v_delta),
        v_item.base_uom_id,
        v_delta,
        v_unit_cost,
        v_total_cost,
        v_adj.id,
        v_adj.adjustment_number,
        p_user_id
    );

    -- Update real-time balance
    UPDATE item_stock_balances
    SET current_base_qty = current_base_qty + v_delta,
        current_total_value = ROUND((current_base_qty + v_delta) * current_moving_wac, 2),
        last_transaction_timestamp = NOW(),
        updated_at = NOW()
    WHERE item_id = v_adj.item_id;

    -- Update adjustment status
    UPDATE stock_adjustments
    SET status = 'posted',
        unit_cost = v_unit_cost,
        total_cost = v_total_cost,
        posted_at = NOW()
    WHERE id = p_adjustment_id;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 5. EMPLOYEE & PAYROLL MANAGEMENT (CONTROLLED SCOPE)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS employees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_code VARCHAR(20) UNIQUE NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    department VARCHAR(50) NOT NULL,
    designation VARCHAR(50) NOT NULL,
    joining_date DATE NOT NULL,
    base_salary NUMERIC(12, 2) NOT NULL CHECK (base_salary > 0),
    bank_account_number VARCHAR(50),
    bank_ifsc VARCHAR(20),
    pan_number VARCHAR(20),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payroll_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payroll_period VARCHAR(7) UNIQUE NOT NULL, -- e.g. '2026-11'
    run_date DATE NOT NULL,
    total_gross_salary NUMERIC(15, 2) NOT NULL DEFAULT 0.00 CHECK (total_gross_salary >= 0),
    total_deductions NUMERIC(15, 2) NOT NULL DEFAULT 0.00 CHECK (total_deductions >= 0),
    total_net_salary NUMERIC(15, 2) NOT NULL DEFAULT 0.00 CHECK (total_net_salary >= 0),
    status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'paid', 'cancelled')),
    payment_mode VARCHAR(30) CHECK (payment_mode IN ('bank_transfer', 'cheque', 'cash')),
    reference_txn_id VARCHAR(100),
    approved_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    approved_at TIMESTAMPTZ,
    paid_at TIMESTAMPTZ,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payroll_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payroll_run_id UUID NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
    basic_salary NUMERIC(12, 2) NOT NULL,
    allowances NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    deductions NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    net_salary NUMERIC(12, 2) NOT NULL,
    present_days INT NOT NULL DEFAULT 30,
    absent_days INT NOT NULL DEFAULT 0,
    notes TEXT,
    CONSTRAINT uq_payroll_employee UNIQUE (payroll_run_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_pi_payroll_run_id ON payroll_items (payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_pi_employee_id ON payroll_items (employee_id);

-- ----------------------------------------------------------------------------
-- 6. CHART OF ACCOUNTS & JOURNAL ENTRIES INTEGRATION
-- ----------------------------------------------------------------------------

-- Add additional standard accounts
INSERT INTO chart_of_accounts (account_code, account_name, account_type, category, normal_balance, description, is_system)
VALUES 
    ('2400', 'Salaries & Wages Payable', 'liability', 'payroll_liability', 'credit', 'Accrued employee compensation payable', true),
    ('6450', 'Inventory Write-Off & Stock Loss', 'expense', 'operating_expense', 'debit', 'Losses from damaged, expired, or missing physical inventory', true)
ON CONFLICT (account_code) DO NOTHING;

-- Expand journal_entries.source_type check constraint
DO $$
BEGIN
    ALTER TABLE journal_entries DROP CONSTRAINT IF EXISTS journal_entries_source_type_check;
    ALTER TABLE journal_entries ADD CONSTRAINT journal_entries_source_type_check 
    CHECK (source_type IN (
        'PURCHASE_BILL',
        'SALES_INVOICE',
        'SALES_DISPATCH',
        'PRODUCTION_RUN',
        'CUSTOMER_PAYMENT',
        'PAYMENT_REVERSAL',
        'SUPPLIER_PAYMENT',
        'SUPPLIER_PAYMENT_REVERSAL',
        'STOCK_ADJUSTMENT',
        'PAYROLL_RUN',
        'PAYROLL_PAYMENT',
        'MANUAL'
    ));
END $$;


-- ==========================================
-- database/seeds/benchmark_seed.sql
-- ==========================================
-- ============================================================================
-- ORDER-TO-AUDIT SYSTEM: BENCHMARK SEED DATA SCRIPT
-- Executes NIT Tiruchirappalli Internship Benchmark Scenario
-- Uses Transactional Posting Functions & Strict Moving WAC
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 0. IDEMPOTENT EXECUTION GUARD
-- Explicitly prevents rerunning the benchmark seed on an already-populated database,
-- which would corrupt the stock balances, moving WAC, and ledger integrity.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM purchase_bills WHERE id = 'ba000001-0000-0000-0000-000000000001') 
       OR EXISTS (SELECT 1 FROM production_runs WHERE id = 'da000001-0000-0000-0000-000000000001') THEN
        RAISE EXCEPTION 'Benchmark Seed Safety Violation: The benchmark scenario has already been seeded in this database. Rerunning this seed without resetting would corrupt the stock ledger and moving WAC. To perform a clean test run, execute database/scripts/dev_reset.sql first.';
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. USERS & ROLES
-- ----------------------------------------------------------------------------
INSERT INTO users (id, username, password_hash, full_name, phone, role) VALUES
('11111111-1111-1111-1111-111111111111', 'salesman_a', '$2b$10$p2ROoxLNDM/h80KoW8Gq0uTIupNy4G50UNGLXAD2wfZleCAJN9ZfW', 'Salesman A (Tamil Nadu)', '9876543210', 'salesman'),
('22222222-2222-2222-2222-222222222222', 'salesman_b', '$2b$10$p2ROoxLNDM/h80KoW8Gq0uTIupNy4G50UNGLXAD2wfZleCAJN9ZfW', 'Salesman B (Karnataka)', '9876543211', 'salesman'),
('33333333-3333-3333-3333-333333333333', 'admin_factory', '$2b$10$p2ROoxLNDM/h80KoW8Gq0uTIupNy4G50UNGLXAD2wfZleCAJN9ZfW', 'Factory Admin Desk', '9876543212', 'factory_admin'),
('44444444-4444-4444-4444-444444444444', 'supervisor_floor', '$2b$10$p2ROoxLNDM/h80KoW8Gq0uTIupNy4G50UNGLXAD2wfZleCAJN9ZfW', 'Floor Supervisor', '9876543213', 'production_supervisor'),
('55555555-5555-5555-5555-555555555555', 'auditor_ext', '$2b$10$p2ROoxLNDM/h80KoW8Gq0uTIupNy4G50UNGLXAD2wfZleCAJN9ZfW', 'Statutory Auditor', '9876543214', 'auditor'),
('66666666-6666-6666-6666-666666666666', 'owner_main', '$2b$10$p2ROoxLNDM/h80KoW8Gq0uTIupNy4G50UNGLXAD2wfZleCAJN9ZfW', 'Managing Director', '9876543215', 'owner')
ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash;

-- ----------------------------------------------------------------------------
-- 2. UNITS OF MEASURE
-- ----------------------------------------------------------------------------
INSERT INTO units_of_measure (id, name, dimension, base_unit_id, conversion_factor_to_base) VALUES
('KG', 'Kilogram', 'weight', NULL, 1.000000),
('G', 'Gram', 'weight', 'KG', 0.001000),
('L', 'Litre', 'volume', NULL, 1.000000),
('ML', 'Millilitre', 'volume', 'L', 0.001000),
('PCS', 'Piece', 'count', NULL, 1.000000),
('PKT', 'Packet', 'count', NULL, 1.000000),
('CTN', 'Carton', 'packaging', NULL, 1.000000),
('BAG', '50kg Bag', 'weight', 'KG', 50.000000)
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 3. ITEMS (Master Product and Material Catalog)
-- ----------------------------------------------------------------------------
INSERT INTO items (id, sku, name, item_type, base_uom_id, hsn_code, gst_rate_pct, standard_selling_price, standard_purchase_rate, min_reorder_level, packets_per_carton) VALUES
('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'RM-FLOUR', 'Raw Flour (Besan/Rice mix)', 'raw_material', 'KG', '1101', 5.00, 0.00, 42.00, 20.0000, 1.00),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'RM-OIL', 'Cooking Oil', 'raw_material', 'L', '1507', 5.00, 0.00, 140.00, 10.0000, 1.00),
('cccccccc-cccc-cccc-cccc-cccccccccccc', 'RM-SPICE', 'Salt and Spice Mix', 'raw_material', 'KG', '0910', 5.00, 0.00, 200.00, 2.0000, 1.00),
('dddddddd-dddd-dddd-dddd-dddddddddddd', 'PK-POUCH-200G', 'Printed Pouch 200g', 'packaging', 'PCS', '3923', 5.00, 0.00, 2.50, 100.0000, 1.00),
('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'PK-CARTON-20', 'Shipping Carton (Holds 20 Packets)', 'packaging', 'PCS', '4819', 5.00, 0.00, 15.00, 10.0000, 1.00),
('ffffffff-ffff-ffff-ffff-ffffffffffff', 'FG-MRK-200G', 'Murukku 200g Packet', 'finished_good', 'PKT', '1905', 5.00, 50.00, 30.00, 50.0000, 20.00)
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 4. PARTIES (Customers & Suppliers)
-- ----------------------------------------------------------------------------
INSERT INTO parties (id, party_type, trade_name, contact_person, phone, email, gstin, state_code, state_name, billing_address, credit_limit) VALUES
('77777777-7777-7777-7777-777777777777', 'customer', 'Retailer A', 'Senthil Nathan', '9840112233', 'retailer_a@madurai.com', '33AAAAA1111A1Z1', '33', 'Tamil Nadu', '12 Bazaar St, Madurai, Tamil Nadu', 15000.00),
('88888888-8888-8888-8888-888888888888', 'customer', 'Distributor B', 'Ramesh Rao', '9880223344', 'distributor_b@bengaluru.com', '29BBBBB2222B1Z2', '29', 'Karnataka', '45 Ring Road, Bengaluru, Karnataka', 50000.00),
('99999999-9999-9999-9999-999999999999', 'supplier', 'Trichy Agro Supplies', 'M. Ramanathan', '9443112233', 'orders@trichyagro.com', '33CCCCC3333C1Z3', '33', 'Tamil Nadu', '88 Goods Shed Road, Tiruchirappalli, Tamil Nadu', 0.00)
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 5. BILL OF MATERIALS (BOM) FOR MURUKKU 200G
-- Standard Batch Size = 200 Packets
-- ----------------------------------------------------------------------------
INSERT INTO boms (id, finished_good_item_id, bom_code, version_number, standard_batch_size, batch_uom_id, tolerance_variance_pct, is_active, effective_from, created_by) VALUES
('b0000001-0000-0000-0000-000000000001', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'BOM-MRK-200G', 1, 200.0000, 'PKT', 3.00, true, '2026-04-01', '33333333-3333-3333-3333-333333333333')
ON CONFLICT (id) DO NOTHING;

INSERT INTO bom_items (bom_id, item_id, standard_qty, uom_id) VALUES
('b0000001-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 40.0000, 'KG'),
('b0000001-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 10.0000, 'L'),
('b0000001-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 1.2000, 'KG'),
('b0000001-0000-0000-0000-000000000001', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 200.0000, 'PCS'),
('b0000001-0000-0000-0000-000000000001', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 10.0000, 'PCS')
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 6. OPENING STOCK INITIALIZATION
-- Explicit documented assumption: Opening finished goods valued at ₹30.00/pkt
-- ----------------------------------------------------------------------------
INSERT INTO item_stock_balances (item_id, current_base_qty, current_moving_wac, current_total_value) VALUES
('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 100.0000, 42.0000, 4200.00),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 30.0000, 140.0000, 4200.00),
('cccccccc-cccc-cccc-cccc-cccccccccccc', 5.0000, 200.0000, 1000.00),
('dddddddd-dddd-dddd-dddd-dddddddddddd', 500.0000, 2.5000, 1250.00),
('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 30.0000, 15.0000, 450.00),
('ffffffff-ffff-ffff-ffff-ffffffffffff', 50.0000, 30.0000, 1500.00)
ON CONFLICT (item_id) DO UPDATE SET
    current_base_qty = EXCLUDED.current_base_qty,
    current_moving_wac = EXCLUDED.current_moving_wac,
    current_total_value = EXCLUDED.current_total_value;

INSERT INTO inventory_ledger (
    transaction_timestamp, item_id, batch_number, movement_type, 
    transaction_qty, transaction_uom_id, base_quantity_delta, unit_cost, total_cost,
    source_reference_label, created_by
) VALUES
('2026-11-01 08:00:00+05:30', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'OB-20261101', 'OPENING_BALANCE', 100.0000, 'KG', 100.0000, 42.0000, 4200.00, 'OPENING-STOCK-SETUP', '33333333-3333-3333-3333-333333333333'),
('2026-11-01 08:00:00+05:30', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'OB-20261101', 'OPENING_BALANCE', 30.0000, 'L', 30.0000, 140.0000, 4200.00, 'OPENING-STOCK-SETUP', '33333333-3333-3333-3333-333333333333'),
('2026-11-01 08:00:00+05:30', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'OB-20261101', 'OPENING_BALANCE', 5.0000, 'KG', 5.0000, 200.0000, 1000.00, 'OPENING-STOCK-SETUP', '33333333-3333-3333-3333-333333333333'),
('2026-11-01 08:00:00+05:30', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'OB-20261101', 'OPENING_BALANCE', 500.0000, 'PCS', 500.0000, 2.5000, 1250.00, 'OPENING-STOCK-SETUP', '33333333-3333-3333-3333-333333333333'),
('2026-11-01 08:00:00+05:30', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'OB-20261101', 'OPENING_BALANCE', 30.0000, 'PCS', 30.0000, 15.0000, 450.00, 'OPENING-STOCK-SETUP', '33333333-3333-3333-3333-333333333333'),
('2026-11-01 08:00:00+05:30', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'OB-MRK-01', 'OPENING_BALANCE', 50.0000, 'PKT', 50.0000, 30.0000, 1500.00, 'OPENING-STOCK-SETUP', '33333333-3333-3333-3333-333333333333');

-- ============================================================================
-- BENCHMARK STEP 1: PURCHASE 60 KG FLOUR @ ₹45/KG
-- ============================================================================
-- BENCHMARK STEP 1: PURCHASE 60 KG FLOUR @ ₹45/KG
-- ============================================================================
INSERT INTO purchase_bills (
    id, supplier_id, bill_number, bill_date, subtotal_amount, cgst_amount, sgst_amount, total_amount, status, received_by
) VALUES (
    'ba000001-0000-0000-0000-000000000001',
    '99999999-9999-9999-9999-999999999999',
    'INV-TRICHY-842',
    '2026-11-10',
    2700.00, 67.50, 67.50, 2835.00,
    'draft',
    '33333333-3333-3333-3333-333333333333'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO purchase_bill_items (
    id, purchase_bill_id, item_id, supplier_batch_no, quantity, uom_id, base_quantity, unit_rate, taxable_amount, gst_rate_pct, tax_amount, total_amount
) VALUES (
    'ba000011-0000-0000-0000-000000000001',
    'ba000001-0000-0000-0000-000000000001',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'FLOUR-LOT-902',
    60.0000, 'KG', 60.0000, 45.00, 2700.00, 5.00, 135.00, 2835.00
) ON CONFLICT (id) DO NOTHING;

-- Execute atomic receipt posting (Updates Flour WAC to ₹43.1250/kg and stock to 160 kg)
SELECT fn_post_purchase_receipt('ba000001-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333');

-- ============================================================================
-- BENCHMARK STEP 2 & 3: PRODUCTION RUN OF MURUKKU 200G
-- Standard Batch Size: 200 pkts. Actual Output: 188 good pkts.
-- Damaged Pouches: 6. Cartons used: 9.
-- ============================================================================
INSERT INTO production_runs (
    id, run_number, bom_id, finished_good_item_id, output_batch_number, run_date,
    planned_batch_count, standard_batch_size, planned_yield_qty, actual_good_output_qty, actual_scrap_output_qty,
    yield_variance_pct, is_yield_flagged, status, supervisor_id
) VALUES (
    'da000001-0000-0000-0000-000000000001',
    'PR-2026-11-001',
    'b0000001-0000-0000-0000-000000000001',
    'ffffffff-ffff-ffff-ffff-ffffffffffff',
    'BAT-MRK-20261119-01',
    '2026-11-19',
    1.00, 200.0000, 200.0000, 188.0000, 0.0000,
    -6.00, true, 'draft', '44444444-4444-4444-4444-444444444444'
) ON CONFLICT (id) DO NOTHING;

-- Inputs: Tracks Issued, Good Production, Damaged Scrap, and Returns
INSERT INTO production_run_inputs (
    id, production_run_id, item_id, planned_qty, actual_issued_qty, good_production_qty, damaged_or_scrap_qty, returned_to_store_qty,
    uom_id, base_net_consumed_qty, unit_cost_applied, total_material_cost, consumption_variance_qty, consumption_variance_pct, is_consumption_flagged
) VALUES
('da000011-0000-0000-0000-000000000001', 'da000001-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 40.0000, 40.0000, 40.0000, 0.0000, 0.0000, 'KG', 40.0000, 43.1250, 1725.00, 0.0000, 0.00, false),
('da000012-0000-0000-0000-000000000002', 'da000001-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 10.0000, 10.5000, 10.5000, 0.0000, 0.0000, 'L', 10.5000, 140.0000, 1470.00, 0.5000, 5.00, true),
('da000013-0000-0000-0000-000000000003', 'da000001-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 1.2000, 1.2000, 1.2000, 0.0000, 0.0000, 'KG', 1.2000, 200.0000, 240.00, 0.0000, 0.00, false),
('da000014-0000-0000-0000-000000000004', 'da000001-0000-0000-0000-000000000001', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 200.0000, 194.0000, 188.0000, 6.0000, 0.0000, 'PCS', 194.0000, 2.5000, 485.00, -6.0000, -3.00, false),
('da000015-0000-0000-0000-000000000005', 'da000001-0000-0000-0000-000000000001', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 10.0000, 9.0000, 9.0000, 0.0000, 0.0000, 'PCS', 9.0000, 15.0000, 135.00, -1.0000, -10.00, true)
ON CONFLICT (id) DO NOTHING;

-- Overheads for the Run (Labour ₹1,200, Gas/Power ₹600)
INSERT INTO production_run_overheads (id, production_run_id, overhead_type, description, amount) VALUES
('da000021-0000-0000-0000-000000000001', 'da000001-0000-0000-0000-000000000001', 'labour', 'Floor 4-operator batch frying & packaging', 1200.00),
('da000022-0000-0000-0000-000000000002', 'da000001-0000-0000-0000-000000000001', 'power_gas', 'LPG cylinder consumption & fryer motor power', 600.00)
ON CONFLICT (id) DO NOTHING;

-- Execute atomic production issue (Deducts raw & packaging materials, prevents negative stock)
SELECT fn_post_production_issue('da000001-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444');

-- Execute atomic production yield (Posts 188 pkts, updates Finished Goods Moving WAC to ₹30.9034/pkt)
SELECT fn_post_production_yield('da000001-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444');

-- ============================================================================
-- BENCHMARK STEP 4 & 5: SALESMAN A ORDERS 150 PKTS FOR RETAILER A (TAMIL NADU)
-- Admin approves, raises intra-state GST invoice, records dispatch
-- ============================================================================
INSERT INTO sales_orders (
    id, order_number, customer_id, salesman_id, order_date, offline_client_uuid, status,
    subtotal_amount, estimated_tax_amount, total_order_value
) VALUES (
    'ea000001-0000-0000-0000-000000000001',
    'SO-2026-0001',
    '77777777-7777-7777-7777-777777777777',
    '11111111-1111-1111-1111-111111111111',
    '2026-11-19',
    'a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d',
    'approved',
    7500.00, 375.00, 7875.00
) ON CONFLICT (id) DO NOTHING;

INSERT INTO sales_order_items (
    sales_order_id, item_id, item_name_snapshot, hsn_code_snapshot,
    ordered_qty, approved_qty, uom_id, unit_price, gst_rate_pct, taxable_value, total_item_value
) VALUES (
    'ea000001-0000-0000-0000-000000000001',
    'ffffffff-ffff-ffff-ffff-ffffffffffff',
    'Murukku 200g Packet',
    '1905',
    150.0000, 150.0000, 'PKT', 50.00, 5.00, 7500.00, 7875.00
) ON CONFLICT (id) DO NOTHING;

-- GST Tax Invoice (Intra-state: CGST ₹187.50 + SGST ₹187.50 = Total ₹7,875.00)
INSERT INTO invoices (
    id, invoice_number, financial_year, sales_order_id, customer_id, invoice_date,
    place_of_supply_state_code, is_interstate, taxable_value, cgst_amount, sgst_amount, igst_amount,
    total_invoice_value, status, approved_by
) VALUES (
    'fa000001-0000-0000-0000-000000000001',
    'INV/2026-27/0001',
    '2026-2027',
    'ea000001-0000-0000-0000-000000000001',
    '77777777-7777-7777-7777-777777777777',
    '2026-11-19',
    '33', false, 7500.00, 187.50, 187.50, 0.00,
    7875.00, 'draft', '33333333-3333-3333-3333-333333333333'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO invoice_items (
    invoice_id, item_id, item_name_snapshot, hsn_code_snapshot, quantity, uom_id, base_quantity,
    unit_price, taxable_value, gst_rate_pct, cgst_rate_pct, cgst_amount, sgst_rate_pct, sgst_amount,
    igst_rate_pct, igst_amount, total_item_value
) VALUES (
    'fa000001-0000-0000-0000-000000000001',
    'ffffffff-ffff-ffff-ffff-ffffffffffff',
    'Murukku 200g Packet',
    '1905',
    150.0000, 'PKT', 150.0000,
    50.00, 7500.00, 5.00, 2.50, 187.50, 2.50, 187.50,
    0.00, 0.00, 7875.00
) ON CONFLICT (id) DO NOTHING;

UPDATE invoices SET status = 'posted' WHERE id = 'fa000001-0000-0000-0000-000000000001';

-- Dispatch Preparation
INSERT INTO dispatches (
    id, dispatch_number, invoice_id, dispatch_date, carrier_or_vehicle_no, driver_name, status, dispatched_by
) VALUES (
    'eb000001-0000-0000-0000-000000000001',
    'DSP-2026-0001',
    'fa000001-0000-0000-0000-000000000001',
    '2026-11-19',
    'TN-59-AX-4412',
    'K. Velu',
    'ready',
    '33333333-3333-3333-3333-333333333333'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO dispatch_items (
    id, dispatch_id, item_id, batch_number, dispatched_qty, uom_id, base_quantity
) VALUES (
    'ec000001-0000-0000-0000-000000000001',
    'eb000001-0000-0000-0000-000000000001',
    'ffffffff-ffff-ffff-ffff-ffffffffffff',
    'BAT-MRK-20261119-01',
    150.0000, 'PKT', 150.0000
) ON CONFLICT (id) DO NOTHING;

-- Execute atomic dispatch (Finished goods drop from 238 to 88 pkts)
SELECT fn_post_sales_dispatch('eb000001-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333');

-- ============================================================================
-- BENCHMARK STEP 6: SALESMAN B ORDERS 120 PKTS FOR DISTRIBUTOR B (KARNATAKA)
-- Available finished goods: 88 pkts. Shortage of 32 packets flagged!
-- ============================================================================
INSERT INTO sales_orders (
    id, order_number, customer_id, salesman_id, order_date, offline_client_uuid, status,
    subtotal_amount, estimated_tax_amount, total_order_value, notes
) VALUES (
    'ea000002-0000-0000-0000-000000000002',
    'SO-2026-0002',
    '88888888-8888-8888-8888-888888888888',
    '22222222-2222-2222-2222-222222222222',
    '2026-11-19',
    'b2c3d4e5-f6a1-4b2c-9d3e-4f5a6b7c8d9e',
    'submitted',
    6000.00, 300.00, 6300.00,
    'SYSTEM ALERT: Shortage of 32 packets flagged. Current available finished stock is 88 packets.'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO sales_order_items (
    sales_order_id, item_id, item_name_snapshot, hsn_code_snapshot,
    ordered_qty, approved_qty, uom_id, unit_price, gst_rate_pct, taxable_value, total_item_value
) VALUES (
    'ea000002-0000-0000-0000-000000000002',
    'ffffffff-ffff-ffff-ffff-ffffffffffff',
    'Murukku 200g Packet',
    '1905',
    120.0000, NULL, 'PKT', 50.00, 5.00, 6000.00, 6300.00
) ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- BENCHMARK STEP 7: PAYMENT OF ₹4,000 FROM RETAILER A & ALLOCATION
-- ============================================================================
INSERT INTO payments (
    id, receipt_number, customer_id, payment_date, total_amount, payment_mode, reference_txn_id, recorded_by
) VALUES (
    'ed000001-0000-0000-0000-000000000001',
    'REC-2026-0001',
    '77777777-7777-7777-7777-777777777777',
    '2026-11-19',
    4000.00,
    'upi',
    'UPI/20261119/992837461',
    '33333333-3333-3333-3333-333333333333'
) ON CONFLICT (id) DO NOTHING;

-- Allocate ₹4,000 to Retailer A's invoice (Outstanding becomes ₹3,875.00)
SELECT fn_allocate_payment(
    'ed000001-0000-0000-0000-000000000001',
    'fa000001-0000-0000-0000-000000000001',
    4000.00,
    '33333333-3333-3333-3333-333333333333'
);

COMMIT;




-- ==========================================
-- database/migrations/012_sample_products_and_boms.sql
-- ==========================================
-- ============================================================================
-- ORDER-TO-AUDIT SYSTEM: PHASE 12 MIGRATION
-- Sample Products, Comprehensive BOM Recipes, and Opening Master Data
-- 10 Manufactured Snack Products with Real BOM Recipes & Packaging
-- ============================================================================

BEGIN;

-- 1. Add image_url to items if not exists
ALTER TABLE items ADD COLUMN IF NOT EXISTS image_url VARCHAR(500);

-- Update Murukku 200g image
UPDATE items 
SET image_url = '/products/murukku.jpg' 
WHERE id = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

-- ----------------------------------------------------------------------------
-- 2. INSERT 9 NEW FINISHED GOODS ITEMS (Total 10 Sample Products)
-- ----------------------------------------------------------------------------
INSERT INTO items (id, sku, name, item_type, base_uom_id, hsn_code, gst_rate_pct, standard_selling_price, standard_purchase_rate, min_reorder_level, packets_per_carton, image_url) VALUES
('a1000001-0000-0000-0000-000000000001', 'FG-PTC-100G', 'Potato Chips – 100g', 'finished_good', 'PKT', '1905', 5.00, 30.00, 18.00, 50.0000, 40.00, '/products/potato-chips.jpg'),
('a1000002-0000-0000-0000-000000000002', 'FG-BNC-100G', 'Banana Chips – 100g', 'finished_good', 'PKT', '1905', 5.00, 35.00, 20.00, 50.0000, 40.00, '/products/banana-chips.jpg'),
('a1000003-0000-0000-0000-000000000003', 'FG-MIX-200G', 'Mixture – 200g', 'finished_good', 'PKT', '1905', 5.00, 55.00, 32.00, 50.0000, 20.00, '/products/mixture.jpg'),
('a1000004-0000-0000-0000-000000000004', 'FG-RBP-200G', 'Ribbon Pakoda – 200g', 'finished_good', 'PKT', '1905', 5.00, 50.00, 30.00, 50.0000, 20.00, '/products/ribbon-pakoda.jpg'),
('a1000005-0000-0000-0000-000000000005', 'FG-THT-200G', 'Thattai – 200g', 'finished_good', 'PKT', '1905', 5.00, 50.00, 29.00, 50.0000, 20.00, '/products/thattai.jpg'),
('a1000006-0000-0000-0000-000000000006', 'FG-MSC-100G', 'Masala Chips – 100g', 'finished_good', 'PKT', '1905', 5.00, 32.00, 19.00, 50.0000, 40.00, '/products/masala-chips.jpg'),
('a1000007-0000-0000-0000-000000000007', 'FG-KBD-200G', 'Kara Boondi – 200g', 'finished_good', 'PKT', '1905', 5.00, 52.00, 31.00, 50.0000, 20.00, '/products/kara-boondi.jpg'),
('a1000008-0000-0000-0000-000000000008', 'FG-TPC-100G', 'Tapioca Chips – 100g', 'finished_good', 'PKT', '1905', 5.00, 30.00, 17.00, 50.0000, 40.00, '/products/tapioca-chips.jpg'),
('a1000009-0000-0000-0000-000000000009', 'FG-SDA-200G', 'Seedai – 200g', 'finished_good', 'PKT', '1905', 5.00, 55.00, 33.00, 50.0000, 20.00, '/products/seedai.jpg')
ON CONFLICT (id) DO UPDATE SET
    image_url = EXCLUDED.image_url,
    name = EXCLUDED.name,
    standard_selling_price = EXCLUDED.standard_selling_price;

-- ----------------------------------------------------------------------------
-- 3. INSERT NEW RAW MATERIALS & PACKAGING MATERIALS
-- ----------------------------------------------------------------------------
INSERT INTO items (id, sku, name, item_type, base_uom_id, hsn_code, gst_rate_pct, standard_selling_price, standard_purchase_rate, min_reorder_level, packets_per_carton) VALUES
('a2000001-0000-0000-0000-000000000001', 'RM-POTATO', 'Fresh Farm Potatoes', 'raw_material', 'KG', '0701', 0.00, 0.00, 22.00, 50.0000, 1.00),
('a2000002-0000-0000-0000-000000000002', 'RM-BANANA', 'Raw Nendran Bananas', 'raw_material', 'KG', '0803', 0.00, 0.00, 35.00, 50.0000, 1.00),
('a2000003-0000-0000-0000-000000000003', 'RM-TAPIOCA', 'Raw Farm Tapioca / Cassava', 'raw_material', 'KG', '0714', 0.00, 0.00, 18.00, 50.0000, 1.00),
('a2000004-0000-0000-0000-000000000004', 'RM-BESAN', 'Pure Gram Flour (Besan)', 'raw_material', 'KG', '1106', 5.00, 0.00, 75.00, 40.0000, 1.00),
('a2000005-0000-0000-0000-000000000005', 'RM-RICE-FLOUR', 'Fine White Rice Flour', 'raw_material', 'KG', '1102', 5.00, 0.00, 38.00, 40.0000, 1.00),
('a2000006-0000-0000-0000-000000000006', 'RM-URAD-DAL', 'Roasted Urad Dal Flour', 'raw_material', 'KG', '1106', 5.00, 0.00, 110.00, 10.0000, 1.00),
('a2000007-0000-0000-0000-000000000007', 'RM-PEANUT', 'Roasted Groundnuts / Peanuts', 'raw_material', 'KG', '1202', 5.00, 0.00, 130.00, 15.0000, 1.00),
('a2000008-0000-0000-0000-000000000008', 'RM-ROASTED-CHANA', 'Roasted Gram (Pottukadalai)', 'raw_material', 'KG', '1106', 5.00, 0.00, 95.00, 15.0000, 1.00),
('a2000009-0000-0000-0000-000000000009', 'RM-CHILI-POWDER', 'Guntur Red Chili Powder', 'raw_material', 'KG', '0904', 5.00, 0.00, 240.00, 5.0000, 1.00),
('a2000010-0000-0000-0000-000000000010', 'RM-MASALA-MIX', 'Chaat & Masala Seasoning', 'raw_material', 'KG', '0910', 5.00, 0.00, 260.00, 5.0000, 1.00),
('a2000011-0000-0000-0000-000000000011', 'RM-CURRY-HING', 'Curry Leaves & Asafoetida Mix', 'raw_material', 'KG', '0910', 5.00, 0.00, 180.00, 3.0000, 1.00),
('a2000012-0000-0000-0000-000000000012', 'RM-SALT', 'Refined Iodized Salt', 'raw_material', 'KG', '2501', 0.00, 0.00, 15.00, 10.0000, 1.00),
('a2000013-0000-0000-0000-000000000013', 'RM-SESAME-BUTTER', 'White Sesame Seeds & Butter', 'raw_material', 'KG', '1207', 5.00, 0.00, 320.00, 5.0000, 1.00),
('a3000001-0000-0000-0000-000000000001', 'PK-POUCH-100G', 'Printed Metallized Pouch 100g', 'packaging', 'PCS', '3923', 5.00, 0.00, 1.80, 100.0000, 1.00),
('a3000002-0000-0000-0000-000000000002', 'PK-CARTON-40', 'Shipping Carton (Holds 40 Packets)', 'packaging', 'PCS', '4819', 5.00, 0.00, 18.00, 10.0000, 1.00)
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 4. INSERT 9 NEW BILL OF MATERIALS (BOM) HEADERS
-- Standard Batch Size = 200 Packets per Batch
-- ----------------------------------------------------------------------------
INSERT INTO boms (id, finished_good_item_id, bom_code, version_number, standard_batch_size, batch_uom_id, tolerance_variance_pct, is_active, effective_from, created_by, notes) VALUES
('b0000002-0000-0000-0000-000000000002', 'a1000001-0000-0000-0000-000000000001', 'BOM-PTC-100G', 1, 200.0000, 'PKT', 3.00, true, '2026-04-01', '33333333-3333-3333-3333-333333333333', 'Classic Salted Potato Chips (100g Batch = 20kg yield)'),
('b0000003-0000-0000-0000-000000000003', 'a1000002-0000-0000-0000-000000000002', 'BOM-BNC-100G', 1, 200.0000, 'PKT', 3.00, true, '2026-04-01', '33333333-3333-3333-3333-333333333333', 'Golden Kerala Yellow Banana Chips (100g Batch = 20kg yield)'),
('b0000004-0000-0000-0000-000000000004', 'a1000003-0000-0000-0000-000000000003', 'BOM-MIX-200G', 1, 200.0000, 'PKT', 3.00, true, '2026-04-01', '33333333-3333-3333-3333-333333333333', 'Madras Spicy Snack Mixture (200g Batch = 40kg yield)'),
('b0000005-0000-0000-0000-000000000005', 'a1000004-0000-0000-0000-000000000004', 'BOM-RBP-200G', 1, 200.0000, 'PKT', 3.00, true, '2026-04-01', '33333333-3333-3333-3333-333333333333', 'Traditional Ribbon Pakoda (200g Batch = 40kg yield)'),
('b0000006-0000-0000-0000-000000000006', 'a1000005-0000-0000-0000-000000000005', 'BOM-THT-200G', 1, 200.0000, 'PKT', 3.00, true, '2026-04-01', '33333333-3333-3333-3333-333333333333', 'Crispy Round Rice Thattai (200g Batch = 40kg yield)'),
('b0000007-0000-0000-0000-000000000007', 'a1000006-0000-0000-0000-000000000006', 'BOM-MSC-100G', 1, 200.0000, 'PKT', 3.00, true, '2026-04-01', '33333333-3333-3333-3333-333333333333', 'Spicy Masala Potato Wafers (100g Batch = 20kg yield)'),
('b0000008-0000-0000-0000-000000000008', 'a1000007-0000-0000-0000-000000000007', 'BOM-KBD-200G', 1, 200.0000, 'PKT', 3.00, true, '2026-04-01', '33333333-3333-3333-3333-333333333333', 'Crispy Spiced Kara Boondi (200g Batch = 40kg yield)'),
('b0000009-0000-0000-0000-000000000009', 'a1000008-0000-0000-0000-000000000008', 'BOM-TPC-100G', 1, 200.0000, 'PKT', 3.00, true, '2026-04-01', '33333333-3333-3333-3333-333333333333', 'Crunchy Tapioca / Cassava Chips (100g Batch = 20kg yield)'),
('b0000010-0000-0000-0000-000000000010', 'a1000009-0000-0000-0000-000000000009', 'BOM-SDA-200G', 1, 200.0000, 'PKT', 3.00, true, '2026-04-01', '33333333-3333-3333-3333-333333333333', 'Traditional Roasted Rice & Sesame Seedai (200g Batch = 40kg yield)')
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 5. BOM ITEMS (Structured Ingredients & Packaging Ratios)
-- ----------------------------------------------------------------------------
-- Potato Chips 100g (BOM-PTC-100G)
INSERT INTO bom_items (bom_id, item_id, standard_qty, uom_id, scrap_allowance_pct) VALUES
('b0000002-0000-0000-0000-000000000002', 'a2000001-0000-0000-0000-000000000001', 50.0000, 'KG', 3.00), -- Potatoes
('b0000002-0000-0000-0000-000000000002', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 8.0000, 'L', 1.00),  -- Cooking Oil
('b0000002-0000-0000-0000-000000000002', 'a2000012-0000-0000-0000-000000000012', 0.8000, 'KG', 0.00), -- Salt
('b0000002-0000-0000-0000-000000000002', 'a3000001-0000-0000-0000-000000000001', 200.0000, 'PCS', 1.00), -- 100g Pouches
('b0000002-0000-0000-0000-000000000002', 'a3000002-0000-0000-0000-000000000002', 5.0000, 'PCS', 0.00)  -- Carton 40
ON CONFLICT (id) DO NOTHING;

-- Banana Chips 100g (BOM-BNC-100G)
INSERT INTO bom_items (bom_id, item_id, standard_qty, uom_id, scrap_allowance_pct) VALUES
('b0000003-0000-0000-0000-000000000003', 'a2000002-0000-0000-0000-000000000002', 45.0000, 'KG', 4.00), -- Raw Bananas
('b0000003-0000-0000-0000-000000000003', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 9.0000, 'L', 1.00),  -- Cooking Oil
('b0000003-0000-0000-0000-000000000003', 'a2000012-0000-0000-0000-000000000012', 0.6000, 'KG', 0.00), -- Salt
('b0000003-0000-0000-0000-000000000003', 'a3000001-0000-0000-0000-000000000001', 200.0000, 'PCS', 1.00), -- 100g Pouches
('b0000003-0000-0000-0000-000000000003', 'a3000002-0000-0000-0000-000000000002', 5.0000, 'PCS', 0.00)  -- Carton 40
ON CONFLICT (id) DO NOTHING;

-- Mixture 200g (BOM-MIX-200G)
INSERT INTO bom_items (bom_id, item_id, standard_qty, uom_id, scrap_allowance_pct) VALUES
('b0000004-0000-0000-0000-000000000004', 'a2000004-0000-0000-0000-000000000004', 25.0000, 'KG', 2.00), -- Besan
('b0000004-0000-0000-0000-000000000004', 'a2000005-0000-0000-0000-000000000005', 12.0000, 'KG', 2.00), -- Rice Flour
('b0000004-0000-0000-0000-000000000004', 'a2000007-0000-0000-0000-000000000007', 5.0000, 'KG', 1.00),  -- Peanuts
('b0000004-0000-0000-0000-000000000004', 'a2000008-0000-0000-0000-000000000008', 3.0000, 'KG', 1.00),  -- Roasted Chana
('b0000004-0000-0000-0000-000000000004', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 12.0000, 'L', 2.00), -- Cooking Oil
('b0000004-0000-0000-0000-000000000004', 'a2000011-0000-0000-0000-000000000011', 1.0000, 'KG', 0.00),  -- Curry / Hing
('b0000004-0000-0000-0000-000000000004', 'a2000009-0000-0000-0000-000000000009', 0.8000, 'KG', 0.00),  -- Chili Powder
('b0000004-0000-0000-0000-000000000004', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 200.0000, 'PCS', 1.00), -- 200g Pouches
('b0000004-0000-0000-0000-000000000004', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 10.0000, 'PCS', 0.00)  -- Carton 20
ON CONFLICT (id) DO NOTHING;

-- Ribbon Pakoda 200g (BOM-RBP-200G)
INSERT INTO bom_items (bom_id, item_id, standard_qty, uom_id, scrap_allowance_pct) VALUES
('b0000005-0000-0000-0000-000000000005', 'a2000004-0000-0000-0000-000000000004', 28.0000, 'KG', 2.00), -- Besan
('b0000005-0000-0000-0000-000000000005', 'a2000005-0000-0000-0000-000000000005', 14.0000, 'KG', 2.00), -- Rice Flour
('b0000005-0000-0000-0000-000000000005', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 11.0000, 'L', 2.00),  -- Cooking Oil
('b0000005-0000-0000-0000-000000000005', 'a2000009-0000-0000-0000-000000000009', 1.2000, 'KG', 0.00),  -- Chili Powder
('b0000005-0000-0000-0000-000000000005', 'a2000012-0000-0000-0000-000000000012', 0.8000, 'KG', 0.00),  -- Salt
('b0000005-0000-0000-0000-000000000005', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 200.0000, 'PCS', 1.00), -- 200g Pouches
('b0000005-0000-0000-0000-000000000005', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 10.0000, 'PCS', 0.00)  -- Carton 20
ON CONFLICT (id) DO NOTHING;

-- Thattai 200g (BOM-THT-200G)
INSERT INTO bom_items (bom_id, item_id, standard_qty, uom_id, scrap_allowance_pct) VALUES
('b0000006-0000-0000-0000-000000000006', 'a2000005-0000-0000-0000-000000000005', 32.0000, 'KG', 2.00), -- Rice Flour
('b0000006-0000-0000-0000-000000000006', 'a2000006-0000-0000-0000-000000000006', 5.0000, 'KG', 1.00),  -- Urad Dal
('b0000006-0000-0000-0000-000000000006', 'a2000008-0000-0000-0000-000000000008', 3.0000, 'KG', 1.00),  -- Roasted Chana
('b0000006-0000-0000-0000-000000000006', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 10.0000, 'L', 2.00),  -- Cooking Oil
('b0000006-0000-0000-0000-000000000006', 'a2000011-0000-0000-0000-000000000011', 1.0000, 'KG', 0.00),  -- Curry Leaves / Hing
('b0000006-0000-0000-0000-000000000006', 'a2000009-0000-0000-0000-000000000009', 0.8000, 'KG', 0.00),  -- Chili Powder
('b0000006-0000-0000-0000-000000000006', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 200.0000, 'PCS', 1.00), -- 200g Pouches
('b0000006-0000-0000-0000-000000000006', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 10.0000, 'PCS', 0.00)  -- Carton 20
ON CONFLICT (id) DO NOTHING;

-- Masala Chips 100g (BOM-MSC-100G)
INSERT INTO bom_items (bom_id, item_id, standard_qty, uom_id, scrap_allowance_pct) VALUES
('b0000007-0000-0000-0000-000000000007', 'a2000001-0000-0000-0000-000000000001', 50.0000, 'KG', 3.00), -- Potatoes
('b0000007-0000-0000-0000-000000000007', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 8.0000, 'L', 1.00),  -- Cooking Oil
('b0000007-0000-0000-0000-000000000007', 'a2000010-0000-0000-0000-000000000010', 1.5000, 'KG', 0.00), -- Masala Mix
('b0000007-0000-0000-0000-000000000007', 'a3000001-0000-0000-0000-000000000001', 200.0000, 'PCS', 1.00), -- 100g Pouches
('b0000007-0000-0000-0000-000000000007', 'a3000002-0000-0000-0000-000000000002', 5.0000, 'PCS', 0.00)  -- Carton 40
ON CONFLICT (id) DO NOTHING;

-- Kara Boondi 200g (BOM-KBD-200G)
INSERT INTO bom_items (bom_id, item_id, standard_qty, uom_id, scrap_allowance_pct) VALUES
('b0000008-0000-0000-0000-000000000008', 'a2000004-0000-0000-0000-000000000004', 35.0000, 'KG', 2.00), -- Besan
('b0000008-0000-0000-0000-000000000008', 'a2000005-0000-0000-0000-000000000005', 5.0000, 'KG', 2.00),  -- Rice Flour
('b0000008-0000-0000-0000-000000000008', 'a2000007-0000-0000-0000-000000000007', 4.0000, 'KG', 1.00),  -- Peanuts
('b0000008-0000-0000-0000-000000000008', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 12.0000, 'L', 2.00), -- Cooking Oil
('b0000008-0000-0000-0000-000000000008', 'a2000011-0000-0000-0000-000000000011', 1.2000, 'KG', 0.00),  -- Curry Leaves / Hing
('b0000008-0000-0000-0000-000000000008', 'a2000009-0000-0000-0000-000000000009', 0.9000, 'KG', 0.00),  -- Chili Powder
('b0000008-0000-0000-0000-000000000008', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 200.0000, 'PCS', 1.00), -- 200g Pouches
('b0000008-0000-0000-0000-000000000008', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 10.0000, 'PCS', 0.00)  -- Carton 20
ON CONFLICT (id) DO NOTHING;

-- Tapioca Chips 100g (BOM-TPC-100G)
INSERT INTO bom_items (bom_id, item_id, standard_qty, uom_id, scrap_allowance_pct) VALUES
('b0000009-0000-0000-0000-000000000009', 'a2000003-0000-0000-0000-000000000003', 48.0000, 'KG', 4.00), -- Tapioca
('b0000009-0000-0000-0000-000000000009', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 8.5000, 'L', 1.00),  -- Cooking Oil
('b0000009-0000-0000-0000-000000000009', 'a2000009-0000-0000-0000-000000000009', 0.8000, 'KG', 0.00),  -- Chili Powder
('b0000009-0000-0000-0000-000000000009', 'a2000012-0000-0000-0000-000000000012', 0.6000, 'KG', 0.00),  -- Salt
('b0000009-0000-0000-0000-000000000009', 'a3000001-0000-0000-0000-000000000001', 200.0000, 'PCS', 1.00), -- 100g Pouches
('b0000009-0000-0000-0000-000000000009', 'a3000002-0000-0000-0000-000000000002', 5.0000, 'PCS', 0.00)  -- Carton 40
ON CONFLICT (id) DO NOTHING;

-- Seedai 200g (BOM-SDA-200G)
INSERT INTO bom_items (bom_id, item_id, standard_qty, uom_id, scrap_allowance_pct) VALUES
('b0000010-0000-0000-0000-000000000010', 'a2000005-0000-0000-0000-000000000005', 36.0000, 'KG', 2.00), -- Rice Flour
('b0000010-0000-0000-0000-000000000010', 'a2000006-0000-0000-0000-000000000006', 4.0000, 'KG', 1.00),  -- Urad Dal
('b0000010-0000-0000-0000-000000000010', 'a2000013-0000-0000-0000-000000000013', 2.0000, 'KG', 0.00),  -- Sesame / Butter
('b0000010-0000-0000-0000-000000000010', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 10.0000, 'L', 2.00),  -- Cooking Oil
('b0000010-0000-0000-0000-000000000010', 'a2000012-0000-0000-0000-000000000012', 0.8000, 'KG', 0.00),  -- Salt
('b0000010-0000-0000-0000-000000000010', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 200.0000, 'PCS', 1.00), -- 200g Pouches
('b0000010-0000-0000-0000-000000000010', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 10.0000, 'PCS', 0.00)  -- Carton 20
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 6. SEED OPENING STOCK BALANCES FOR NEW RAW MATERIALS & PACKAGING
-- Ensures production orders for any product can calculate & issue materials
-- ----------------------------------------------------------------------------
INSERT INTO item_stock_balances (item_id, current_base_qty, current_moving_wac, current_total_value) VALUES
('a2000001-0000-0000-0000-000000000001', 300.0000, 22.0000, 6600.00),  -- Potatoes
('a2000002-0000-0000-0000-000000000002', 300.0000, 35.0000, 10500.00), -- Bananas
('a2000003-0000-0000-0000-000000000003', 300.0000, 18.0000, 5400.00),  -- Tapioca
('a2000004-0000-0000-0000-000000000004', 250.0000, 75.0000, 18750.00), -- Besan
('a2000005-0000-0000-0000-000000000005', 300.0000, 38.0000, 11400.00), -- Rice Flour
('a2000006-0000-0000-0000-000000000006', 80.0000, 110.0000, 8800.00),  -- Urad Dal
('a2000007-0000-0000-0000-000000000007', 80.0000, 130.0000, 10400.00), -- Peanuts
('a2000008-0000-0000-0000-000000000008', 80.0000, 95.0000, 7600.00),   -- Roasted Chana
('a2000009-0000-0000-0000-000000000009', 30.0000, 240.0000, 7200.00),  -- Chili Powder
('a2000010-0000-0000-0000-000000000010', 30.0000, 260.0000, 7800.00),  -- Masala Mix
('a2000011-0000-0000-0000-000000000011', 25.0000, 180.0000, 4500.00),  -- Curry / Hing
('a2000012-0000-0000-0000-000000000012', 50.0000, 15.0000, 750.00),    -- Salt
('a2000013-0000-0000-0000-000000000013', 25.0000, 320.0000, 8000.00),  -- Sesame / Butter
('a3000001-0000-0000-0000-000000000001', 1500.0000, 1.8000, 2700.00),  -- Pouch 100g
('a3000002-0000-0000-0000-000000000002', 100.0000, 18.0000, 1800.00),  -- Carton 40
-- Finished goods opening demo stock:
('a1000001-0000-0000-0000-000000000001', 40.0000, 18.0000, 720.00),    -- Potato Chips 100g
('a1000002-0000-0000-0000-000000000002', 40.0000, 20.0000, 800.00),    -- Banana Chips 100g
('a1000003-0000-0000-0000-000000000003', 30.0000, 32.0000, 960.00),    -- Mixture 200g
('a1000004-0000-0000-0000-000000000004', 30.0000, 30.0000, 900.00),    -- Ribbon Pakoda 200g
('a1000005-0000-0000-0000-000000000005', 30.0000, 29.0000, 870.00),    -- Thattai 200g
('a1000006-0000-0000-0000-000000000006', 40.0000, 19.0000, 760.00),    -- Masala Chips 100g
('a1000007-0000-0000-0000-000000000007', 30.0000, 31.0000, 930.00),    -- Kara Boondi 200g
('a1000008-0000-0000-0000-000000000008', 40.0000, 17.0000, 680.00),    -- Tapioca Chips 100g
('a1000009-0000-0000-0000-000000000009', 30.0000, 33.0000, 990.00)     -- Seedai 200g
ON CONFLICT (item_id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 7. SEED INVENTORY LEDGER MOVEMENTS (APPEND-ONLY AUDIT TRAIL)
-- ----------------------------------------------------------------------------
INSERT INTO inventory_ledger (
    transaction_timestamp, item_id, batch_number, movement_type, 
    transaction_qty, transaction_uom_id, base_quantity_delta, unit_cost, total_cost,
    source_reference_label, created_by
) VALUES
('2026-11-01 08:00:00+05:30', 'a2000001-0000-0000-0000-000000000001', 'OB-POTATO-01', 'OPENING_BALANCE', 300.0000, 'KG', 300.0000, 22.0000, 6600.00, 'OPENING-STOCK-SETUP', '33333333-3333-3333-3333-333333333333'),
('2026-11-01 08:00:00+05:30', 'a2000002-0000-0000-0000-000000000002', 'OB-BANANA-01', 'OPENING_BALANCE', 300.0000, 'KG', 300.0000, 35.0000, 10500.00, 'OPENING-STOCK-SETUP', '33333333-3333-3333-3333-333333333333'),
('2026-11-01 08:00:00+05:30', 'a2000003-0000-0000-0000-000000000003', 'OB-TAPIOCA-01', 'OPENING_BALANCE', 300.0000, 'KG', 300.0000, 18.0000, 5400.00, 'OPENING-STOCK-SETUP', '33333333-3333-3333-3333-333333333333'),
('2026-11-01 08:00:00+05:30', 'a2000004-0000-0000-0000-000000000004', 'OB-BESAN-01', 'OPENING_BALANCE', 250.0000, 'KG', 250.0000, 75.0000, 18750.00, 'OPENING-STOCK-SETUP', '33333333-3333-3333-3333-333333333333'),
('2026-11-01 08:00:00+05:30', 'a2000005-0000-0000-0000-000000000005', 'OB-RICEFL-01', 'OPENING_BALANCE', 300.0000, 'KG', 300.0000, 38.0000, 11400.00, 'OPENING-STOCK-SETUP', '33333333-3333-3333-3333-333333333333'),
('2026-11-01 08:00:00+05:30', 'a2000006-0000-0000-0000-000000000006', 'OB-URADDL-01', 'OPENING_BALANCE', 80.0000, 'KG', 80.0000, 110.0000, 8800.00, 'OPENING-STOCK-SETUP', '33333333-3333-3333-3333-333333333333'),
('2026-11-01 08:00:00+05:30', 'a2000007-0000-0000-0000-000000000007', 'OB-PEANUT-01', 'OPENING_BALANCE', 80.0000, 'KG', 80.0000, 130.0000, 10400.00, 'OPENING-STOCK-SETUP', '33333333-3333-3333-3333-333333333333'),
('2026-11-01 08:00:00+05:30', 'a2000008-0000-0000-0000-000000000008', 'OB-RCHANA-01', 'OPENING_BALANCE', 80.0000, 'KG', 80.0000, 95.0000, 7600.00, 'OPENING-STOCK-SETUP', '33333333-3333-3333-3333-333333333333'),
('2026-11-01 08:00:00+05:30', 'a2000009-0000-0000-0000-000000000009', 'OB-CHILI-01', 'OPENING_BALANCE', 30.0000, 'KG', 30.0000, 240.0000, 7200.00, 'OPENING-STOCK-SETUP', '33333333-3333-3333-3333-333333333333'),
('2026-11-01 08:00:00+05:30', 'a2000010-0000-0000-0000-000000000010', 'OB-MASALA-01', 'OPENING_BALANCE', 30.0000, 'KG', 30.0000, 260.0000, 7800.00, 'OPENING-STOCK-SETUP', '33333333-3333-3333-3333-333333333333'),
('2026-11-01 08:00:00+05:30', 'a2000011-0000-0000-0000-000000000011', 'OB-CURRYH-01', 'OPENING_BALANCE', 25.0000, 'KG', 25.0000, 180.0000, 4500.00, 'OPENING-STOCK-SETUP', '33333333-3333-3333-3333-333333333333'),
('2026-11-01 08:00:00+05:30', 'a2000012-0000-0000-0000-000000000012', 'OB-SALT-01', 'OPENING_BALANCE', 50.0000, 'KG', 50.0000, 15.0000, 750.00, 'OPENING-STOCK-SETUP', '33333333-3333-3333-3333-333333333333'),
('2026-11-01 08:00:00+05:30', 'a2000013-0000-0000-0000-000000000013', 'OB-SESBUT-01', 'OPENING_BALANCE', 25.0000, 'KG', 25.0000, 320.0000, 8000.00, 'OPENING-STOCK-SETUP', '33333333-3333-3333-3333-333333333333'),
('2026-11-01 08:00:00+05:30', 'a3000001-0000-0000-0000-000000000001', 'OB-POUCH100-01', 'OPENING_BALANCE', 1500.0000, 'PCS', 1500.0000, 1.8000, 2700.00, 'OPENING-STOCK-SETUP', '33333333-3333-3333-3333-333333333333'),
('2026-11-01 08:00:00+05:30', 'a3000002-0000-0000-0000-000000000002', 'OB-CTN40-01', 'OPENING_BALANCE', 100.0000, 'PCS', 100.0000, 18.0000, 1800.00, 'OPENING-STOCK-SETUP', '33333333-3333-3333-3333-333333333333'),
-- Finished goods opening demo stock:
('2026-11-01 08:00:00+05:30', 'a1000001-0000-0000-0000-000000000001', 'OB-PTC-01', 'OPENING_BALANCE', 40.0000, 'PKT', 40.0000, 18.0000, 720.00, 'OPENING-STOCK-SETUP', '33333333-3333-3333-3333-333333333333'),
('2026-11-01 08:00:00+05:30', 'a1000002-0000-0000-0000-000000000002', 'OB-BNC-01', 'OPENING_BALANCE', 40.0000, 'PKT', 40.0000, 20.0000, 800.00, 'OPENING-STOCK-SETUP', '33333333-3333-3333-3333-333333333333'),
('2026-11-01 08:00:00+05:30', 'a1000003-0000-0000-0000-000000000003', 'OB-MIX-01', 'OPENING_BALANCE', 30.0000, 'PKT', 30.0000, 32.0000, 960.00, 'OPENING-STOCK-SETUP', '33333333-3333-3333-3333-333333333333'),
('2026-11-01 08:00:00+05:30', 'a1000004-0000-0000-0000-000000000004', 'OB-RBP-01', 'OPENING_BALANCE', 30.0000, 'PKT', 30.0000, 30.0000, 900.00, 'OPENING-STOCK-SETUP', '33333333-3333-3333-3333-333333333333'),
('2026-11-01 08:00:00+05:30', 'a1000005-0000-0000-0000-000000000005', 'OB-THT-01', 'OPENING_BALANCE', 30.0000, 'PKT', 30.0000, 29.0000, 870.00, 'OPENING-STOCK-SETUP', '33333333-3333-3333-3333-333333333333'),
('2026-11-01 08:00:00+05:30', 'a1000006-0000-0000-0000-000000000006', 'OB-MSC-01', 'OPENING_BALANCE', 40.0000, 'PKT', 40.0000, 19.0000, 760.00, 'OPENING-STOCK-SETUP', '33333333-3333-3333-3333-333333333333'),
('2026-11-01 08:00:00+05:30', 'a1000007-0000-0000-0000-000000000007', 'OB-KBD-01', 'OPENING_BALANCE', 30.0000, 'PKT', 30.0000, 31.0000, 930.00, 'OPENING-STOCK-SETUP', '33333333-3333-3333-3333-333333333333'),
('2026-11-01 08:00:00+05:30', 'a1000008-0000-0000-0000-000000000008', 'OB-TPC-01', 'OPENING_BALANCE', 40.0000, 'PKT', 40.0000, 17.0000, 680.00, 'OPENING-STOCK-SETUP', '33333333-3333-3333-3333-333333333333'),
('2026-11-01 08:00:00+05:30', 'a1000009-0000-0000-0000-000000000009', 'OB-SDA-01', 'OPENING_BALANCE', 30.0000, 'PKT', 30.0000, 33.0000, 990.00, 'OPENING-STOCK-SETUP', '33333333-3333-3333-3333-333333333333');

COMMIT;
