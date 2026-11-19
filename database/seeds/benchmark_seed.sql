-- ============================================================================
-- ORDER-TO-AUDIT SYSTEM: BENCHMARK SEED DATA SCRIPT
-- NIT Tiruchirappalli Internship Problem Statement - Mandatory Benchmark Scenario
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. USERS & ROLES
-- ----------------------------------------------------------------------------
INSERT INTO users (id, username, password_hash, full_name, phone, role) VALUES
('11111111-1111-1111-1111-111111111111', 'salesman_a', '$argon2id$v=19$m=65536,t=3,p=4$dummyhash', 'Salesman A (Tamil Nadu)', '9876543210', 'salesman'),
('22222222-2222-2222-2222-222222222222', 'salesman_b', '$argon2id$v=19$m=65536,t=3,p=4$dummyhash', 'Salesman B (Karnataka)', '9876543211', 'salesman'),
('33333333-3333-3333-3333-333333333333', 'admin_factory', '$argon2id$v=19$m=65536,t=3,p=4$dummyhash', 'Factory Admin Desk', '9876543212', 'factory_admin'),
('44444444-4444-4444-4444-444444444444', 'supervisor_floor', '$argon2id$v=19$m=65536,t=3,p=4$dummyhash', 'Floor Supervisor', '9876543213', 'production_supervisor'),
('55555555-5555-5555-5555-555555555555', 'auditor_ext', '$argon2id$v=19$m=65536,t=3,p=4$dummyhash', 'Statutory Auditor', '9876543214', 'auditor'),
('66666666-6666-6666-6666-666666666666', 'owner_main', '$argon2id$v=19$m=65536,t=3,p=4$dummyhash', 'Managing Director', '9876543215', 'owner');

-- ----------------------------------------------------------------------------
-- 2. UNITS OF MEASURE
-- ----------------------------------------------------------------------------
INSERT INTO units_of_measure (id, name, dimension, base_unit_id, conversion_factor_to_base) VALUES
('KG', 'Kilogram', 'weight', NULL, 1.000000),
('G', 'Gram', 'weight', 'KG', 0.001000),
('L', 'Litre', 'volume', NULL, 1.000000),
('ML', 'Millilitre', 'volume', 'L', 0.001000),
('PCS', 'Piece', 'count', NULL, 1.000000),
('PKT', 'Packet', 'count', NULL, 1.000000),
('CTN', 'Carton', 'packaging', NULL, 1.000000);

-- ----------------------------------------------------------------------------
-- 3. ITEMS (Master Catalog)
-- ----------------------------------------------------------------------------
INSERT INTO items (id, sku, name, item_type, base_uom_id, hsn_code, gst_rate_pct, standard_selling_price, standard_purchase_rate, min_reorder_level, packets_per_carton) VALUES
('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'RM-FLOUR', 'Raw Flour (Besan/Rice mix)', 'raw_material', 'KG', '1101', 5.00, 0.00, 42.00, 20.0000, 1.00),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'RM-OIL', 'Cooking Oil', 'raw_material', 'L', '1507', 5.00, 0.00, 140.00, 10.0000, 1.00),
('cccccccc-cccc-cccc-cccc-cccccccccccc', 'RM-SPICE', 'Salt and Spice Mix', 'raw_material', 'KG', '0910', 5.00, 0.00, 200.00, 2.0000, 1.00),
('dddddddd-dddd-dddd-dddd-dddddddddddd', 'PK-POUCH-200G', 'Printed Pouch 200g', 'packaging', 'PCS', '3923', 5.00, 0.00, 2.50, 100.0000, 1.00),
('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'PK-CARTON-20', 'Shipping Carton (Holds 20 Packets)', 'packaging', 'PCS', '4819', 5.00, 0.00, 15.00, 10.0000, 1.00),
('ffffffff-ffff-ffff-ffff-ffffffffffff', 'FG-MRK-200G', 'Murukku 200g Packet', 'finished_good', 'PKT', '1905', 5.00, 50.00, 30.00, 50.0000, 20.00);

-- ----------------------------------------------------------------------------
-- 4. PARTIES (Customers & Suppliers)
-- Factory is in Tamil Nadu (State Code 33)
-- ----------------------------------------------------------------------------
INSERT INTO parties (id, party_type, trade_name, contact_person, phone, email, gstin, state_code, state_name, billing_address, credit_limit) VALUES
('77777777-7777-7777-7777-777777777777', 'customer', 'Retailer A', 'Senthil Nathan', '9840112233', 'retailer_a@madurai.com', '33AAAAA1111A1Z1', '33', 'Tamil Nadu', '12 Bazaar St, Madurai, Tamil Nadu', 15000.00),
('88888888-8888-8888-8888-888888888888', 'customer', 'Distributor B', 'Ramesh Rao', '9880223344', 'distributor_b@bengaluru.com', '29BBBBB2222B1Z2', '29', 'Karnataka', '45 Ring Road, Bengaluru, Karnataka', 50000.00),
('99999999-9999-9999-9999-999999999999', 'supplier', 'Trichy Agro Supplies', 'M. Ramanathan', '9443112233', 'orders@trichyagro.com', '33CCCCC3333C1Z3', '33', 'Tamil Nadu', '88 Goods Shed Road, Tiruchirappalli, Tamil Nadu', 0.00);

-- ----------------------------------------------------------------------------
-- 5. BILL OF MATERIALS (BOM) FOR MURUKKU 200G
-- Standard Batch Size = 200 Packets
-- ----------------------------------------------------------------------------
INSERT INTO boms (id, finished_good_item_id, bom_code, version_number, standard_batch_size, batch_uom_id, tolerance_variance_pct, is_active, effective_from, created_by) VALUES
('b0000001-0000-0000-0000-000000000001', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'BOM-MRK-200G', 1, 200.0000, 'PKT', 3.00, true, '2026-04-01', '33333333-3333-3333-3333-333333333333');

INSERT INTO bom_items (bom_id, item_id, standard_qty, uom_id) VALUES
('b0000001-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 40.0000, 'KG'),  -- 40 kg Flour
('b0000001-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 10.0000, 'L'),   -- 10 L Cooking Oil
('b0000001-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 1.2000, 'KG'),  -- 1.2 kg Salt & Spice
('b0000001-0000-0000-0000-000000000001', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 200.0000, 'PCS'), -- 200 Pouches
('b0000001-0000-0000-0000-000000000001', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 10.0000, 'PCS'); -- 10 Cartons (holds 20 pkts each)

-- ----------------------------------------------------------------------------
-- 6. OPENING STOCK SETUP
-- Opening Balances posted to inventory_ledger
-- ----------------------------------------------------------------------------
INSERT INTO inventory_ledger (
    transaction_timestamp, item_id, batch_number, movement_type, 
    transaction_qty, transaction_uom_id, base_quantity_delta, unit_cost, total_cost,
    source_reference_label, created_by
) VALUES
('2026-11-01 08:00:00+05:30', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'OB-20261101', 'OPENING_BALANCE', 100.0000, 'KG', 100.0000, 42.0000, 4200.00, 'OPENING-STOCK-SETUP', '33333333-3333-3333-3333-333333333333'),
('2026-11-01 08:00:00+05:30', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'OB-20261101', 'OPENING_BALANCE', 30.0000, 'L', 30.0000, 140.0000, 4200.00, 'OPENING-STOCK-SETUP', '33333333-3333-3333-3333-333333333333'),
('2026-11-01 08:00:00+05:30', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'OB-20261101', 'OPENING_BALANCE', 5.0000, 'KG', 5.0000, 200.0000, 1000.00, 'OPENING-STOCK-SETUP', '33333333-3333-3333-3333-333333333333'),
('2026-11-01 08:00:00+05:30', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'OB-20261101', 'OPENING_BALANCE', 500.0000, 'PCS', 500.0000, 2.5000, 1250.00, 'OPENING-STOCK-SETUP', '33333333-3333-3333-3333-333333333333'),
('2026-11-01 08:00:00+05:30', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'OB-20261101', 'OPENING_BALANCE', 30.0000, 'PCS', 30.0000, 15.0000, 450.00, 'OPENING-STOCK-SETUP', '33333333-3333-3333-3333-333333333333'),
('2026-11-01 08:00:00+05:30', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'OB-MRK-01', 'OPENING_BALANCE', 50.0000, 'PKT', 50.0000, 30.0000, 1500.00, 'OPENING-STOCK-SETUP', '33333333-3333-3333-3333-333333333333');

-- ============================================================================
-- BENCHMARK STEP 1: PURCHASE 60 KG FLOUR @ ₹45/KG
-- ============================================================================
INSERT INTO purchase_bills (
    id, supplier_id, bill_number, bill_date, subtotal_amount, cgst_amount, sgst_amount, total_amount, status, received_by
) VALUES (
    'pb000001-0000-0000-0000-000000000001',
    '99999999-9999-9999-9999-999999999999',
    'INV-TRICHY-842',
    '2026-11-10',
    2700.00, 67.50, 67.50, 2835.00,
    'received',
    '33333333-3333-3333-3333-333333333333'
);

INSERT INTO purchase_bill_items (
    id, purchase_bill_id, item_id, supplier_batch_no, quantity, uom_id, base_quantity, unit_rate, taxable_amount, gst_rate_pct, tax_amount, total_amount
) VALUES (
    'pbi00001-0000-0000-0000-000000000001',
    'pb000001-0000-0000-0000-000000000001',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'FLOUR-LOT-902',
    60.0000, 'KG', 60.0000, 45.00, 2700.00, 5.00, 135.00, 2835.00
);

-- Post to inventory ledger (Referential Integrity: purchase_bill_item_id linked!)
-- Moving WAC: (100 kg * ₹42 + 60 kg * ₹45) / 160 kg = ₹6900 / 160 = ₹43.1250/kg
INSERT INTO inventory_ledger (
    transaction_timestamp, item_id, batch_number, movement_type, 
    transaction_qty, transaction_uom_id, base_quantity_delta, unit_cost, total_cost,
    purchase_bill_item_id, source_reference_label, created_by
) VALUES (
    '2026-11-10 11:30:00+05:30',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'FLOUR-LOT-902',
    'PURCHASE_RECEIPT',
    60.0000, 'KG', 60.0000, 45.0000, 2700.00,
    'pbi00001-0000-0000-0000-000000000001',
    'INV-TRICHY-842',
    '33333333-3333-3333-3333-333333333333'
);

-- ============================================================================
-- BENCHMARK STEP 2 & 3: PRODUCTION RUN OF MURUKKU 200G
-- Planned: 1 batch = 200 pkts. Actual output: 188 good pkts (-6% yield variance).
-- Actual issues: 40 kg flour, 10.5 L oil (+5% variance), 1.2 kg spices,
-- 194 pouches (188 good + 6 damaged), 9 cartons.
-- ============================================================================
INSERT INTO production_runs (
    id, run_number, bom_id, finished_good_item_id, output_batch_number, run_date,
    planned_batch_count, standard_batch_size, planned_yield_qty, actual_good_output_qty, actual_scrap_output_qty,
    yield_variance_pct, is_yield_flagged, status, supervisor_id
) VALUES (
    'pr000001-0000-0000-0000-000000000001',
    'PR-2026-11-001',
    'b0000001-0000-0000-0000-000000000001',
    'ffffffff-ffff-ffff-ffff-ffffffffffff',
    'BAT-MRK-20261119-01',
    '2026-11-19',
    1.00, 200.0000, 200.0000, 188.0000, 0.0000,
    -6.00, true, 'completed', '44444444-4444-4444-4444-444444444444'
);

-- Detailed Input Tracking with Mass Balance Integrity:
-- Flour: 40 kg issued, 40 kg good, 0 scrap, 0 returned
INSERT INTO production_run_inputs (
    id, production_run_id, item_id, planned_qty, actual_issued_qty, good_production_qty, damaged_or_scrap_qty, returned_to_store_qty,
    uom_id, base_net_consumed_qty, unit_cost_applied, total_material_cost, consumption_variance_qty, consumption_variance_pct, is_consumption_flagged
) VALUES (
    'pri00001-0000-0000-0000-000000000001',
    'pr000001-0000-0000-0000-000000000001',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    40.0000, 40.0000, 40.0000, 0.0000, 0.0000,
    'KG', 40.0000, 43.1250, 1725.00, 0.0000, 0.00, false
);

-- Oil: planned 10.0 L, actual issued 10.5 L (+5% variance, FLAGGED)
INSERT INTO production_run_inputs (
    id, production_run_id, item_id, planned_qty, actual_issued_qty, good_production_qty, damaged_or_scrap_qty, returned_to_store_qty,
    uom_id, base_net_consumed_qty, unit_cost_applied, total_material_cost, consumption_variance_qty, consumption_variance_pct, is_consumption_flagged
) VALUES (
    'pri00002-0000-0000-0000-000000000002',
    'pr000001-0000-0000-0000-000000000001',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    10.0000, 10.5000, 10.5000, 0.0000, 0.0000,
    'L', 10.5000, 140.0000, 1470.00, 0.5000, 5.00, true
);

-- Spice Mix: planned 1.2 kg, actual issued 1.2 kg
INSERT INTO production_run_inputs (
    id, production_run_id, item_id, planned_qty, actual_issued_qty, good_production_qty, damaged_or_scrap_qty, returned_to_store_qty,
    uom_id, base_net_consumed_qty, unit_cost_applied, total_material_cost, consumption_variance_qty, consumption_variance_pct, is_consumption_flagged
) VALUES (
    'pri00003-0000-0000-0000-000000000003',
    'pr000001-0000-0000-0000-000000000001',
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    1.2000, 1.2000, 1.2000, 0.0000, 0.0000,
    'KG', 1.2000, 200.0000, 240.00, 0.0000, 0.00, false
);

-- 200g Pouches: planned 200 pcs, actual issued 194 pcs (188 good + 6 damaged scrap + 0 returned)
INSERT INTO production_run_inputs (
    id, production_run_id, item_id, planned_qty, actual_issued_qty, good_production_qty, damaged_or_scrap_qty, returned_to_store_qty,
    uom_id, base_net_consumed_qty, unit_cost_applied, total_material_cost, consumption_variance_qty, consumption_variance_pct, is_consumption_flagged
) VALUES (
    'pri00004-0000-0000-0000-000000000004',
    'pr000001-0000-0000-0000-000000000001',
    'dddddddd-dddd-dddd-dddd-dddddddddddd',
    200.0000, 194.0000, 188.0000, 6.0000, 0.0000,
    'PCS', 194.0000, 2.5000, 485.00, -6.0000, -3.00, false
);

-- Cartons: planned 10 pcs, actual issued 9 pcs
INSERT INTO production_run_inputs (
    id, production_run_id, item_id, planned_qty, actual_issued_qty, good_production_qty, damaged_or_scrap_qty, returned_to_store_qty,
    uom_id, base_net_consumed_qty, unit_cost_applied, total_material_cost, consumption_variance_qty, consumption_variance_pct, is_consumption_flagged
) VALUES (
    'pri00005-0000-0000-0000-000000000005',
    'pr000001-0000-0000-0000-000000000001',
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    10.0000, 9.0000, 9.0000, 0.0000, 0.0000,
    'PCS', 9.0000, 15.0000, 135.00, -1.0000, -10.00, true
);

-- Stock Ledger Entries for Materials Consumed (Linked to production_run_input_id)
INSERT INTO inventory_ledger (
    transaction_timestamp, item_id, movement_type, transaction_qty, transaction_uom_id,
    base_quantity_delta, unit_cost, total_cost, production_run_input_id, source_reference_label, created_by
) VALUES
('2026-11-19 09:30:00+05:30', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'PRODUCTION_ISSUE', 40.0000, 'KG', -40.0000, 43.1250, -1725.00, 'pri00001-0000-0000-0000-000000000001', 'PR-2026-11-001', '44444444-4444-4444-4444-444444444444'),
('2026-11-19 09:30:00+05:30', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'PRODUCTION_ISSUE', 10.5000, 'L', -10.5000, 140.0000, -1470.00, 'pri00002-0000-0000-0000-000000000002', 'PR-2026-11-001', '44444444-4444-4444-4444-444444444444'),
('2026-11-19 09:30:00+05:30', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'PRODUCTION_ISSUE', 1.2000, 'KG', -1.2000, 200.0000, -240.00, 'pri00003-0000-0000-0000-000000000003', 'PR-2026-11-001', '44444444-4444-4444-4444-444444444444'),
('2026-11-19 09:30:00+05:30', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'PRODUCTION_ISSUE', 194.0000, 'PCS', -194.0000, 2.5000, -485.00, 'pri00004-0000-0000-0000-000000000004', 'PR-2026-11-001', '44444444-4444-4444-4444-444444444444'),
('2026-11-19 09:30:00+05:30', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'PRODUCTION_ISSUE', 9.0000, 'PCS', -9.0000, 15.0000, -135.00, 'pri00005-0000-0000-0000-000000000005', 'PR-2026-11-001', '44444444-4444-4444-4444-444444444444');

-- Finished Goods Yield in Stock Ledger (Linked to production_run_yield_id)
-- 188 good packets Murukku 200g
INSERT INTO inventory_ledger (
    transaction_timestamp, item_id, batch_number, movement_type, 
    transaction_qty, transaction_uom_id, base_quantity_delta, unit_cost, total_cost,
    production_run_yield_id, source_reference_label, created_by
) VALUES (
    '2026-11-19 14:00:00+05:30',
    'ffffffff-ffff-ffff-ffff-ffffffffffff',
    'BAT-MRK-20261119-01',
    'PRODUCTION_YIELD',
    188.0000, 'PKT', 188.0000, 31.1436, 5855.00,
    'pr000001-0000-0000-0000-000000000001',
    'PR-2026-11-001',
    '44444444-4444-4444-4444-444444444444'
);

-- ============================================================================
-- BENCHMARK STEP 8: OVERHEADS & COSTING FOR THE RUN
-- Labour: ₹1,200. Gas & Power: ₹600.
-- ============================================================================
INSERT INTO production_run_overheads (production_run_id, overhead_type, description, amount) VALUES
('pr000001-0000-0000-0000-000000000001', 'labour', 'Floor 4-operator batch frying & packing', 1200.00),
('pr000001-0000-0000-0000-000000000001', 'power_gas', 'LPG cylinder consumption & fryer motor power', 600.00);

-- Batch Costing Summary:
-- Material Cost: Flour 1725 + Oil 1470 + Spice 240 + Pouches 485 + Cartons 135 = ₹4,055.00
-- Direct Overheads: Labour 1200 + Power/Gas 600 = ₹1,800.00
-- Total Batch Cost: ₹4,055.00 + ₹1,800.00 = ₹5,855.00
-- Good output: 188 pkts
-- Cost per packet: ₹5,855.00 / 188 = ₹31.1436 (~ ₹31.14 per packet)
-- Selling Price: ₹50.00. Gross Margin: ₹18.86 per packet (37.71%)
INSERT INTO production_run_costing (
    production_run_id, total_raw_material_cost, total_packaging_cost, total_direct_overhead_cost,
    gross_total_batch_cost, good_output_units, cost_per_packet, selling_price_per_packet,
    unit_gross_margin, gross_margin_pct, valuation_method_used
) VALUES (
    'pr000001-0000-0000-0000-000000000001',
    3435.00, 620.00, 1800.00,
    5855.00, 188.0000, 31.1436, 50.00,
    18.8564, 37.71, 'WEIGHTED_AVERAGE'
);

-- ============================================================================
-- BENCHMARK STEP 4 & 5: SALESMAN A ORDERS 150 PKTS FOR RETAILER A (TAMIL NADU)
-- Admin verifies stock (238 >= 150), approves, generates GST invoice, dispatches
-- ============================================================================
INSERT INTO sales_orders (
    id, order_number, customer_id, salesman_id, order_date, offline_client_uuid, status,
    subtotal_amount, estimated_tax_amount, total_order_value
) VALUES (
    'so000001-0000-0000-0000-000000000001',
    'SO-2026-0001',
    '77777777-7777-7777-7777-777777777777',
    '11111111-1111-1111-1111-111111111111',
    '2026-11-19',
    'a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d',
    'dispatched',
    7500.00, 375.00, 7875.00
);

INSERT INTO sales_order_items (
    sales_order_id, item_id, item_name_snapshot, hsn_code_snapshot,
    ordered_qty, approved_qty, uom_id, unit_price, gst_rate_pct, taxable_value, total_item_value
) VALUES (
    'so000001-0000-0000-0000-000000000001',
    'ffffffff-ffff-ffff-ffff-ffffffffffff',
    'Murukku 200g Packet',
    '1905',
    150.0000, 150.0000, 'PKT', 50.00, 5.00, 7500.00, 7875.00
);

-- GST Tax Invoice (Intra-state: CGST 2.5% + SGST 2.5%)
INSERT INTO invoices (
    id, invoice_number, financial_year, sales_order_id, customer_id, invoice_date,
    place_of_supply_state_code, is_interstate, taxable_value, cgst_amount, sgst_amount, igst_amount,
    total_invoice_value, status, approved_by
) VALUES (
    'inv00001-0000-0000-0000-000000000001',
    'INV/2026-27/0001',
    '2026-2027',
    'so000001-0000-0000-0000-000000000001',
    '77777777-7777-7777-7777-777777777777',
    '2026-11-19',
    '33', false, 7500.00, 187.50, 187.50, 0.00,
    7875.00, 'dispatched', '33333333-3333-3333-3333-333333333333'
);

INSERT INTO invoice_items (
    invoice_id, item_id, item_name_snapshot, hsn_code_snapshot, quantity, uom_id, base_quantity,
    unit_price, taxable_value, gst_rate_pct, cgst_rate_pct, cgst_amount, sgst_rate_pct, sgst_amount,
    igst_rate_pct, igst_amount, total_item_value
) VALUES (
    'inv00001-0000-0000-0000-000000000001',
    'ffffffff-ffff-ffff-ffff-ffffffffffff',
    'Murukku 200g Packet',
    '1905',
    150.0000, 'PKT', 150.0000,
    50.00, 7500.00, 5.00, 2.50, 187.50, 2.50, 187.50,
    0.00, 0.00, 7875.00
);

-- Dispatch Documentation (Triggers Stock Reduction)
INSERT INTO dispatches (
    id, dispatch_number, invoice_id, dispatch_date, carrier_or_vehicle_no, driver_name, status, dispatched_by
) VALUES (
    'dsp00001-0000-0000-0000-000000000001',
    'DSP-2026-0001',
    'inv00001-0000-0000-0000-000000000001',
    '2026-11-19',
    'TN-59-AX-4412',
    'K. Velu',
    'delivered',
    '33333333-3333-3333-3333-333333333333'
);

INSERT INTO dispatch_items (
    id, dispatch_id, item_id, batch_number, dispatched_qty, uom_id, base_quantity
) VALUES (
    'dspi0001-0000-0000-0000-000000000001',
    'dsp00001-0000-0000-0000-000000000001',
    'ffffffff-ffff-ffff-ffff-ffffffffffff',
    'BAT-MRK-20261119-01',
    150.0000, 'PKT', 150.0000
);

-- Ledger Entry for Dispatch: -150 packets (Finished goods stock drops from 238 to 88)
INSERT INTO inventory_ledger (
    transaction_timestamp, item_id, batch_number, movement_type, 
    transaction_qty, transaction_uom_id, base_quantity_delta, unit_cost, total_cost,
    dispatch_item_id, source_reference_label, created_by
) VALUES (
    '2026-11-19 16:00:00+05:30',
    'ffffffff-ffff-ffff-ffff-ffffffffffff',
    'BAT-MRK-20261119-01',
    'SALES_DISPATCH',
    150.0000, 'PKT', -150.0000, 31.1436, -4671.54,
    'dspi0001-0000-0000-0000-000000000001',
    'DSP-2026-0001',
    '33333333-3333-3333-3333-333333333333'
);

-- ============================================================================
-- BENCHMARK STEP 6: SALESMAN B ORDERS 120 PKTS FOR DISTRIBUTOR B (KARNATAKA)
-- Available stock = 88 pkts. Order flagged for 32 pkts shortage!
-- ============================================================================
INSERT INTO sales_orders (
    id, order_number, customer_id, salesman_id, order_date, offline_client_uuid, status,
    subtotal_amount, estimated_tax_amount, total_order_value, notes
) VALUES (
    'so000002-0000-0000-0000-000000000002',
    'SO-2026-0002',
    '88888888-8888-8888-8888-888888888888',
    '22222222-2222-2222-2222-222222222222',
    '2026-11-19',
    'b2c3d4e5-f6a1-4b2c-9d3e-4f5a6b7c8d9e',
    'submitted', -- PENDING PRODUCTION DUE TO INSUFFICIENT STOCK
    6000.00, 300.00, 6300.00,
    'SYSTEM ALERT: Shortage of 32 packets flagged. Current available finished stock is 88 packets.'
);

INSERT INTO sales_order_items (
    sales_order_id, item_id, item_name_snapshot, hsn_code_snapshot,
    ordered_qty, approved_qty, uom_id, unit_price, gst_rate_pct, taxable_value, total_item_value
) VALUES (
    'so000002-0000-0000-0000-000000000002',
    'ffffffff-ffff-ffff-ffff-ffffffffffff',
    'Murukku 200g Packet',
    '1905',
    120.0000, NULL, 'PKT', 50.00, 5.00, 6000.00, 6300.00
);

-- ============================================================================
-- BENCHMARK STEP 7: PAYMENT OF ₹4,000 FROM RETAILER A
-- Invoice was ₹7,875. Payment is ₹4,000. Derived outstanding = ₹3,875.00.
-- ============================================================================
INSERT INTO payments (
    id, receipt_number, customer_id, invoice_id, payment_date, amount, payment_mode, reference_txn_id, recorded_by
) VALUES (
    'pay00001-0000-0000-0000-000000000001',
    'REC-2026-0001',
    '77777777-7777-7777-7777-777777777777',
    'inv00001-0000-0000-0000-000000000001',
    '2026-11-19',
    4000.00,
    'upi',
    'UPI/20261119/992837461',
    '33333333-3333-3333-3333-333333333333'
);

COMMIT;
