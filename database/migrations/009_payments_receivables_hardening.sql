-- ============================================================================
-- ORDER-TO-AUDIT SYSTEM: MIGRATION 009
-- PHASE 8: PAYMENT MANAGEMENT, ALLOCATIONS & RECEIVABLES HARDENING
-- ============================================================================
-- 1. Enhances `payments` table with status lifecycle, bank details, and reversal tracking.
-- 2. Enhances `payment_allocations` table with status lifecycle and reversal tracking.
-- 3. Updates views `v_invoice_balances` and `v_customer_outstanding` to respect active/posted statuses.
-- 4. Enhances `fn_allocate_payment` with invoice validation and concurrency locks.
-- 5. Introduces `fn_reverse_payment` and `fn_unallocate_payment` for atomic financial reversals.
-- 6. Enforces database-level immutability triggers on posted payments and allocations.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. ENHANCE PAYMENTS TABLE
-- ----------------------------------------------------------------------------

-- Add status column (default 'posted' so existing benchmark REC-2026-0001 is posted)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'payments' AND column_name = 'status'
    ) THEN
        ALTER TABLE payments 
        ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'posted' 
        CHECK (status IN ('draft', 'posted', 'cancelled', 'reversed'));
    END IF;
END $$;

-- Add bank details columns
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'payments' AND column_name = 'bank_name'
    ) THEN
        ALTER TABLE payments ADD COLUMN bank_name VARCHAR(100);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'payments' AND column_name = 'bank_branch'
    ) THEN
        ALTER TABLE payments ADD COLUMN bank_branch VARCHAR(100);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'payments' AND column_name = 'cheque_number'
    ) THEN
        ALTER TABLE payments ADD COLUMN cheque_number VARCHAR(50);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'payments' AND column_name = 'cheque_date'
    ) THEN
        ALTER TABLE payments ADD COLUMN cheque_date DATE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'payments' AND column_name = 'reversed_at'
    ) THEN
        ALTER TABLE payments ADD COLUMN reversed_at TIMESTAMPTZ;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'payments' AND column_name = 'reversed_by'
    ) THEN
        ALTER TABLE payments ADD COLUMN reversed_by UUID REFERENCES users(id) ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'payments' AND column_name = 'reversal_reason'
    ) THEN
        ALTER TABLE payments ADD COLUMN reversal_reason TEXT;
    END IF;
END $$;

-- Expand payment_mode check constraint to also permit 'bank_transfer'
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'payments_payment_mode_check'
    ) THEN
        ALTER TABLE payments DROP CONSTRAINT payments_payment_mode_check;
    END IF;

    ALTER TABLE payments ADD CONSTRAINT payments_payment_mode_check 
    CHECK (payment_mode IN ('cash', 'upi', 'neft_rtgs', 'bank_transfer', 'cheque', 'legacy_reconciliation'));
END $$;

-- ----------------------------------------------------------------------------
-- 2. ENHANCE PAYMENT_ALLOCATIONS TABLE
-- ----------------------------------------------------------------------------

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'payment_allocations' AND column_name = 'status'
    ) THEN
        ALTER TABLE payment_allocations 
        ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'active' 
        CHECK (status IN ('active', 'reversed'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'payment_allocations' AND column_name = 'reversed_at'
    ) THEN
        ALTER TABLE payment_allocations ADD COLUMN reversed_at TIMESTAMPTZ;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'payment_allocations' AND column_name = 'reversed_by'
    ) THEN
        ALTER TABLE payment_allocations ADD COLUMN reversed_by UUID REFERENCES users(id) ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'payment_allocations' AND column_name = 'reversal_reason'
    ) THEN
        ALTER TABLE payment_allocations ADD COLUMN reversal_reason TEXT;
    END IF;
END $$;

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments (status);
CREATE INDEX IF NOT EXISTS idx_payment_allocations_status ON payment_allocations (status);
CREATE INDEX IF NOT EXISTS idx_payment_allocations_payment_status ON payment_allocations (payment_id, status);
CREATE INDEX IF NOT EXISTS idx_payment_allocations_invoice_status ON payment_allocations (invoice_id, status);

-- ----------------------------------------------------------------------------
-- 3. UPDATE STATUTORY & ANALYTICAL VIEWS
-- ----------------------------------------------------------------------------

-- View: v_invoice_balances (considers only active payment allocations)
CREATE OR REPLACE VIEW v_invoice_balances AS
SELECT 
    inv.id AS invoice_id,
    inv.invoice_number,
    inv.financial_year,
    inv.invoice_date,
    inv.customer_id,
    p.trade_name AS customer_name,
    p.state_code AS customer_state_code,
    inv.place_of_supply_state_code,
    inv.is_interstate,
    inv.taxable_value,
    inv.cgst_amount,
    inv.sgst_amount,
    inv.igst_amount,
    inv.total_invoice_value,
    COALESCE(pa.total_allocated, 0.00) AS total_paid_amount,
    COALESCE(cn.total_credited, 0.00) AS total_credited_amount,
    ROUND(inv.total_invoice_value - COALESCE(pa.total_allocated, 0.00) - COALESCE(cn.total_credited, 0.00), 2) AS outstanding_balance,
    CASE 
        WHEN inv.status = 'cancelled' THEN 'cancelled'
        WHEN (inv.total_invoice_value - COALESCE(pa.total_allocated, 0.00) - COALESCE(cn.total_credited, 0.00)) <= 0 THEN 'paid'
        WHEN COALESCE(pa.total_allocated, 0.00) > 0 THEN 'partially_paid'
        ELSE 'unpaid'
    END AS derived_payment_status,
    inv.status AS invoice_status,
    inv.created_at
FROM invoices inv
JOIN parties p ON inv.customer_id = p.id
LEFT JOIN (
    SELECT invoice_id, SUM(allocated_amount) AS total_allocated
    FROM payment_allocations
    WHERE status = 'active'
    GROUP BY invoice_id
) pa ON inv.id = pa.invoice_id
LEFT JOIN (
    SELECT invoice_id, SUM(total_credit_amount) AS total_credited
    FROM credit_notes
    GROUP BY invoice_id
) cn ON inv.id = cn.invoice_id;

-- View: v_customer_outstanding (considers only posted payments and active allocations)
CREATE OR REPLACE VIEW v_customer_outstanding AS
SELECT 
    p.id AS customer_id,
    p.trade_name AS customer_name,
    p.state_name,
    p.phone,
    p.credit_limit,
    COALESCE(SUM(ib.total_invoice_value), 0.00) AS total_billed,
    COALESCE(SUM(ib.total_paid_amount), 0.00) AS total_allocated_to_invoices,
    COALESCE(pay_tot.total_payments, 0.00) AS total_payments_received,
    -- Any excess posted payment not yet allocated to an invoice is an unallocated advance
    ROUND(COALESCE(pay_tot.total_payments, 0.00) - COALESCE(SUM(ib.total_paid_amount), 0.00), 2) AS unallocated_advances,
    COALESCE(SUM(ib.total_credited_amount), 0.00) AS total_credited,
    COALESCE(SUM(ib.outstanding_balance), 0.00) AS net_invoice_receivables,
    -- Statutory ageing buckets based on invoice date
    COALESCE(SUM(CASE WHEN CURRENT_DATE - ib.invoice_date <= 30 THEN ib.outstanding_balance ELSE 0 END), 0.00) AS ageing_0_to_30_days,
    COALESCE(SUM(CASE WHEN CURRENT_DATE - ib.invoice_date BETWEEN 31 AND 60 THEN ib.outstanding_balance ELSE 0 END), 0.00) AS ageing_31_to_60_days,
    COALESCE(SUM(CASE WHEN CURRENT_DATE - ib.invoice_date BETWEEN 61 AND 90 THEN ib.outstanding_balance ELSE 0 END), 0.00) AS ageing_61_to_90_days,
    COALESCE(SUM(CASE WHEN CURRENT_DATE - ib.invoice_date > 90 THEN ib.outstanding_balance ELSE 0 END), 0.00) AS ageing_over_90_days
FROM parties p
LEFT JOIN v_invoice_balances ib ON p.id = ib.customer_id AND ib.invoice_status <> 'cancelled'
LEFT JOIN (
    SELECT customer_id, SUM(total_amount) AS total_payments
    FROM payments
    WHERE status = 'posted'
    GROUP BY customer_id
) pay_tot ON p.id = pay_tot.customer_id
WHERE p.party_type IN ('customer', 'both')
GROUP BY p.id, p.trade_name, p.state_name, p.phone, p.credit_limit, pay_tot.total_payments;

-- ----------------------------------------------------------------------------
-- 4. ATOMIC PAYMENT ALLOCATION ENGINE (ENHANCED)
-- ----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS fn_allocate_payment(UUID, UUID, NUMERIC, UUID);
CREATE OR REPLACE FUNCTION fn_allocate_payment(
    p_payment_id UUID,
    p_invoice_id UUID,
    p_amount NUMERIC,
    p_user_id UUID
)
RETURNS UUID AS $$
DECLARE
    v_pay RECORD;
    v_inv RECORD;
    v_allocated_so_far NUMERIC(12, 2);
    v_inv_paid_so_far NUMERIC(12, 2);
    v_inv_credit_so_far NUMERIC(12, 2);
    v_allocation_id UUID;
    v_existing_alloc RECORD;
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

    IF v_pay.status <> 'posted' THEN
        RAISE EXCEPTION 'Allocation Error: Payment % is in status "%", only posted payments can be allocated.',
            v_pay.receipt_number, v_pay.status;
    END IF;

    -- Lock invoice record
    SELECT * INTO v_inv 
    FROM invoices 
    WHERE id = p_invoice_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invoice % not found.', p_invoice_id;
    END IF;

    IF v_inv.status NOT IN ('posted', 'dispatched') THEN
        RAISE EXCEPTION 'Allocation Error: Cannot allocate payment to invoice % in status "%". Invoice must be posted or dispatched.',
            v_inv.invoice_number, v_inv.status;
    END IF;

    -- 1. Prevent allocating across different customers
    IF v_pay.customer_id <> v_inv.customer_id THEN
        RAISE EXCEPTION 'Customer Mismatch: Invoice % belongs to customer %, but payment % is from customer %',
            v_inv.invoice_number, v_inv.customer_id, v_pay.receipt_number, v_pay.customer_id;
    END IF;

    -- Check if there's already an active allocation for this (payment_id, invoice_id)
    SELECT * INTO v_existing_alloc
    FROM payment_allocations
    WHERE payment_id = p_payment_id AND invoice_id = p_invoice_id AND status = 'active';

    -- 2. Guard against allocating more than the total payment amount
    SELECT COALESCE(SUM(allocated_amount), 0.00) 
    INTO v_allocated_so_far 
    FROM payment_allocations 
    WHERE payment_id = p_payment_id AND status = 'active';

    IF (v_allocated_so_far + p_amount) > v_pay.total_amount THEN
        RAISE EXCEPTION 'Over-allocation Error: Total allocated (%) plus attempted (%) exceeds payment total (%)',
            v_allocated_so_far, p_amount, v_pay.total_amount;
    END IF;

    -- 3. Guard against overpaying the invoice (accounting for active credit notes & allocations)
    SELECT COALESCE(SUM(allocated_amount), 0.00) 
    INTO v_inv_paid_so_far 
    FROM payment_allocations 
    WHERE invoice_id = p_invoice_id AND status = 'active';

    SELECT COALESCE(SUM(total_credit_amount), 0.00) 
    INTO v_inv_credit_so_far 
    FROM credit_notes 
    WHERE invoice_id = p_invoice_id;

    IF (v_inv_paid_so_far + v_inv_credit_so_far + p_amount) > v_inv.total_invoice_value THEN
        RAISE EXCEPTION 'Invoice Overpayment: Invoice total is %, already settled %, attempted allocation is %',
            v_inv.total_invoice_value, (v_inv_paid_so_far + v_inv_credit_so_far), p_amount;
    END IF;

    -- 4. Insert or update allocation
    IF v_existing_alloc.id IS NOT NULL THEN
        UPDATE payment_allocations
        SET allocated_amount = allocated_amount + p_amount,
            allocated_at = NOW(),
            allocated_by = p_user_id
        WHERE id = v_existing_alloc.id
        RETURNING id INTO v_allocation_id;
    ELSE
        -- If an old reversed allocation exists with this (payment_id, invoice_id), reuse or insert
        SELECT id INTO v_allocation_id
        FROM payment_allocations
        WHERE payment_id = p_payment_id AND invoice_id = p_invoice_id AND status = 'reversed';

        IF v_allocation_id IS NOT NULL THEN
            UPDATE payment_allocations
            SET allocated_amount = p_amount,
                status = 'active',
                allocated_at = NOW(),
                allocated_by = p_user_id,
                reversed_at = NULL,
                reversed_by = NULL,
                reversal_reason = NULL
            WHERE id = v_allocation_id;
        ELSE
            INSERT INTO payment_allocations (
                payment_id,
                invoice_id,
                allocated_amount,
                allocated_by,
                status
            ) VALUES (
                p_payment_id,
                p_invoice_id,
                p_amount,
                p_user_id,
                'active'
            )
            RETURNING id INTO v_allocation_id;
        END IF;
    END IF;

    RETURN v_allocation_id;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 5. ATOMIC PAYMENT REVERSAL & UNALLOCATION FUNCTIONS
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_reverse_payment(
    p_payment_id UUID,
    p_user_id UUID,
    p_reason TEXT
)
RETURNS VOID AS $$
DECLARE
    v_pay RECORD;
BEGIN
    IF p_reason IS NULL OR TRIM(p_reason) = '' THEN
        RAISE EXCEPTION 'Payment Reversal Error: Reversal reason is required.';
    END IF;

    SELECT * INTO v_pay 
    FROM payments 
    WHERE id = p_payment_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment % not found.', p_payment_id;
    END IF;

    IF v_pay.status = 'reversed' THEN
        RAISE EXCEPTION 'Payment Reversal Error: Payment % is already reversed.', v_pay.receipt_number;
    END IF;

    IF v_pay.status = 'cancelled' THEN
        RAISE EXCEPTION 'Payment Reversal Error: Payment % is cancelled.', v_pay.receipt_number;
    END IF;

    -- Update payment status to reversed
    UPDATE payments 
    SET status = 'reversed',
        reversed_at = NOW(),
        reversed_by = p_user_id,
        reversal_reason = TRIM(p_reason)
    WHERE id = p_payment_id;

    -- Mark all active allocations for this payment as reversed
    UPDATE payment_allocations 
    SET status = 'reversed',
        reversed_at = NOW(),
        reversed_by = p_user_id,
        reversal_reason = TRIM(p_reason)
    WHERE payment_id = p_payment_id AND status = 'active';

END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_unallocate_payment(
    p_allocation_id UUID,
    p_user_id UUID,
    p_reason TEXT
)
RETURNS VOID AS $$
DECLARE
    v_alloc RECORD;
    v_pay RECORD;
BEGIN
    IF p_reason IS NULL OR TRIM(p_reason) = '' THEN
        RAISE EXCEPTION 'Unallocation Error: Reversal reason is required.';
    END IF;

    SELECT * INTO v_alloc 
    FROM payment_allocations 
    WHERE id = p_allocation_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment allocation % not found.', p_allocation_id;
    END IF;

    IF v_alloc.status = 'reversed' THEN
        RAISE EXCEPTION 'Unallocation Error: Allocation is already reversed.';
    END IF;

    SELECT * INTO v_pay 
    FROM payments 
    WHERE id = v_alloc.payment_id 
    FOR UPDATE;

    -- Update allocation status to reversed
    UPDATE payment_allocations 
    SET status = 'reversed',
        reversed_at = NOW(),
        reversed_by = p_user_id,
        reversal_reason = TRIM(p_reason)
    WHERE id = p_allocation_id;

END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 6. IMMUTABILITY ENFORCEMENT TRIGGERS
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_prevent_posted_payment_modification()
RETURNS TRIGGER AS $$
BEGIN
    IF current_setting('session_replication_role', true) = 'replica' THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;

    IF TG_OP = 'DELETE' THEN
        IF OLD.status IN ('posted', 'reversed') THEN
            RAISE EXCEPTION 'Statutory Audit Violation: Cannot DELETE % payment "%". Financial transactions must be reversed via correction entries.',
                OLD.status, OLD.receipt_number;
        END IF;
        RETURN OLD;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF OLD.status = 'reversed' THEN
            RAISE EXCEPTION 'Statutory Audit Violation: Reversed payment "%" is strictly immutable and cannot be updated.',
                OLD.receipt_number;
        END IF;

        IF OLD.status = 'cancelled' THEN
            RAISE EXCEPTION 'Statutory Audit Violation: Cancelled payment "%" is immutable.',
                OLD.receipt_number;
        END IF;

        IF OLD.status = 'posted' THEN
            -- Only allow transition to 'reversed' with valid reversal metadata
            IF NEW.status = 'reversed' THEN
                IF NEW.total_amount <> OLD.total_amount OR
                   NEW.customer_id <> OLD.customer_id OR
                   NEW.payment_mode <> OLD.payment_mode OR
                   NEW.receipt_number <> OLD.receipt_number THEN
                    RAISE EXCEPTION 'Statutory Audit Violation: Core payment details cannot be altered during reversal.';
                END IF;
                RETURN NEW;
            ELSE
                RAISE EXCEPTION 'Statutory Audit Violation: Posted payment "%" cannot be modified. It must be reversed through the reversal workflow.',
                    OLD.receipt_number;
            END IF;
        END IF;

        IF OLD.status = 'draft' AND NEW.status NOT IN ('draft', 'posted', 'cancelled') THEN
            RAISE EXCEPTION 'Invalid status transition for draft payment from "%" to "%".',
                OLD.status, NEW.status;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_posted_payment_modify ON payments;
CREATE TRIGGER trg_prevent_posted_payment_modify
BEFORE UPDATE OR DELETE ON payments
FOR EACH ROW EXECUTE FUNCTION fn_prevent_posted_payment_modification();

CREATE OR REPLACE FUNCTION fn_prevent_payment_allocation_modification()
RETURNS TRIGGER AS $$
BEGIN
    IF current_setting('session_replication_role', true) = 'replica' THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;

    IF TG_OP = 'DELETE' THEN
        IF OLD.status = 'active' THEN
            RAISE EXCEPTION 'Statutory Audit Violation: Active payment allocations cannot be directly deleted. The allocation or payment must be reversed.';
        END IF;
        RETURN OLD;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF OLD.status = 'reversed' AND NEW.status <> 'active' THEN
            RAISE EXCEPTION 'Statutory Audit Violation: Reversed payment allocation is strictly immutable.';
        END IF;

        -- Allow status transition from active to reversed
        IF OLD.status = 'active' AND NEW.status = 'reversed' THEN
            RETURN NEW;
        END IF;

        -- Allow reactivating a previously reversed allocation (via fn_allocate_payment reuse)
        IF OLD.status = 'reversed' AND NEW.status = 'active' THEN
            RETURN NEW;
        END IF;

        -- Allow increasing allocation amount via fn_allocate_payment
        IF OLD.status = 'active' AND NEW.status = 'active' AND NEW.allocated_amount >= OLD.allocated_amount THEN
            RETURN NEW;
        END IF;

        RAISE EXCEPTION 'Statutory Audit Violation: Payment allocation cannot be modified.';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_active_allocation_modify ON payment_allocations;
CREATE TRIGGER trg_prevent_active_allocation_modify
BEFORE UPDATE OR DELETE ON payment_allocations
FOR EACH ROW EXECUTE FUNCTION fn_prevent_payment_allocation_modification();
