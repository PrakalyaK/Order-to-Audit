-- ============================================================================
-- ORDER-TO-AUDIT SYSTEM: DATABASE MIGRATION 007
-- Purchases Immutability Enforcers & Inventory Hardening
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. PURCHASE BILLS IMMUTABILITY TRIGGER
-- Prevents updating or deleting received purchase bills, and prevents reverting status.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_prevent_received_purchase_modification()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.status = 'received' THEN
            RAISE EXCEPTION 'Integrity Violation: Cannot delete received purchase bill % as inventory has already been posted.',
                OLD.bill_number;
        END IF;
        RETURN OLD;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        -- If already received, prevent modifying financial/inventory data or reverting status
        IF OLD.status = 'received' THEN
            IF NEW.status <> 'received' THEN
                RAISE EXCEPTION 'Integrity Violation: Cannot revert received purchase bill % to "%".',
                    OLD.bill_number, NEW.status;
            END IF;

            IF NEW.supplier_id <> OLD.supplier_id OR
               NEW.bill_number <> OLD.bill_number OR
               NEW.bill_date <> OLD.bill_date OR
               NEW.subtotal_amount <> OLD.subtotal_amount OR
               NEW.cgst_amount <> OLD.cgst_amount OR
               NEW.sgst_amount <> OLD.sgst_amount OR
               NEW.igst_amount <> OLD.igst_amount OR
               NEW.total_amount <> OLD.total_amount THEN
                RAISE EXCEPTION 'Integrity Violation: Purchase bill % is already received. Modifying financial values or items is prohibited.',
                    OLD.bill_number;
            END IF;
        END IF;

        -- If cancelled, prevent re-opening
        IF OLD.status = 'cancelled' AND NEW.status <> 'cancelled' THEN
            RAISE EXCEPTION 'Integrity Violation: Cannot re-open cancelled purchase bill %.',
                OLD.bill_number;
        END IF;

        RETURN NEW;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_received_purchase_delete ON purchase_bills;
DROP TRIGGER IF EXISTS trg_prevent_received_purchase_modify ON purchase_bills;
CREATE TRIGGER trg_prevent_received_purchase_modify
BEFORE UPDATE OR DELETE ON purchase_bills
FOR EACH ROW
EXECUTE FUNCTION fn_prevent_received_purchase_modification();

-- ----------------------------------------------------------------------------
-- 2. PURCHASE BILL ITEMS IMMUTABILITY TRIGGER
-- Prevents INSERT, UPDATE, or DELETE on purchase bill line items once the bill is received.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_prevent_received_purchase_item_modification()
RETURNS TRIGGER AS $$
DECLARE
    v_bill_status VARCHAR(20);
    v_bill_number VARCHAR(50);
    v_target_bill_id UUID;
BEGIN
    v_target_bill_id := COALESCE(OLD.purchase_bill_id, NEW.purchase_bill_id);
    SELECT status, bill_number INTO v_bill_status, v_bill_number
    FROM purchase_bills
    WHERE id = v_target_bill_id;

    IF v_bill_status = 'received' THEN
        RAISE EXCEPTION 'Integrity Violation: Cannot % line item for received purchase bill %. Historical purchase items are immutable.',
            TG_OP, v_bill_number;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_received_purchase_item_modify ON purchase_bill_items;
CREATE TRIGGER trg_prevent_received_purchase_item_modify
BEFORE INSERT OR UPDATE OR DELETE ON purchase_bill_items
FOR EACH ROW
EXECUTE FUNCTION fn_prevent_received_purchase_item_modification();

-- ----------------------------------------------------------------------------
-- 3. AUDIT TRIGGER FOR PURCHASE BILL ITEMS
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_audit_purchase_bill_items ON purchase_bill_items;
CREATE TRIGGER trg_audit_purchase_bill_items
AFTER INSERT OR UPDATE OR DELETE ON purchase_bill_items
FOR EACH ROW
EXECUTE FUNCTION fn_log_entity_audit_trail();
