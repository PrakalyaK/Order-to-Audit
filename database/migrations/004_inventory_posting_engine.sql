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
