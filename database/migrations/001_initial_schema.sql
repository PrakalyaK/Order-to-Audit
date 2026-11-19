-- ============================================================================
-- ORDER-TO-AUDIT SYSTEM: DATABASE MIGRATION 001
-- Tables and Schema Structure
-- ============================================================================

-- Enable UUID extension for robust distributed keys and offline sync
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Clean drop if recreating
DROP VIEW IF EXISTS v_production_variance CASCADE;
DROP VIEW IF EXISTS v_customer_outstanding CASCADE;
DROP VIEW IF EXISTS v_invoice_balances CASCADE;
DROP VIEW IF EXISTS v_stock_ledger CASCADE;
DROP VIEW IF EXISTS v_current_stock CASCADE;

DROP TABLE IF EXISTS inventory_ledger CASCADE;
DROP TABLE IF EXISTS stock_adjustments CASCADE;
DROP TABLE IF EXISTS credit_notes CASCADE;
DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS dispatch_items CASCADE;
DROP TABLE IF EXISTS dispatches CASCADE;
DROP TABLE IF EXISTS invoice_items CASCADE;
DROP TABLE IF EXISTS invoices CASCADE;
DROP TABLE IF EXISTS sales_order_items CASCADE;
DROP TABLE IF EXISTS sales_orders CASCADE;
DROP TABLE IF EXISTS production_run_costing CASCADE;
DROP TABLE IF EXISTS production_run_overheads CASCADE;
DROP TABLE IF EXISTS production_run_inputs CASCADE;
DROP TABLE IF EXISTS production_runs CASCADE;
DROP TABLE IF EXISTS bom_items CASCADE;
DROP TABLE IF EXISTS boms CASCADE;
DROP TABLE IF EXISTS purchase_bill_items CASCADE;
DROP TABLE IF EXISTS purchase_bills CASCADE;
DROP TABLE IF EXISTS parties CASCADE;
DROP TABLE IF EXISTS items CASCADE;
DROP TABLE IF EXISTS units_of_measure CASCADE;
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- ----------------------------------------------------------------------------
-- 1. USERS & ROLES
-- ----------------------------------------------------------------------------
CREATE TABLE users (
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
-- 2. AUDIT LOGS
-- ----------------------------------------------------------------------------
CREATE TABLE audit_logs (
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
-- 3. UNITS OF MEASURE (Standard conversion factors to Base Units)
-- ----------------------------------------------------------------------------
CREATE TABLE units_of_measure (
    id VARCHAR(10) PRIMARY KEY, -- e.g. 'KG', 'G', 'L', 'ML', 'PCS', 'PKT', 'CTN'
    name VARCHAR(50) NOT NULL,
    dimension VARCHAR(20) NOT NULL CHECK (dimension IN ('weight', 'volume', 'count', 'packaging')),
    base_unit_id VARCHAR(10) REFERENCES units_of_measure(id),
    conversion_factor_to_base NUMERIC(14, 6) NOT NULL DEFAULT 1.000000 -- 1 G = 0.001 KG, 1 ML = 0.001 L
);

-- ----------------------------------------------------------------------------
-- 4. ITEMS (Master Product and Material Catalog)
-- ----------------------------------------------------------------------------
CREATE TABLE items (
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
    standard_selling_price NUMERIC(12, 2) NOT NULL DEFAULT 0.00, -- Selling price before GST
    standard_purchase_rate NUMERIC(12, 2) NOT NULL DEFAULT 0.00, -- Indicative cost rate
    min_reorder_level NUMERIC(14, 4) NOT NULL DEFAULT 0.0000,
    -- Product-specific packaging conversion:
    -- E.g. For Murukku 200g, 1 carton holds 20 packets. For other goods it can hold 10 or 30.
    packets_per_carton NUMERIC(10, 2) NOT NULL DEFAULT 1.00,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 5. PARTIES (Customers & Suppliers)
-- ----------------------------------------------------------------------------
CREATE TABLE parties (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    party_type VARCHAR(20) NOT NULL CHECK (party_type IN ('customer', 'supplier', 'both')),
    trade_name VARCHAR(150) NOT NULL,
    contact_person VARCHAR(100),
    phone VARCHAR(20) NOT NULL,
    email VARCHAR(100),
    gstin VARCHAR(15), -- Nullable for unregistered small retailers
    state_code VARCHAR(2) NOT NULL, -- '33' for Tamil Nadu, '29' for Karnataka, etc.
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
CREATE TABLE boms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    finished_good_item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
    bom_code VARCHAR(50) NOT NULL,
    version_number INT NOT NULL DEFAULT 1,
    standard_batch_size NUMERIC(14, 4) NOT NULL, -- e.g. 200.0000 packets per batch
    batch_uom_id VARCHAR(10) NOT NULL REFERENCES units_of_measure(id),
    tolerance_variance_pct NUMERIC(5, 2) NOT NULL DEFAULT 3.00, -- 3% tolerance threshold
    is_active BOOLEAN NOT NULL DEFAULT false,
    effective_from DATE NOT NULL,
    effective_to DATE,
    notes TEXT,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_bom_version UNIQUE (finished_good_item_id, version_number)
);

CREATE TABLE bom_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bom_id UUID NOT NULL REFERENCES boms(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
    standard_qty NUMERIC(14, 4) NOT NULL, -- standard quantity per single batch
    uom_id VARCHAR(10) NOT NULL REFERENCES units_of_measure(id),
    scrap_allowance_pct NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
    CONSTRAINT uq_bom_item UNIQUE (bom_id, item_id)
);

-- ----------------------------------------------------------------------------
-- 7. PROCUREMENT (Purchases & Supplier Invoices)
-- ----------------------------------------------------------------------------
CREATE TABLE purchase_bills (
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

CREATE TABLE purchase_bill_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_bill_id UUID NOT NULL REFERENCES purchase_bills(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
    supplier_batch_no VARCHAR(50),
    expiry_date DATE,
    quantity NUMERIC(14, 4) NOT NULL,
    uom_id VARCHAR(10) NOT NULL REFERENCES units_of_measure(id),
    base_quantity NUMERIC(14, 4) NOT NULL, -- Quantity converted to item base UOM
    unit_rate NUMERIC(12, 2) NOT NULL, -- Purchase rate in base UOM
    taxable_amount NUMERIC(12, 2) NOT NULL,
    gst_rate_pct NUMERIC(5, 2) NOT NULL,
    tax_amount NUMERIC(12, 2) NOT NULL,
    total_amount NUMERIC(12, 2) NOT NULL
);

-- ----------------------------------------------------------------------------
-- 8. PRODUCTION RUNS & ADVANCED INPUT TRACKING
-- ----------------------------------------------------------------------------
CREATE TABLE production_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_number VARCHAR(50) UNIQUE NOT NULL,
    bom_id UUID NOT NULL REFERENCES boms(id) ON DELETE RESTRICT,
    finished_good_item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
    output_batch_number VARCHAR(50) NOT NULL,
    run_date DATE NOT NULL,
    planned_batch_count NUMERIC(8, 2) NOT NULL DEFAULT 1.00, -- Number of batches planned (e.g. 1.00)
    standard_batch_size NUMERIC(14, 4) NOT NULL, -- Snapshot from BOM (e.g. 200.0000)
    planned_yield_qty NUMERIC(14, 4) NOT NULL, -- planned_batch_count * standard_batch_size
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

-- Refined Production Inputs: Tracks issued, good usage, damaged scrap, and returned quantities
CREATE TABLE production_run_inputs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    production_run_id UUID NOT NULL REFERENCES production_runs(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
    planned_qty NUMERIC(14, 4) NOT NULL, -- Scaled standard quantity from BOM
    actual_issued_qty NUMERIC(14, 4) NOT NULL, -- Total quantity dispatched from stockroom
    good_production_qty NUMERIC(14, 4) NOT NULL DEFAULT 0.0000, -- Quantity incorporated in good output
    damaged_or_scrap_qty NUMERIC(14, 4) NOT NULL DEFAULT 0.0000, -- Floor scrap (e.g. 6 damaged pouches)
    returned_to_store_qty NUMERIC(14, 4) NOT NULL DEFAULT 0.0000, -- Unused quantity returned to stock
    uom_id VARCHAR(10) NOT NULL REFERENCES units_of_measure(id),
    base_net_consumed_qty NUMERIC(14, 4) NOT NULL, -- (actual_issued_qty - returned_to_store_qty) in Base UOM
    unit_cost_applied NUMERIC(12, 4) NOT NULL, -- Weighted Average Cost at issue time
    total_material_cost NUMERIC(12, 2) NOT NULL, -- base_net_consumed_qty * unit_cost_applied
    consumption_variance_qty NUMERIC(14, 4) NOT NULL, -- base_net_consumed_qty - planned_qty
    consumption_variance_pct NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
    is_consumption_flagged BOOLEAN NOT NULL DEFAULT false,
    -- Mass balance integrity rule: issued = good + scrap + returned
    CONSTRAINT chk_production_mass_balance CHECK (
        ROUND(actual_issued_qty, 4) = ROUND(good_production_qty + damaged_or_scrap_qty + returned_to_store_qty, 4)
    )
);

CREATE TABLE production_run_overheads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    production_run_id UUID NOT NULL REFERENCES production_runs(id) ON DELETE CASCADE,
    overhead_type VARCHAR(50) NOT NULL CHECK (overhead_type IN ('labour', 'power_gas', 'maintenance', 'depreciation', 'other')),
    description VARCHAR(150),
    amount NUMERIC(12, 2) NOT NULL
);

CREATE TABLE production_run_costing (
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
-- 9. SALES ORDERS (Mobile order entry & offline deduplication)
-- ----------------------------------------------------------------------------
CREATE TABLE sales_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number VARCHAR(50) UNIQUE NOT NULL,
    customer_id UUID NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,
    salesman_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    order_date DATE NOT NULL,
    offline_client_uuid UUID UNIQUE, -- Guarantees idempotent offline sync
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

CREATE TABLE sales_order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sales_order_id UUID NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
    -- Immutable price & description snapshots
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
-- 10. GST INVOICES & PRICE SNAPSHOTS
-- ----------------------------------------------------------------------------
CREATE TABLE invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number VARCHAR(50) UNIQUE NOT NULL, -- e.g. INV/2026-27/0001
    financial_year VARCHAR(10) NOT NULL, -- e.g. '2026-2027'
    sales_order_id UUID NOT NULL REFERENCES sales_orders(id) ON DELETE RESTRICT,
    customer_id UUID NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,
    invoice_date DATE NOT NULL,
    place_of_supply_state_code VARCHAR(2) NOT NULL,
    is_interstate BOOLEAN NOT NULL, -- True: IGST, False: CGST + SGST
    taxable_value NUMERIC(12, 2) NOT NULL,
    cgst_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    sgst_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    igst_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    total_invoice_value NUMERIC(12, 2) NOT NULL,
    -- Note: Removed redundant amount_paid and balance_due. Derived via views!
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

CREATE TABLE invoice_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
    -- Immutable price & tax snapshots
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
CREATE TABLE dispatches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dispatch_number VARCHAR(50) UNIQUE NOT NULL,
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
    dispatch_date DATE NOT NULL,
    carrier_or_vehicle_no VARCHAR(50),
    driver_name VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'dispatched' CHECK (status IN ('ready', 'dispatched', 'delivered')),
    dispatched_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE dispatch_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dispatch_id UUID NOT NULL REFERENCES dispatches(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
    batch_number VARCHAR(50) NOT NULL,
    dispatched_qty NUMERIC(14, 4) NOT NULL,
    uom_id VARCHAR(10) NOT NULL REFERENCES units_of_measure(id),
    base_quantity NUMERIC(14, 4) NOT NULL
);

-- ----------------------------------------------------------------------------
-- 12. PAYMENTS (Customer Collections)
-- ----------------------------------------------------------------------------
CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_number VARCHAR(50) UNIQUE NOT NULL,
    customer_id UUID NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,
    invoice_id UUID REFERENCES invoices(id) ON DELETE RESTRICT, -- Nullable if on-account advance
    payment_date DATE NOT NULL,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    payment_mode VARCHAR(20) NOT NULL CHECK (payment_mode IN ('cash', 'upi', 'neft_rtgs', 'cheque')),
    reference_txn_id VARCHAR(100),
    notes TEXT,
    recorded_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 13. CREDIT NOTES (Statutory Invoice Reversal)
-- ----------------------------------------------------------------------------
CREATE TABLE credit_notes (
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
-- 14. STOCK ADJUSTMENTS (Physical audit reconciliation)
-- ----------------------------------------------------------------------------
CREATE TABLE stock_adjustments (
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
-- 15. THE CORE INVENTORY LEDGER (Append-Only with Referential Integrity)
-- ----------------------------------------------------------------------------
CREATE TABLE inventory_ledger (
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
    -- Normalized Base Unit Quantities:
    -- Positive for additions to warehouse, Negative for deductions
    transaction_qty NUMERIC(14, 4) NOT NULL,
    transaction_uom_id VARCHAR(10) NOT NULL REFERENCES units_of_measure(id),
    base_quantity_delta NUMERIC(14, 4) NOT NULL, -- Strict Base UOM delta
    unit_cost NUMERIC(12, 4) NOT NULL DEFAULT 0.0000, -- Moving Weighted Average Cost at transaction
    total_cost NUMERIC(12, 2) NOT NULL, -- base_quantity_delta * unit_cost
    -- Explicit, validated foreign keys to source documents (Referential Integrity):
    purchase_bill_item_id UUID REFERENCES purchase_bill_items(id) ON DELETE RESTRICT,
    production_run_input_id UUID REFERENCES production_run_inputs(id) ON DELETE RESTRICT,
    production_run_yield_id UUID REFERENCES production_runs(id) ON DELETE RESTRICT,
    dispatch_item_id UUID REFERENCES dispatch_items(id) ON DELETE RESTRICT,
    stock_adjustment_id UUID REFERENCES stock_adjustments(id) ON DELETE RESTRICT,
    source_reference_label VARCHAR(60) NOT NULL, -- Human-readable document reference (e.g. 'PB-001', 'PR-001')
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Enforce that non-opening movements reference EXACTLY one valid source entity
    CONSTRAINT chk_source_integrity CHECK (
        (movement_type = 'OPENING_BALANCE' AND num_nonnulls(purchase_bill_item_id, production_run_input_id, production_run_yield_id, dispatch_item_id, stock_adjustment_id) = 0)
        OR
        (movement_type != 'OPENING_BALANCE' AND num_nonnulls(purchase_bill_item_id, production_run_input_id, production_run_yield_id, dispatch_item_id, stock_adjustment_id) = 1)
    )
);
