\set ON_ERROR_STOP on
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
-- RULE 9: IMMUTABLE AUDIT LOGS RECORDED (INCLUDING INSERT EVENTS)
-- ----------------------------------------------------------------------------
SELECT 
    id,
    action,
    entity_name,
    entity_id,
    user_id,
    created_at
FROM audit_logs
ORDER BY id DESC
LIMIT 15;

-- ----------------------------------------------------------------------------
-- RULE 10: TEST CASE - PURCHASE IN NON-BASE UOM (1 BAG OF 50 KG @ ₹2,250/BAG)
-- ISOLATED TRANSACTION WITH ROLLBACK:
-- Runs in a dedicated transaction that tests the math and verifies the output,
-- then ROLLS BACK completely so that benchmark closing stock (120 kg) and
-- Moving WAC (₹43.1250) remain strictly unchanged!
-- ----------------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
    v_test_bill_id UUID := 'ba000002-0000-0000-0000-000000000002';
    v_test_item_id UUID := 'ba000011-0000-0000-0000-000000000002';
    v_flour_id UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    v_admin_id UUID := '33333333-3333-3333-3333-333333333333';
    v_supplier_id UUID := '99999999-9999-9999-9999-999999999999';
    v_check_rate NUMERIC;
    v_check_qty NUMERIC;
    v_check_wac NUMERIC;
BEGIN
    INSERT INTO purchase_bills (
        id, supplier_id, bill_number, bill_date, subtotal_amount, cgst_amount, sgst_amount, total_amount, status, received_by
    ) VALUES (
        v_test_bill_id, v_supplier_id, 'TEST-BAG-50KG-001', CURRENT_DATE, 2250.00, 56.25, 56.25, 2362.50, 'draft', v_admin_id
    );

    INSERT INTO purchase_bill_items (
        id, purchase_bill_id, item_id, supplier_batch_no, quantity, uom_id, base_quantity, unit_rate, taxable_amount, gst_rate_pct, tax_amount, total_amount
    ) VALUES (
        v_test_item_id, v_test_bill_id, v_flour_id, 'BAG-LOT-01', 1.0000, 'BAG', 50.0000, 2250.00, 2250.00, 5.00, 112.50, 2362.50
    );

    PERFORM fn_post_purchase_receipt(v_test_bill_id, v_admin_id);

    -- Strict assertions inside test transaction
    SELECT base_unit_rate INTO v_check_rate FROM purchase_bill_items WHERE id = v_test_item_id;
    IF v_check_rate <> 45.0000 THEN
        RAISE EXCEPTION 'Rule 10 Assertion Failure: Expected effective base unit rate 45.0000, got %', v_check_rate;
    END IF;

    SELECT current_base_qty, ROUND(current_moving_wac, 4) INTO v_check_qty, v_check_wac FROM item_stock_balances WHERE item_id = v_flour_id;
    IF v_check_qty <> 170.0000 OR v_check_wac <> 43.6765 THEN
        RAISE EXCEPTION 'Rule 10 Assertion Failure: Expected Flour stock 170.0000 and WAC 43.6765, got qty % and WAC %', v_check_qty, v_check_wac;
    END IF;
END $$;

SELECT 
    pb.bill_number,
    pbi.quantity || ' ' || pbi.uom_id AS entered_quantity,
    pbi.unit_rate AS rate_per_bag,
    pbi.taxable_amount,
    pbi.base_quantity || ' ' || i.base_uom_id AS normalized_base_quantity,
    pbi.base_unit_rate AS effective_cost_per_kg,
    pbi.total_amount AS invoice_total_with_gst,
    sb.current_base_qty AS flour_stock_in_test_transaction,
    sb.current_moving_wac AS flour_moving_wac_in_test_transaction
FROM purchase_bills pb
JOIN purchase_bill_items pbi ON pb.id = pbi.purchase_bill_id
JOIN items i ON pbi.item_id = i.id
JOIN item_stock_balances sb ON i.id = sb.item_id
WHERE pb.bill_number = 'TEST-BAG-50KG-001';

-- Strict rollback: completely reverts the test purchase, restoring benchmark Flour stock to 120 kg!
ROLLBACK;

-- ----------------------------------------------------------------------------
-- RULE 11: COMPREHENSIVE ASSERTION-BASED BENCHMARK VERIFICATION
-- Programmatically validates all business benchmark results from Section 5.
-- Immediately raises an exception and aborts execution if ANY invariant fails!
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_flour_qty NUMERIC;
    v_flour_wac NUMERIC;
    v_flour_val NUMERIC;
    v_oil_qty NUMERIC;
    v_oil_wac NUMERIC;
    v_oil_val NUMERIC;
    v_pouch_qty NUMERIC;
    v_pouch_wac NUMERIC;
    v_carton_qty NUMERIC;
    v_carton_wac NUMERIC;
    v_mrk_qty NUMERIC;
    v_mrk_ctn NUMERIC;
    v_mrk_wac NUMERIC;
    v_mrk_val NUMERIC;
    v_run_rec RECORD;
    v_cost_rec RECORD;
    v_inv_rec RECORD;
    v_cust_rec RECORD;
    v_so_rec RECORD;
    v_oil_var NUMERIC;
    v_pouch_consumed NUMERIC;
    v_insert_audit_count INT;
BEGIN
    -- 1. Flour stock & WAC (Must remain 120.0000 kg @ ₹43.1250 after rollback)
    SELECT closing_stock_base_qty, current_moving_wac, total_stock_valuation
    INTO v_flour_qty, v_flour_wac, v_flour_val
    FROM v_current_stock WHERE sku = 'RM-FLOUR';

    IF v_flour_qty <> 120.0000 OR v_flour_wac <> 43.1250 OR v_flour_val <> 5175.00 THEN
        RAISE EXCEPTION 'Benchmark Assertion 1 Failed (Flour): Expected 120.0000 kg @ ₹43.1250 (Valuation ₹5175.00), got % kg @ ₹% (Valuation ₹%)',
            v_flour_qty, v_flour_wac, v_flour_val;
    END IF;

    -- 2. Oil stock & WAC
    SELECT closing_stock_base_qty, current_moving_wac, total_stock_valuation
    INTO v_oil_qty, v_oil_wac, v_oil_val
    FROM v_current_stock WHERE sku = 'RM-OIL';

    IF v_oil_qty <> 19.5000 OR v_oil_wac <> 140.0000 OR v_oil_val <> 2730.00 THEN
        RAISE EXCEPTION 'Benchmark Assertion 2 Failed (Oil): Expected 19.5000 L @ ₹140.0000 (Valuation ₹2730.00), got % L @ ₹% (Valuation ₹%)',
            v_oil_qty, v_oil_wac, v_oil_val;
    END IF;

    -- 3. Pouches stock & WAC
    SELECT closing_stock_base_qty, current_moving_wac
    INTO v_pouch_qty, v_pouch_wac
    FROM v_current_stock WHERE sku = 'PK-POUCH-200G';

    IF v_pouch_qty <> 306.0000 OR v_pouch_wac <> 2.5000 THEN
        RAISE EXCEPTION 'Benchmark Assertion 3 Failed (Pouches): Expected 306.0000 pcs @ ₹2.5000, got % pcs @ ₹%',
            v_pouch_qty, v_pouch_wac;
    END IF;

    -- 4. Cartons stock & WAC
    SELECT closing_stock_base_qty, current_moving_wac
    INTO v_carton_qty, v_carton_wac
    FROM v_current_stock WHERE sku = 'PK-CARTON-20';

    IF v_carton_qty <> 21.0000 OR v_carton_wac <> 15.0000 THEN
        RAISE EXCEPTION 'Benchmark Assertion 4 Failed (Cartons): Expected 21.0000 pcs @ ₹15.0000, got % pcs @ ₹%',
            v_carton_qty, v_carton_wac;
    END IF;

    -- 5. Finished Murukku 200g stock, equivalent cartons & WAC
    SELECT closing_stock_base_qty, equivalent_cartons, current_moving_wac, total_stock_valuation
    INTO v_mrk_qty, v_mrk_ctn, v_mrk_wac, v_mrk_val
    FROM v_current_stock WHERE sku = 'FG-MRK-200G';

    IF v_mrk_qty <> 88.0000 OR v_mrk_ctn <> 4.40 OR v_mrk_wac <> 30.9034 OR v_mrk_val <> 2719.50 THEN
        RAISE EXCEPTION 'Benchmark Assertion 5 Failed (Finished Murukku): Expected 88.0000 pkts (4.40 CTN) @ ₹30.9034 (Valuation ₹2719.50), got % pkts (% CTN) @ ₹% (Valuation ₹%)',
            v_mrk_qty, v_mrk_ctn, v_mrk_wac, v_mrk_val;
    END IF;

    -- 6. Production Run PR-2026-11-001 Yield & Variance
    SELECT planned_batch_count, planned_yield_qty, actual_good_output_qty, yield_variance_pct, is_yield_flagged, status
    INTO v_run_rec
    FROM production_runs WHERE run_number = 'PR-2026-11-001';

    IF v_run_rec.planned_batch_count <> 1.00 
       OR v_run_rec.planned_yield_qty <> 200.0000 
       OR v_run_rec.actual_good_output_qty <> 188.0000 
       OR v_run_rec.yield_variance_pct <> -6.00 
       OR v_run_rec.is_yield_flagged <> true
       OR v_run_rec.status <> 'completed' THEN
        RAISE EXCEPTION 'Benchmark Assertion 6 Failed (Production Run): Yield variance or status mismatch for PR-2026-11-001';
    END IF;

    -- 7. Material consumption & Mass Balance
    SELECT consumption_variance_pct INTO v_oil_var
    FROM production_run_inputs
    WHERE production_run_id = (SELECT id FROM production_runs WHERE run_number = 'PR-2026-11-001')
      AND item_id = (SELECT id FROM items WHERE sku = 'RM-OIL');

    IF v_oil_var <> 5.00 THEN
        RAISE EXCEPTION 'Benchmark Assertion 7 Failed (Oil Variance): Expected +5.00%% variance, got %', v_oil_var;
    END IF;

    SELECT base_net_consumed_qty INTO v_pouch_consumed
    FROM production_run_inputs
    WHERE production_run_id = (SELECT id FROM production_runs WHERE run_number = 'PR-2026-11-001')
      AND item_id = (SELECT id FROM items WHERE sku = 'PK-POUCH-200G');

    IF v_pouch_consumed <> 194.0000 THEN
        RAISE EXCEPTION 'Benchmark Assertion 7 Failed (Pouch Consumption): Expected net consumed 194.0000, got %', v_pouch_consumed;
    END IF;

    -- 8. Production Run Costing
    SELECT total_raw_material_cost, total_packaging_cost, total_direct_overhead_cost, gross_total_batch_cost, cost_per_packet, gross_margin_pct
    INTO v_cost_rec
    FROM production_run_costing
    WHERE production_run_id = (SELECT id FROM production_runs WHERE run_number = 'PR-2026-11-001');

    IF v_cost_rec.total_raw_material_cost <> 3435.00 
       OR v_cost_rec.total_packaging_cost <> 620.00 
       OR v_cost_rec.total_direct_overhead_cost <> 1800.00 
       OR v_cost_rec.gross_total_batch_cost <> 5855.00 
       OR v_cost_rec.cost_per_packet <> 31.1436 
       OR v_cost_rec.gross_margin_pct <> 37.71 THEN
        RAISE EXCEPTION 'Benchmark Assertion 8 Failed (Batch Costing): Cost or margin mismatch in PR-2026-11-001';
    END IF;

    -- 9. Retailer A Invoice Balances
    SELECT taxable_value, cgst_amount, sgst_amount, igst_amount, total_invoice_value, total_paid_amount, outstanding_balance, derived_payment_status
    INTO v_inv_rec
    FROM v_invoice_balances WHERE invoice_number = 'INV/2026-27/0001';

    IF v_inv_rec.taxable_value <> 7500.00 
       OR v_inv_rec.cgst_amount <> 187.50 
       OR v_inv_rec.sgst_amount <> 187.50 
       OR v_inv_rec.igst_amount <> 0.00 
       OR v_inv_rec.total_invoice_value <> 7875.00 
       OR v_inv_rec.total_paid_amount <> 4000.00 
       OR v_inv_rec.outstanding_balance <> 3875.00 
       OR v_inv_rec.derived_payment_status <> 'partially_paid' THEN
        RAISE EXCEPTION 'Benchmark Assertion 9 Failed (Invoice Balances): Outstanding mismatch for INV/2026-27/0001';
    END IF;

    -- 10. Customer Outstanding for Retailer A
    SELECT total_billed, total_allocated_to_invoices, total_payments_received, unallocated_advances, net_invoice_receivables
    INTO v_cust_rec
    FROM v_customer_outstanding WHERE customer_name = 'Retailer A';

    IF v_cust_rec.total_billed <> 7875.00 
       OR v_cust_rec.total_allocated_to_invoices <> 4000.00 
       OR v_cust_rec.total_payments_received <> 4000.00 
       OR v_cust_rec.unallocated_advances <> 0.00 
       OR v_cust_rec.net_invoice_receivables <> 3875.00 THEN
        RAISE EXCEPTION 'Benchmark Assertion 10 Failed (Customer Outstanding): Receivable mismatch for Retailer A';
    END IF;

    -- 11. Distributor B Order & Shortage
    SELECT soi.ordered_qty, (SELECT closing_stock_base_qty FROM v_current_stock WHERE sku = 'FG-MRK-200G') AS avail
    INTO v_so_rec
    FROM sales_orders so
    JOIN sales_order_items soi ON so.id = soi.sales_order_id
    WHERE so.order_number = 'SO-2026-0002';

    IF v_so_rec.ordered_qty <> 120.0000 OR v_so_rec.avail <> 88.0000 OR (v_so_rec.ordered_qty - v_so_rec.avail) <> 32.0000 THEN
        RAISE EXCEPTION 'Benchmark Assertion 11 Failed (Order Shortage): Expected shortage of 32 packets for SO-2026-0002';
    END IF;

    -- 12. INSERT Auditing Verification
    SELECT COUNT(DISTINCT entity_name) INTO v_insert_audit_count
    FROM audit_logs
    WHERE action LIKE 'INSERT%' AND entity_name IN ('purchase_bills', 'production_runs', 'invoices', 'payments');

    IF v_insert_audit_count < 4 THEN
        RAISE EXCEPTION 'Benchmark Assertion 12 Failed (Audit Coverage): Expected INSERT audit logs for all 4 transactional entities, found %', v_insert_audit_count;
    END IF;

    -- 13. Dev Reset / Rerun Protection Verification
    IF NOT EXISTS (SELECT 1 FROM purchase_bills WHERE id = 'ba000001-0000-0000-0000-000000000001') THEN
        RAISE EXCEPTION 'Benchmark Assertion 13 Failed (Rerun Protection): Benchmark purchase bill ba000001 not found';
    END IF;

    RAISE NOTICE '====================================================================';
    RAISE NOTICE 'ALL BENCHMARK INTEGRITY ASSERTIONS PASSED WITH ZERO DISCREPANCIES!';
    RAISE NOTICE '====================================================================';
END $$;

-- ----------------------------------------------------------------------------
-- RULE 12: VISUAL DISPLAY OF BENCHMARK INTEGRITY AND RERUN PROTECTION STATUS
-- ----------------------------------------------------------------------------
SELECT 
    sku,
    item_name,
    closing_stock_base_qty,
    base_uom_id,
    current_moving_wac,
    CASE 
        WHEN closing_stock_base_qty = 120.0000 AND current_moving_wac = 43.1250 
        THEN 'PASSED: Benchmark balances remain strictly unchanged after verification'
        ELSE 'FAILED: Benchmark data was mutated'
    END AS benchmark_integrity_check
FROM v_current_stock
WHERE sku = 'RM-FLOUR';

SELECT 
    CASE 
        WHEN EXISTS (SELECT 1 FROM purchase_bills WHERE id = 'ba000001-0000-0000-0000-000000000001') 
        THEN 'PROTECTED: Benchmark data detected. Guard will abort re-execution without dev reset.'
        ELSE 'UNSEEDED: Benchmark seed can be run.'
    END AS rerun_protection_status;
