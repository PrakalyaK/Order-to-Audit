-- ============================================================================
-- ORDER-TO-AUDIT SYSTEM: DATABASE MIGRATION 007
-- Separation of Material Issuance from Actual Material Consumption
-- ============================================================================

-- 1. ADD actual_consumed_qty COLUMN TO production_run_inputs
ALTER TABLE production_run_inputs 
ADD COLUMN IF NOT EXISTS actual_consumed_qty NUMERIC(14, 4);

-- Disable trigger during schema update
ALTER TABLE production_run_inputs 
DISABLE TRIGGER trg_prevent_posted_production_input_modify;

-- Populate existing rows with base_net_consumed_qty or good_production_qty
UPDATE production_run_inputs 
SET actual_consumed_qty = COALESCE(good_production_qty + damaged_or_scrap_qty, actual_issued_qty)
WHERE actual_consumed_qty IS NULL;

-- 2. RELAX / UPDATE chk_production_mass_balance
-- Mass balance during consumption: actual_consumed_qty = good_production_qty + damaged_or_scrap_qty
ALTER TABLE production_run_inputs 
DROP CONSTRAINT IF EXISTS chk_production_mass_balance;

ALTER TABLE production_run_inputs 
ADD CONSTRAINT chk_production_mass_balance 
CHECK (
    actual_consumed_qty IS NULL OR 
    ROUND(actual_consumed_qty, 4) = ROUND(good_production_qty + damaged_or_scrap_qty, 4)
);

-- 3. UPDATE IMMUTABILITY TRIGGER TO ALLOW CONSUMPTION RECORDING IN materials_issued
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

    -- Records are permanently immutable once the production run is 'completed'
    IF v_run_status = 'completed' THEN
        RAISE EXCEPTION 'Integrity Violation: Cannot % production input for completed production run %. Historical input records are immutable.',
            TG_OP, v_run_number;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Re-enable trigger
ALTER TABLE production_run_inputs 
ENABLE TRIGGER trg_prevent_posted_production_input_modify;

-- 4. UPDATE fn_post_production_issue TO RECORD ISSUANCE TO FLOOR WITHOUT PREMATURE CONSUMPTION
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

-- 5. RECREATE VIEW v_production_variance
DROP VIEW IF EXISTS v_production_variance CASCADE;

CREATE VIEW v_production_variance AS
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
    COALESCE(r_in.actual_consumed_qty, r_in.base_net_consumed_qty) AS actual_consumed_qty,
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
