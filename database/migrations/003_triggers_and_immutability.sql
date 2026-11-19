-- ============================================================================
-- ORDER-TO-AUDIT SYSTEM: DATABASE MIGRATION 003
-- Triggers and Statutory Immutability Enforcers
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. STRICT INVENTORY LEDGER IMMUTABILITY
-- Prevents any UPDATE or DELETE operations on the ledger
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
-- 2. PREVENT DELETION OF POSTED INVOICES
-- Invoices once posted can only be cancelled via Credit Notes
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

-- ----------------------------------------------------------------------------
-- 3. PREVENT DELETION OF COMPLETED PRODUCTION RUNS
-- Completed runs have generated finished goods and consumed materials
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_prevent_completed_production_deletion()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status = 'completed' THEN
        RAISE EXCEPTION 'Integrity Violation: Cannot delete completed production run % as inventory has been issued and received.', OLD.run_number;
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_completed_production_delete ON production_runs;
CREATE TRIGGER trg_prevent_completed_production_delete
BEFORE DELETE ON production_runs
FOR EACH ROW
EXECUTE FUNCTION fn_prevent_completed_production_deletion();

-- ----------------------------------------------------------------------------
-- 4. PREVENT DELETION OF RECEIVED PURCHASE BILLS
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_prevent_received_purchase_deletion()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status = 'received' THEN
        RAISE EXCEPTION 'Integrity Violation: Cannot delete received purchase bill % as stock has been taken into warehouse.', OLD.bill_number;
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
-- 5. AUTOMATED AUDIT TRAIL LOGGING
-- Captures state transitions for Invoices, Production Runs, and Purchases
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_log_entity_audit_trail()
RETURNS TRIGGER AS $$
DECLARE
    entity_id_val VARCHAR(64);
BEGIN
    entity_id_val := OLD.id::TEXT;
    INSERT INTO audit_logs (
        action,
        entity_name,
        entity_id,
        old_values,
        new_values
    ) VALUES (
        TG_OP || '_' || UPPER(TG_TABLE_NAME),
        TG_TABLE_NAME,
        entity_id_val,
        to_jsonb(OLD),
        to_jsonb(NEW)
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_invoices_update ON invoices;
CREATE TRIGGER trg_audit_invoices_update
AFTER UPDATE ON invoices
FOR EACH ROW
EXECUTE FUNCTION fn_log_entity_audit_trail();

DROP TRIGGER IF EXISTS trg_audit_production_runs_update ON production_runs;
CREATE TRIGGER trg_audit_production_runs_update
AFTER UPDATE ON production_runs
FOR EACH ROW
EXECUTE FUNCTION fn_log_entity_audit_trail();
