-- ============================================================================
-- ORDER-TO-AUDIT SYSTEM: DATABASE MIGRATION 005
-- Analytical Views: True Moving WAC Stock, Allocations & Statutory Reports
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. REAL-TIME CURRENT STOCK BALANCE & TRUE MOVING WAC VIEW
-- Uses item_stock_balances (maintained via transactional posting engine)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_current_stock AS
SELECT 
    i.id AS item_id,
    i.sku,
    i.name AS item_name,
    i.item_type,
    i.base_uom_id,
    i.packets_per_carton,
    COALESCE(sb.current_base_qty, 0.0000) AS closing_stock_base_qty,
    -- Equivalent cartons for finished goods based on product-specific conversion
    CASE 
        WHEN i.packets_per_carton > 1 AND i.item_type = 'finished_good'
        THEN ROUND(COALESCE(sb.current_base_qty, 0.0000) / i.packets_per_carton, 2)
        ELSE NULL
    END AS equivalent_cartons,
    -- Continuous Moving Weighted Average Cost (WAC)
    COALESCE(sb.current_moving_wac, i.standard_purchase_rate) AS current_moving_wac,
    COALESCE(sb.current_total_value, 0.00) AS total_stock_valuation,
    i.min_reorder_level,
    CASE 
        WHEN COALESCE(sb.current_base_qty, 0.0000) <= i.min_reorder_level 
        THEN true 
        ELSE false 
    END AS is_low_stock_alert,
    sb.last_transaction_timestamp
FROM items i
LEFT JOIN item_stock_balances sb ON i.id = sb.item_id;

-- ----------------------------------------------------------------------------
-- 2. AUDITOR STOCK LEDGER (Detailed Movement Register)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_stock_ledger AS
SELECT 
    l.id AS ledger_id,
    l.transaction_timestamp,
    i.sku,
    i.name AS item_name,
    i.item_type,
    l.movement_type,
    l.transaction_qty,
    l.transaction_uom_id,
    l.base_quantity_delta,
    i.base_uom_id,
    l.unit_cost,
    l.total_cost,
    l.source_reference_label,
    l.batch_number,
    l.expiry_date,
    u.full_name AS recorded_by_user
FROM inventory_ledger l
JOIN items i ON l.item_id = i.id
JOIN users u ON l.created_by = u.id
ORDER BY l.transaction_timestamp DESC, l.id DESC;

-- ----------------------------------------------------------------------------
-- 3. INVOICE BALANCES & PAYMENT STATUS DERIVED FROM ALLOCATIONS
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_invoice_balances AS
SELECT 
    inv.id AS invoice_id,
    inv.invoice_number,
    inv.financial_year,
    inv.invoice_date,
    p.id AS customer_id,
    p.trade_name AS customer_name,
    p.state_code AS customer_state_code,
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
    GROUP BY invoice_id
) pa ON inv.id = pa.invoice_id
LEFT JOIN (
    SELECT invoice_id, SUM(total_credit_amount) AS total_credited
    FROM credit_notes
    GROUP BY invoice_id
) cn ON inv.id = cn.invoice_id;

-- ----------------------------------------------------------------------------
-- 4. CUSTOMER RECEIVABLES & UNALLOCATED ADVANCES SUMMARY
-- ----------------------------------------------------------------------------
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
    -- Any excess payment not yet allocated to an invoice is an on-account advance
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
    GROUP BY customer_id
) pay_tot ON p.id = pay_tot.customer_id
WHERE p.party_type IN ('customer', 'both')
GROUP BY p.id, p.trade_name, p.state_name, p.phone, p.credit_limit, pay_tot.total_payments;

-- ----------------------------------------------------------------------------
-- 5. PRODUCTION VARIANCE & MASS BALANCE VIEW
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_production_variance AS
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

-- ----------------------------------------------------------------------------
-- 6. GST OUTWARD SUPPLIES REGISTER (GSTR-1 / GSTR-3B Mapping)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_gst_outward_summary AS
SELECT 
    inv.financial_year,
    TO_CHAR(inv.invoice_date, 'YYYY-MM') AS tax_period,
    inv.place_of_supply_state_code,
    inv.is_interstate,
    ii.gst_rate_pct,
    COUNT(DISTINCT inv.id) AS invoice_count,
    SUM(ii.taxable_value) AS total_taxable_value,
    SUM(ii.cgst_amount) AS total_cgst,
    SUM(ii.sgst_amount) AS total_sgst,
    SUM(ii.igst_amount) AS total_igst,
    SUM(ii.total_item_value) AS total_gross_value
FROM invoices inv
JOIN invoice_items ii ON inv.id = ii.invoice_id
WHERE inv.status <> 'cancelled'
GROUP BY 
    inv.financial_year, 
    TO_CHAR(inv.invoice_date, 'YYYY-MM'), 
    inv.place_of_supply_state_code, 
    inv.is_interstate, 
    ii.gst_rate_pct
ORDER BY tax_period DESC, place_of_supply_state_code;
