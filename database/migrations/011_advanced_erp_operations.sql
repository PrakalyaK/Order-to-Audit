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
