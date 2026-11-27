-- ============================================================================
-- ORDER-TO-AUDIT SYSTEM: DATABASE MIGRATION 014
-- Fix Material Issuance Mass Balance Constraint Handling
-- ============================================================================

-- 1. Reset consumption fields on any active draft or materials_issued runs
-- (Consumption is entered strictly at Stage 4, not during draft or issuance)
UPDATE production_run_inputs
SET actual_consumed_qty = NULL,
    good_production_qty = 0.0000,
    damaged_or_scrap_qty = 0.0000,
    returned_to_store_qty = 0.0000
WHERE production_run_id IN (
    SELECT id FROM production_runs WHERE status IN ('draft', 'materials_issued')
);

-- 2. Update fn_post_production_issue to cleanly initialize input consumption state to NULL
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

        -- Enforce base UOM conversion inside database for issued quantity
        v_computed_issued := fn_compute_base_quantity(v_input.item_id, v_input.actual_issued_qty, v_input.uom_id);

        -- Lock parent item record first, then lock stock balance row
        PERFORM 1 FROM items WHERE id = v_input.item_id FOR UPDATE;

        SELECT * INTO v_stock 
        FROM item_stock_balances 
        WHERE item_id = v_input.item_id 
        FOR UPDATE;

        IF NOT FOUND OR v_stock.current_base_qty < v_computed_issued THEN
            RAISE EXCEPTION 'Negative Inventory Prevention: Insufficient stock for "%". Required: %, Available: %',
                v_item_name, v_computed_issued, COALESCE(v_stock.current_base_qty, 0);
        END IF;

        v_issue_cost := ROUND(v_computed_issued * v_stock.current_moving_wac, 2);

        -- Pin Moving WAC at issue time and initialize issuance (reset consumption fields for Stage 4)
        UPDATE production_run_inputs 
        SET unit_cost_applied = v_stock.current_moving_wac,
            base_net_consumed_qty = v_computed_issued,
            total_material_cost = v_issue_cost,
            actual_consumed_qty = NULL,
            good_production_qty = 0.0000,
            damaged_or_scrap_qty = 0.0000,
            returned_to_store_qty = 0.0000
        WHERE id = v_input.id;

        -- Decrement store stock upon material issue to production floor WIP
        UPDATE item_stock_balances 
        SET current_base_qty = current_base_qty - v_computed_issued,
            current_total_value = ROUND((current_base_qty - v_computed_issued) * current_moving_wac, 2),
            last_transaction_timestamp = NOW(),
            updated_at = NOW()
        WHERE item_id = v_input.item_id;

        -- Record immutable inventory ledger entry for issue
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
            v_computed_issued,
            v_input.uom_id,
            -v_computed_issued,
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
