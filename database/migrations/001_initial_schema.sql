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
