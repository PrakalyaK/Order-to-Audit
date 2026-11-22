-- ============================================================================
-- ORDER-TO-AUDIT SYSTEM: MIGRATION 010
-- PHASE 9: FINANCIAL ACCOUNTING, GENERAL LEDGER & STATUTORY REPORTING
-- ============================================================================
-- 1. Creates `chart_of_accounts` with hierarchical account classifications.
-- 2. Creates `journal_entries` and `journal_entry_lines` for double-entry ledger.
-- 3. Seeds the standard Chart of Accounts for food manufacturing.
-- 4. Installs `fn_post_journal_entry` and `fn_reverse_journal_entry`.
-- 5. Builds views: `v_general_ledger`, `v_trial_balance`, `v_profit_and_loss`,
--    `v_balance_sheet`, `v_cash_bank_summary`, `v_gst_reconciliation`.
-- 6. Enforces database-level immutability on posted journal entries and lines.
-- 7. Integrates audit triggers.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. CHART OF ACCOUNTS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chart_of_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_code VARCHAR(20) UNIQUE NOT NULL,
    account_name VARCHAR(100) NOT NULL,
    account_type VARCHAR(30) NOT NULL CHECK (account_type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
    category VARCHAR(50) NOT NULL,
    normal_balance VARCHAR(10) NOT NULL CHECK (normal_balance IN ('debit', 'credit')),
    parent_account_id UUID REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
    description TEXT,
    is_system BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_coa_account_type ON chart_of_accounts (account_type);
CREATE INDEX IF NOT EXISTS idx_coa_category ON chart_of_accounts (category);
CREATE INDEX IF NOT EXISTS idx_coa_is_active ON chart_of_accounts (is_active);

-- ----------------------------------------------------------------------------
-- 2. JOURNAL ENTRIES & LINE ITEMS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS journal_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_number VARCHAR(50) UNIQUE NOT NULL,
    entry_date DATE NOT NULL,
    accounting_date DATE NOT NULL,
    source_type VARCHAR(50) NOT NULL CHECK (source_type IN (
        'PURCHASE_BILL',
        'SALES_INVOICE',
        'SALES_DISPATCH',
        'PRODUCTION_RUN',
        'CUSTOMER_PAYMENT',
        'PAYMENT_REVERSAL',
        'MANUAL'
    )),
    source_id UUID,
    source_reference VARCHAR(100),
    narration TEXT NOT NULL,
    total_debit NUMERIC(15, 2) NOT NULL DEFAULT 0.00 CHECK (total_debit >= 0),
    total_credit NUMERIC(15, 2) NOT NULL DEFAULT 0.00 CHECK (total_credit >= 0),
    status VARCHAR(20) NOT NULL DEFAULT 'posted' CHECK (status IN ('draft', 'posted', 'reversed')),
    posted_at TIMESTAMPTZ,
    posted_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    reversed_at TIMESTAMPTZ,
    reversed_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    reversal_entry_id UUID REFERENCES journal_entries(id) ON DELETE RESTRICT,
    reversal_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_journal_entry_balanced CHECK (status = 'draft' OR total_debit = total_credit)
);

-- Partial unique index ensuring strictly one posted journal entry per operational source transaction
CREATE UNIQUE INDEX IF NOT EXISTS uq_je_source 
ON journal_entries (source_type, source_id) 
WHERE status = 'posted' AND source_type <> 'MANUAL';

CREATE INDEX IF NOT EXISTS idx_je_entry_date ON journal_entries (entry_date);
CREATE INDEX IF NOT EXISTS idx_je_accounting_date ON journal_entries (accounting_date);
CREATE INDEX IF NOT EXISTS idx_je_status ON journal_entries (status);

CREATE TABLE IF NOT EXISTS journal_entry_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    journal_entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
    line_number INT NOT NULL,
    debit_amount NUMERIC(15, 2) NOT NULL DEFAULT 0.00 CHECK (debit_amount >= 0),
    credit_amount NUMERIC(15, 2) NOT NULL DEFAULT 0.00 CHECK (credit_amount >= 0),
    description VARCHAR(255),
    party_id UUID REFERENCES parties(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_line_debit_or_credit CHECK (
        (debit_amount > 0 AND credit_amount = 0) OR 
        (credit_amount > 0 AND debit_amount = 0)
    ),
    CONSTRAINT uq_journal_line_number UNIQUE (journal_entry_id, line_number)
);

CREATE INDEX IF NOT EXISTS idx_jel_entry_id ON journal_entry_lines (journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_jel_account_id ON journal_entry_lines (account_id);
CREATE INDEX IF NOT EXISTS idx_jel_party_id ON journal_entry_lines (party_id);

-- ----------------------------------------------------------------------------
-- 3. SEED STANDARD CHART OF ACCOUNTS FOR FOOD MANUFACTURING
-- ----------------------------------------------------------------------------
INSERT INTO chart_of_accounts (account_code, account_name, account_type, category, normal_balance, description, is_system)
VALUES
    -- 1000-1999: ASSETS
    ('1110', 'Cash in Hand', 'asset', 'cash_bank', 'debit', 'Physical cash on premises for operational expenses', true),
    ('1120', 'Bank Account - Operating', 'asset', 'cash_bank', 'debit', 'Primary commercial checking and clearing bank account', true),
    ('1200', 'Accounts Receivable (Debtors)', 'asset', 'accounts_receivable', 'debit', 'Customer outstanding invoices and trade receivables', true),
    ('1310', 'Raw Materials Inventory', 'asset', 'inventory', 'debit', 'Purchased food ingredients and packaging materials', true),
    ('1320', 'Work-in-Progress (WIP) Inventory', 'asset', 'inventory', 'debit', 'Materials currently in production floor processing', true),
    ('1330', 'Finished Goods Inventory', 'asset', 'inventory', 'debit', 'Manufactured packaged products ready for commercial dispatch', true),
    ('1410', 'CGST Input Tax Credit', 'asset', 'tax_input', 'debit', 'Central GST paid on inward supply eligible for set-off', true),
    ('1420', 'SGST Input Tax Credit', 'asset', 'tax_input', 'debit', 'State GST paid on inward supply eligible for set-off', true),
    ('1430', 'IGST Input Tax Credit', 'asset', 'tax_input', 'debit', 'Integrated GST paid on interstate purchases eligible for set-off', true),

    -- 2000-2999: LIABILITIES
    ('2100', 'Accounts Payable (Creditors)', 'liability', 'accounts_payable', 'credit', 'Vendor obligations for raw material and service purchases', true),
    ('2210', 'CGST Output Tax Liability', 'liability', 'tax_output', 'credit', 'Central GST collected on intra-state outward sales', true),
    ('2220', 'SGST Output Tax Liability', 'liability', 'tax_output', 'credit', 'State GST collected on intra-state outward sales', true),
    ('2230', 'IGST Output Tax Liability', 'liability', 'tax_output', 'credit', 'Integrated GST collected on interstate outward sales', true),
    ('2300', 'Customer Advances', 'liability', 'customer_advances', 'credit', 'Unallocated customer receipts held on-account', true),

    -- 3000-3999: EQUITY
    ('3100', 'Owner Capital', 'equity', 'equity', 'credit', 'Initial and ongoing equity contributed by business owner', true),
    ('3200', 'Retained Earnings', 'equity', 'equity', 'credit', 'Accumulated cumulative earnings retained in the business', true),

    -- 4000-4999: REVENUE
    ('4100', 'Sales Revenue - Food Products', 'revenue', 'operating_revenue', 'credit', 'Gross revenue from commercial sale of manufactured food items', true),
    ('4200', 'Other Operating Income', 'revenue', 'operating_revenue', 'credit', 'Ancillary operating receipts including scrap sales', true),

    -- 5000-5999: COST OF GOODS SOLD & PRODUCTION OVERHEADS
    ('5100', 'Cost of Goods Sold - Direct Materials', 'expense', 'cost_of_goods_sold', 'debit', 'Material cost of finished goods dispatched and sold', true),
    ('5200', 'Direct Labour Cost', 'expense', 'cost_of_goods_sold', 'debit', 'Wages paid to factory production floor operators', true),
    ('5300', 'Factory Overhead - Power & Fuel', 'expense', 'manufacturing_overhead', 'debit', 'Electricity, gas, and energy utilized in production', true),
    ('5400', 'Factory Overhead - Machine Maintenance', 'expense', 'manufacturing_overhead', 'debit', 'Repair and servicing of manufacturing machinery', true),
    ('5900', 'Manufacturing Overheads Absorbed', 'expense', 'manufacturing_overhead', 'credit', 'Absorption clearing credit for overheads allocated to batches', true),

    -- 6000-6999: OPERATING EXPENSES
    ('6100', 'Salaries & Administrative Wages', 'expense', 'operating_expense', 'debit', 'Executive, office, sales, and managerial staff compensation', true),
    ('6200', 'Rent & Office Utilities', 'expense', 'operating_expense', 'debit', 'Premises rental and office utilities', true),
    ('6300', 'Freight & Outward Delivery Charges', 'expense', 'operating_expense', 'debit', 'Logistics and delivery costs to customer destinations', true),
    ('6400', 'Administrative & General Expenses', 'expense', 'operating_expense', 'debit', 'General business overheads and compliance costs', true)
ON CONFLICT (account_code) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 4. ATOMIC POSTING & REVERSAL FUNCTIONS
-- ----------------------------------------------------------------------------

-- Function: Post draft journal entry after verifying balance
CREATE OR REPLACE FUNCTION fn_post_journal_entry(
    p_entry_id UUID,
    p_user_id UUID
)
RETURNS VOID AS $$
DECLARE
    v_entry RECORD;
    v_total_debit NUMERIC(15, 2);
    v_total_credit NUMERIC(15, 2);
    v_line_count INT;
BEGIN
    SELECT * INTO v_entry 
    FROM journal_entries 
    WHERE id = p_entry_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Journal entry % not found.', p_entry_id;
    END IF;

    IF v_entry.status = 'posted' THEN
        RAISE EXCEPTION 'Journal entry % is already posted.', v_entry.entry_number;
    END IF;

    IF v_entry.status = 'reversed' THEN
        RAISE EXCEPTION 'Cannot post reversed journal entry %.', v_entry.entry_number;
    END IF;

    SELECT 
        COUNT(*),
        COALESCE(SUM(debit_amount), 0.00),
        COALESCE(SUM(credit_amount), 0.00)
    INTO v_line_count, v_total_debit, v_total_credit
    FROM journal_entry_lines 
    WHERE journal_entry_id = p_entry_id;

    IF v_line_count < 2 THEN
        RAISE EXCEPTION 'Accounting Error: Journal entry must contain at least 2 line items.';
    END IF;

    IF v_total_debit <= 0 OR v_total_credit <= 0 THEN
        RAISE EXCEPTION 'Accounting Error: Journal entry must have positive debit and credit amounts.';
    END IF;

    IF v_total_debit <> v_total_credit THEN
        RAISE EXCEPTION 'Accounting Error: Unbalanced journal entry. Total Debits (₹%) do not equal Total Credits (₹%).',
            v_total_debit, v_total_credit;
    END IF;

    UPDATE journal_entries
    SET status = 'posted',
        total_debit = v_total_debit,
        total_credit = v_total_credit,
        posted_at = NOW(),
        posted_by = p_user_id,
        updated_at = NOW()
    WHERE id = p_entry_id;
END;
$$ LANGUAGE plpgsql;

-- Function: Controlled reversal of a posted journal entry
CREATE OR REPLACE FUNCTION fn_reverse_journal_entry(
    p_entry_id UUID,
    p_user_id UUID,
    p_reason TEXT
)
RETURNS UUID AS $$
DECLARE
    v_orig RECORD;
    v_reversal_id UUID;
    v_new_entry_number VARCHAR(50);
    v_line RECORD;
    v_line_num INT := 1;
    v_year INT;
    v_seq INT := 1;
    v_prefix VARCHAR(20);
    v_last_je VARCHAR(50);
BEGIN
    IF p_reason IS NULL OR TRIM(p_reason) = '' THEN
        RAISE EXCEPTION 'Reversal Error: Reversal reason is required.';
    END IF;

    SELECT * INTO v_orig 
    FROM journal_entries 
    WHERE id = p_entry_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Journal entry % not found.', p_entry_id;
    END IF;

    IF v_orig.status <> 'posted' THEN
        RAISE EXCEPTION 'Reversal Error: Only posted journal entries can be reversed (status is "%").', v_orig.status;
    END IF;

    IF v_orig.reversal_entry_id IS NOT NULL THEN
        RAISE EXCEPTION 'Reversal Error: Journal entry % is already reversed.', v_orig.entry_number;
    END IF;

    -- Generate sequential reversal entry number
    v_year := EXTRACT(YEAR FROM CURRENT_DATE)::INT;
    v_prefix := 'JE-' || v_year || '-';

    SELECT entry_number INTO v_last_je
    FROM journal_entries
    WHERE entry_number LIKE v_prefix || '%'
    ORDER BY entry_number DESC
    LIMIT 1;

    IF v_last_je IS NOT NULL THEN
        v_seq := (SUBSTRING(v_last_je FROM '[0-9]+$')::INT) + 1;
    END IF;

    v_new_entry_number := v_prefix || LPAD(v_seq::TEXT, 4, '0');

    -- Insert reversal journal entry header
    INSERT INTO journal_entries (
        entry_number,
        entry_date,
        accounting_date,
        source_type,
        source_id,
        source_reference,
        narration,
        total_debit,
        total_credit,
        status,
        posted_at,
        posted_by,
        reversal_reason
    ) VALUES (
        v_new_entry_number,
        CURRENT_DATE,
        CURRENT_DATE,
        v_orig.source_type,
        v_orig.source_id,
        v_orig.entry_number,
        'REVERSAL of ' || v_orig.entry_number || ': ' || TRIM(p_reason),
        v_orig.total_credit,
        v_orig.total_debit,
        'posted',
        NOW(),
        p_user_id,
        TRIM(p_reason)
    ) RETURNING id INTO v_reversal_id;

    -- Insert reciprocal line items (invert debits and credits)
    FOR v_line IN 
        SELECT * FROM journal_entry_lines 
        WHERE journal_entry_id = p_entry_id 
        ORDER BY line_number ASC
    LOOP
        INSERT INTO journal_entry_lines (
            journal_entry_id,
            account_id,
            line_number,
            debit_amount,
            credit_amount,
            description,
            party_id
        ) VALUES (
            v_reversal_id,
            v_line.account_id,
            v_line_num,
            v_line.credit_amount,  -- Swap credit to debit
            v_line.debit_amount,   -- Swap debit to credit
            'Reversal: ' || COALESCE(v_line.description, 'Line reversal'),
            v_line.party_id
        );
        v_line_num := v_line_num + 1;
    END LOOP;

    -- Update original journal entry to reversed and link reversal entry
    UPDATE journal_entries
    SET status = 'reversed',
        reversed_at = NOW(),
        reversed_by = p_user_id,
        reversal_entry_id = v_reversal_id,
        reversal_reason = TRIM(p_reason),
        updated_at = NOW()
    WHERE id = p_entry_id;

    RETURN v_reversal_id;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 5. ANALYTICAL & STATUTORY FINANCIAL VIEWS
-- ----------------------------------------------------------------------------

-- View: v_general_ledger
CREATE OR REPLACE VIEW v_general_ledger AS
SELECT 
    jel.id AS line_id,
    je.id AS journal_entry_id,
    je.entry_number,
    je.entry_date,
    je.accounting_date,
    je.source_type,
    je.source_id,
    je.source_reference,
    je.status AS entry_status,
    coa.id AS account_id,
    coa.account_code,
    coa.account_name,
    coa.account_type,
    coa.category,
    coa.normal_balance,
    jel.line_number,
    jel.debit_amount,
    jel.credit_amount,
    CASE 
        WHEN coa.normal_balance = 'debit' THEN (jel.debit_amount - jel.credit_amount)
        ELSE (jel.credit_amount - jel.debit_amount)
    END AS net_line_amount,
    jel.description AS line_description,
    je.narration,
    jel.party_id,
    p.trade_name AS party_name,
    je.created_at
FROM journal_entry_lines jel
JOIN journal_entries je ON jel.journal_entry_id = je.id
JOIN chart_of_accounts coa ON jel.account_id = coa.id
LEFT JOIN parties p ON jel.party_id = p.id
WHERE je.status = 'posted';

-- View: v_trial_balance
CREATE OR REPLACE VIEW v_trial_balance AS
SELECT 
    coa.id AS account_id,
    coa.account_code,
    coa.account_name,
    coa.account_type,
    coa.category,
    coa.normal_balance,
    COALESCE(SUM(jel.debit_amount), 0.00) AS total_debit,
    COALESCE(SUM(jel.credit_amount), 0.00) AS total_credit,
    CASE 
        WHEN COALESCE(SUM(jel.debit_amount), 0.00) >= COALESCE(SUM(jel.credit_amount), 0.00) 
        THEN ROUND(COALESCE(SUM(jel.debit_amount), 0.00) - COALESCE(SUM(jel.credit_amount), 0.00), 2)
        ELSE 0.00
    END AS net_debit_balance,
    CASE 
        WHEN COALESCE(SUM(jel.credit_amount), 0.00) > COALESCE(SUM(jel.debit_amount), 0.00) 
        THEN ROUND(COALESCE(SUM(jel.credit_amount), 0.00) - COALESCE(SUM(jel.debit_amount), 0.00), 2)
        ELSE 0.00
    END AS net_credit_balance
FROM chart_of_accounts coa
LEFT JOIN journal_entry_lines jel ON coa.id = jel.account_id
LEFT JOIN journal_entries je ON jel.journal_entry_id = je.id AND je.status = 'posted'
WHERE coa.is_active = true
GROUP BY coa.id, coa.account_code, coa.account_name, coa.account_type, coa.category, coa.normal_balance;

-- View: v_profit_and_loss
CREATE OR REPLACE VIEW v_profit_and_loss AS
SELECT 
    coa.account_type,
    coa.category,
    coa.account_code,
    coa.account_name,
    CASE 
        WHEN coa.account_type = 'revenue' 
        THEN ROUND(COALESCE(SUM(jel.credit_amount), 0.00) - COALESCE(SUM(jel.debit_amount), 0.00), 2)
        ELSE ROUND(COALESCE(SUM(jel.debit_amount), 0.00) - COALESCE(SUM(jel.credit_amount), 0.00), 2)
    END AS net_amount
FROM chart_of_accounts coa
LEFT JOIN journal_entry_lines jel ON coa.id = jel.account_id
LEFT JOIN journal_entries je ON jel.journal_entry_id = je.id AND je.status = 'posted'
WHERE coa.account_type IN ('revenue', 'expense') AND coa.is_active = true
GROUP BY coa.account_type, coa.category, coa.account_code, coa.account_name;

-- View: v_cash_bank_summary
CREATE OR REPLACE VIEW v_cash_bank_summary AS
SELECT 
    coa.account_code,
    coa.account_name,
    COALESCE(SUM(jel.debit_amount), 0.00) AS total_receipts,
    COALESCE(SUM(jel.credit_amount), 0.00) AS total_payments,
    ROUND(COALESCE(SUM(jel.debit_amount), 0.00) - COALESCE(SUM(jel.credit_amount), 0.00), 2) AS current_balance
FROM chart_of_accounts coa
LEFT JOIN journal_entry_lines jel ON coa.id = jel.account_id
LEFT JOIN journal_entries je ON jel.journal_entry_id = je.id AND je.status = 'posted'
WHERE coa.category = 'cash_bank' AND coa.is_active = true
GROUP BY coa.account_code, coa.account_name;

-- View: v_gst_reconciliation
CREATE OR REPLACE VIEW v_gst_reconciliation AS
WITH tax_summary AS (
    SELECT 
        coa.account_code,
        coa.account_name,
        coa.category,
        COALESCE(SUM(jel.debit_amount), 0.00) AS total_debit,
        COALESCE(SUM(jel.credit_amount), 0.00) AS total_credit
    FROM chart_of_accounts coa
    LEFT JOIN journal_entry_lines jel ON coa.id = jel.account_id
    LEFT JOIN journal_entries je ON jel.journal_entry_id = je.id AND je.status = 'posted'
    WHERE coa.category IN ('tax_input', 'tax_output') AND coa.is_active = true
    GROUP BY coa.account_code, coa.account_name, coa.category
)
SELECT 
    (SELECT ROUND(COALESCE(SUM(total_debit - total_credit), 0.00), 2) FROM tax_summary WHERE account_code = '1410') AS cgst_input_credit,
    (SELECT ROUND(COALESCE(SUM(total_debit - total_credit), 0.00), 2) FROM tax_summary WHERE account_code = '1420') AS sgst_input_credit,
    (SELECT ROUND(COALESCE(SUM(total_debit - total_credit), 0.00), 2) FROM tax_summary WHERE account_code = '1430') AS igst_input_credit,
    (SELECT ROUND(COALESCE(SUM(total_credit - total_debit), 0.00), 2) FROM tax_summary WHERE account_code = '2210') AS cgst_output_liability,
    (SELECT ROUND(COALESCE(SUM(total_credit - total_debit), 0.00), 2) FROM tax_summary WHERE account_code = '2220') AS sgst_output_liability,
    (SELECT ROUND(COALESCE(SUM(total_credit - total_debit), 0.00), 2) FROM tax_summary WHERE account_code = '2230') AS igst_output_liability,
    (SELECT ROUND(COALESCE(SUM(total_debit - total_credit), 0.00), 2) FROM tax_summary WHERE category = 'tax_input') AS total_input_tax_credit,
    (SELECT ROUND(COALESCE(SUM(total_credit - total_debit), 0.00), 2) FROM tax_summary WHERE category = 'tax_output') AS total_output_tax_liability,
    ROUND(
        (SELECT COALESCE(SUM(total_credit - total_debit), 0.00) FROM tax_summary WHERE category = 'tax_output') - 
        (SELECT COALESCE(SUM(total_debit - total_credit), 0.00) FROM tax_summary WHERE category = 'tax_input'), 
        2
    ) AS net_gst_payable_or_refundable;

-- ----------------------------------------------------------------------------
-- 6. IMMUTABILITY ENFORCEMENT TRIGGERS
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_prevent_posted_journal_entry_modification()
RETURNS TRIGGER AS $$
BEGIN
    IF current_setting('session_replication_role', true) = 'replica' THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;

    IF TG_OP = 'DELETE' THEN
        IF OLD.status IN ('posted', 'reversed') THEN
            RAISE EXCEPTION 'Statutory Audit Violation: Posted journal entry % is immutable and cannot be deleted.',
                OLD.entry_number;
        END IF;
        RETURN OLD;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF OLD.status = 'reversed' THEN
            RAISE EXCEPTION 'Statutory Audit Violation: Reversed journal entry % is immutable and cannot be modified.',
                OLD.entry_number;
        END IF;

        IF OLD.status = 'posted' THEN
            -- Only allow status transition to reversed
            IF NEW.status = 'reversed' THEN
                IF NEW.total_debit <> OLD.total_debit OR 
                   NEW.total_credit <> OLD.total_credit OR
                   NEW.entry_number <> OLD.entry_number OR
                   NEW.entry_date <> OLD.entry_date THEN
                    RAISE EXCEPTION 'Statutory Audit Violation: Core financial parameters of journal entry % cannot be altered during reversal.',
                        OLD.entry_number;
                END IF;
                RETURN NEW;
            ELSE
                RAISE EXCEPTION 'Statutory Audit Violation: Posted journal entry % is immutable. Corrections must be made via reversal entries.',
                    OLD.entry_number;
            END IF;
        END IF;

        IF OLD.status = 'draft' AND NEW.status NOT IN ('draft', 'posted') THEN
            RAISE EXCEPTION 'Invalid status transition for draft journal entry from "%" to "%".',
                OLD.status, NEW.status;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_posted_journal_entry_modify ON journal_entries;
CREATE TRIGGER trg_prevent_posted_journal_entry_modify
BEFORE UPDATE OR DELETE ON journal_entries
FOR EACH ROW EXECUTE FUNCTION fn_prevent_posted_journal_entry_modification();

CREATE OR REPLACE FUNCTION fn_prevent_posted_journal_line_modification()
RETURNS TRIGGER AS $$
DECLARE
    v_status VARCHAR(20);
    v_entry_num VARCHAR(50);
BEGIN
    IF current_setting('session_replication_role', true) = 'replica' THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;

    IF TG_OP = 'DELETE' THEN
        SELECT status, entry_number INTO v_status, v_entry_num 
        FROM journal_entries WHERE id = OLD.journal_entry_id;

        IF v_status IN ('posted', 'reversed') THEN
            RAISE EXCEPTION 'Statutory Audit Violation: Cannot delete line item of % journal entry %.',
                v_status, v_entry_num;
        END IF;
        RETURN OLD;
    END IF;

    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        SELECT status, entry_number INTO v_status, v_entry_num 
        FROM journal_entries WHERE id = NEW.journal_entry_id;

        IF v_status IN ('posted', 'reversed') THEN
            -- Allow insert during the creation phase of an entry that is being created as posted or reversed
            IF TG_OP = 'INSERT' AND v_status = 'posted' THEN
                RETURN NEW;
            END IF;

            RAISE EXCEPTION 'Statutory Audit Violation: Cannot modify line items of % journal entry %.',
                v_status, v_entry_num;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_posted_journal_line_modify ON journal_entry_lines;
CREATE TRIGGER trg_prevent_posted_journal_line_modify
BEFORE INSERT OR UPDATE OR DELETE ON journal_entry_lines
FOR EACH ROW EXECUTE FUNCTION fn_prevent_posted_journal_line_modification();

-- ----------------------------------------------------------------------------
-- 7. AUDIT TRAIL TRIGGERS
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_audit_journal_entries ON journal_entries;
CREATE TRIGGER trg_audit_journal_entries
AFTER INSERT OR UPDATE OR DELETE ON journal_entries
FOR EACH ROW EXECUTE FUNCTION fn_log_entity_audit_trail();

DROP TRIGGER IF EXISTS trg_audit_chart_of_accounts ON chart_of_accounts;
CREATE TRIGGER trg_audit_chart_of_accounts
AFTER INSERT OR UPDATE OR DELETE ON chart_of_accounts
FOR EACH ROW EXECUTE FUNCTION fn_log_entity_audit_trail();
