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

-- Attach audit triggers
DROP TRIGGER IF EXISTS trg_audit_invoices ON invoices;
CREATE TRIGGER trg_audit_invoices
AFTER UPDATE OR DELETE ON invoices
FOR EACH ROW
EXECUTE FUNCTION fn_log_entity_audit_trail();

DROP TRIGGER IF EXISTS trg_audit_production_runs ON production_runs;
CREATE TRIGGER trg_audit_production_runs
AFTER UPDATE OR DELETE ON production_runs
FOR EACH ROW
EXECUTE FUNCTION fn_log_entity_audit_trail();

DROP TRIGGER IF EXISTS trg_audit_purchase_bills ON purchase_bills;
CREATE TRIGGER trg_audit_purchase_bills
AFTER UPDATE OR DELETE ON purchase_bills
FOR EACH ROW
EXECUTE FUNCTION fn_log_entity_audit_trail();

DROP TRIGGER IF EXISTS trg_audit_payments ON payments;
CREATE TRIGGER trg_audit_payments
AFTER UPDATE OR DELETE ON payments
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
