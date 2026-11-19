-- ============================================================================
-- ORDER-TO-AUDIT SYSTEM: BENCHMARK VERIFICATION SCRIPT
-- Queries checking every expected result from Section 5 of problem statement
-- ============================================================================

-- Check 1: Inventory Balances (Flour = 120 kg, Oil = 19.5 L, Pouches = 306, Cartons = 21, FG = 88 pkts)
SELECT 
    sku,
    item_name,
    closing_stock_base_qty,
    base_uom_id,
    equivalent_cartons,
    current_moving_wac AS unit_valuation_rate,
    total_stock_valuation
FROM v_current_stock
ORDER BY item_type, sku;

-- Check 2: Production Run Yield & Variance (-6% yield variance flagged)
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

-- Check 3: Raw Material Consumption Variance (+5% oil consumption flagged, 6 pouches damaged scrap)
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
    total_material_cost
FROM v_production_variance
WHERE run_number = 'PR-2026-11-001'
ORDER BY material_name;

-- Check 4: Cost Per Packet & Margin
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

-- Check 5: Retailer A Invoice & Derived Outstanding (Total = ₹7,875, Paid = ₹4,000, Due = ₹3,875)
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
    outstanding_balance,
    derived_payment_status
FROM v_invoice_balances
WHERE customer_name = 'Retailer A';

-- Check 6: Distributor B Order Shortage Flag
SELECT 
    so.order_number,
    p.trade_name AS customer_name,
    so.order_date,
    soi.item_name_snapshot,
    soi.ordered_qty,
    (SELECT closing_stock_base_qty FROM v_current_stock WHERE sku = 'FG-MRK-200G') AS available_stock,
    (soi.ordered_qty - (SELECT closing_stock_base_qty FROM v_current_stock WHERE sku = 'FG-MRK-200G')) AS shortage_qty,
    so.status,
    so.notes AS system_alert
FROM sales_orders so
JOIN parties p ON so.customer_id = p.id
JOIN sales_order_items soi ON so.id = soi.sales_order_id
WHERE p.trade_name = 'Distributor B';

-- Check 7: Statutory GST Summary (Outward supplies)
SELECT * FROM v_gst_outward_summary;
