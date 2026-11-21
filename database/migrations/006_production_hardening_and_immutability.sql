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
