-- ============================================================================
-- ORDER-TO-AUDIT SYSTEM: BENCHMARK VERIFICATION SCRIPT
-- Queries verifying each business rule and expected result from Section 5
-- ============================================================================

-- ----------------------------------------------------------------------------
-- RULE 1: INVENTORY BALANCES & TRUE MOVING WAC RECONCILIATION
-- Expected:
--   Flour: 120 kg @ ₹43.1250/kg = ₹5,175.00
--   Oil: 19.5 L @ ₹140.00/L = ₹2,730.00
--   Pouches: 306 pcs @ ₹2.50 = ₹765.00
--   Cartons: 21 pcs @ ₹15.00 = ₹315.00
--   Finished Murukku 200g: 88 pkts @ ₹30.9034/pkt = ₹2,719.50 (4.4 Cartons equivalent)
-- ----------------------------------------------------------------------------
SELECT 
    sku,
    item_name,
    item_type,
    closing_stock_base_qty,
    base_uom_id,
    equivalent_cartons,
    current_moving_wac AS moving_wac_rate,
    total_stock_valuation,
    is_low_stock_alert
FROM v_current_stock
ORDER BY item_type, sku;

-- ----------------------------------------------------------------------------
-- RULE 2: PRODUCTION RUN YIELD & TOLERANCE ALERT
-- Expected: 188 actual vs 200 planned (-6.00% yield variance, FLAGGED)
-- ----------------------------------------------------------------------------
SELECT 
    run_number,
    finished_good_name,
    planned_batch_count,
    planned_yield_qty,
    actual_good_output_qty,
    yield_variance_qty,
    yield_variance_pct || '%' AS yield_variance,
    is_yield_flagged
FROM v_production_variance
GROUP BY run_number, finished_good_name, planned_batch_count, planned_yield_qty, actual_good_output_qty, yield_variance_qty, yield_variance_pct, is_yield_flagged;

-- ----------------------------------------------------------------------------
-- RULE 3: MATERIAL CONSUMPTION VARIANCE & MASS BALANCE TRACKING
-- Expected:
--   Oil: 10.5 L vs 10.0 L planned (+5.00% variance, FLAGGED)
--   Pouches: 194 issued (188 good + 6 damaged scrap + 0 returned), deducted ONCE
-- ----------------------------------------------------------------------------
SELECT 
    material_name,
    planned_qty,
    actual_issued_qty,
    good_production_qty,
    damaged_or_scrap_qty,
    returned_to_store_qty,
    base_net_consumed_qty,
    consumption_variance_qty,
    consumption_variance_pct || '%' AS consumption_variance,
    is_consumption_flagged,
    unit_cost_applied AS moving_wac_applied,
    total_material_cost
FROM v_production_variance
WHERE run_number = 'PR-2026-11-001'
ORDER BY material_name;

-- ----------------------------------------------------------------------------
-- RULE 4: BATCH COSTING & MARGIN ANALYSIS
-- Expected:
--   Raw Materials: ₹3,435.00
--   Packaging: ₹620.00
--   Direct Overheads: ₹1,800.00
--   Gross Total Batch Cost: ₹5,855.00
--   Good Output: 188 pkts
--   Cost per Packet: ₹31.1436 (~ ₹31.14)
--   Selling Price: ₹50.00
--   Gross Margin: ₹18.86 per packet (37.71%)
-- ----------------------------------------------------------------------------
SELECT 
    pr.run_number,
    c.total_raw_material_cost,
    c.total_packaging_cost,
    c.total_direct_overhead_cost,
    c.gross_total_batch_cost,
    c.good_output_units,
    c.cost_per_packet,
    c.selling_price_per_packet,
    c.unit_gross_margin,
    c.gross_margin_pct || '%' AS gross_margin,
    c.valuation_method_used
FROM production_run_costing c
JOIN production_runs pr ON c.production_run_id = pr.id;

-- ----------------------------------------------------------------------------
-- RULE 5: RETAILER A INVOICE & DERIVED OUTSTANDING VIA ALLOCATIONS
-- Expected:
--   Taxable: ₹7,500.00
--   CGST (2.5%): ₹187.50
--   SGST (2.5%): ₹187.50
--   Total Invoice: ₹7,875.00
--   Allocated Paid: ₹4,000.00
--   Outstanding Balance: ₹3,875.00
--   Derived Payment Status: 'partially_paid'
-- ----------------------------------------------------------------------------
SELECT 
    invoice_number,
    customer_name,
    place_of_supply_state_code,
    is_interstate,
    taxable_value,
    cgst_amount,
    sgst_amount,
    igst_amount,
    total_invoice_value,
    total_paid_amount,
    total_credited_amount,
    outstanding_balance,
    derived_payment_status
FROM v_invoice_balances
WHERE customer_name = 'Retailer A';

-- ----------------------------------------------------------------------------
-- RULE 6: CUSTOMER OUTSTANDING & UNALLOCATED ADVANCES SUMMARY
-- ----------------------------------------------------------------------------
SELECT 
    customer_name,
    state_name,
    total_billed,
    total_allocated_to_invoices,
    total_payments_received,
    unallocated_advances,
    net_invoice_receivables,
    ageing_0_to_30_days,
    ageing_31_to_60_days
FROM v_customer_outstanding
WHERE customer_name = 'Retailer A';

-- ----------------------------------------------------------------------------
-- RULE 7: DISTRIBUTOR B STOCK PRE-CHECK & SHORTAGE FLAG
-- Expected: 88 available vs 120 ordered -> Shortage of 32 packets flagged!
-- ----------------------------------------------------------------------------
SELECT 
    so.order_number,
    p.trade_name AS customer_name,
    p.state_name AS customer_state,
    soi.item_name_snapshot,
    soi.ordered_qty,
    (SELECT closing_stock_base_qty FROM v_current_stock WHERE sku = 'FG-MRK-200G') AS available_finished_stock,
    (soi.ordered_qty - (SELECT closing_stock_base_qty FROM v_current_stock WHERE sku = 'FG-MRK-200G')) AS shortage_qty,
    so.status,
    so.notes AS system_alert
FROM sales_orders so
JOIN parties p ON so.customer_id = p.id
JOIN sales_order_items soi ON so.id = soi.sales_order_id
WHERE p.trade_name = 'Distributor B';

-- ----------------------------------------------------------------------------
-- RULE 8: STATUTORY GST OUTWARD SUPPLIES REGISTER (GSTR-1 / GSTR-3B)
-- ----------------------------------------------------------------------------
SELECT 
    financial_year,
    tax_period,
    place_of_supply_state_code,
    is_interstate,
    gst_rate_pct,
    invoice_count,
    total_taxable_value,
    total_cgst,
    total_sgst,
    total_igst,
    total_gross_value
FROM v_gst_outward_summary;

-- ----------------------------------------------------------------------------
-- RULE 9: IMMUTABLE AUDIT LOGS RECORDED
-- ----------------------------------------------------------------------------
SELECT 
    id,
    action,
    entity_name,
    entity_id,
    created_at
FROM audit_logs
ORDER BY id DESC
LIMIT 10;
