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
