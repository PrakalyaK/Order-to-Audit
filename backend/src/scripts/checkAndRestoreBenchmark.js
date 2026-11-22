import { pool } from '../config/db.js';

async function main() {
  const client = await pool.connect();
  try {
    await client.query('SET session_replication_role = replica');

    // Check inventory ledger
    const ledgerRes = await client.query(`SELECT id, movement_type, source_reference_label FROM inventory_ledger WHERE movement_type = 'SALES_DISPATCH'`);
    console.log('SALES_DISPATCH ledger entries:', ledgerRes.rows);

    // Re-insert benchmark sales orders if missing
    await client.query(`
      INSERT INTO sales_orders (
        id, order_number, customer_id, salesman_id, order_date, offline_client_uuid, status,
        subtotal_amount, estimated_tax_amount, total_order_value
      ) VALUES (
        'ea000001-0000-0000-0000-000000000001',
        'SO-2026-0001',
        '77777777-7777-7777-7777-777777777777',
        '11111111-1111-1111-1111-111111111111',
        '2026-11-19',
        'a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d',
        'dispatched',
        7500.00, 375.00, 7875.00
      ) ON CONFLICT (id) DO UPDATE SET status = 'dispatched';

      INSERT INTO sales_order_items (
        sales_order_id, item_id, item_name_snapshot, hsn_code_snapshot,
        ordered_qty, approved_qty, uom_id, unit_price, gst_rate_pct, taxable_value, total_item_value
      ) VALUES (
        'ea000001-0000-0000-0000-000000000001',
        'ffffffff-ffff-ffff-ffff-ffffffffffff',
        'Murukku 200g Packet',
        '1905',
        150.0000, 150.0000, 'PKT', 50.00, 5.00, 7500.00, 7875.00
      ) ON CONFLICT DO NOTHING;

      INSERT INTO invoices (
        id, invoice_number, financial_year, sales_order_id, customer_id, invoice_date,
        place_of_supply_state_code, is_interstate, taxable_value, cgst_amount, sgst_amount, igst_amount,
        total_invoice_value, status, approved_by
      ) VALUES (
        'fa000001-0000-0000-0000-000000000001',
        'INV/2026-27/0001',
        '2026-2027',
        'ea000001-0000-0000-0000-000000000001',
        '77777777-7777-7777-7777-777777777777',
        '2026-11-19',
        '33', false, 7500.00, 187.50, 187.50, 0.00,
        7875.00, 'dispatched', '33333333-3333-3333-3333-333333333333'
      ) ON CONFLICT (id) DO UPDATE SET status = 'dispatched';

      INSERT INTO invoice_items (
        invoice_id, item_id, item_name_snapshot, hsn_code_snapshot, quantity, uom_id, base_quantity,
        unit_price, taxable_value, gst_rate_pct, cgst_rate_pct, cgst_amount, sgst_rate_pct, sgst_amount,
        igst_rate_pct, igst_amount, total_item_value
      ) VALUES (
        'fa000001-0000-0000-0000-000000000001',
        'ffffffff-ffff-ffff-ffff-ffffffffffff',
        'Murukku 200g Packet',
        '1905',
        150.0000, 'PKT', 150.0000,
        50.00, 7500.00, 5.00, 2.50, 187.50, 2.50, 187.50,
        0.00, 0.00, 7875.00
      ) ON CONFLICT DO NOTHING;

      INSERT INTO dispatches (
        id, dispatch_number, invoice_id, dispatch_date, carrier_or_vehicle_no, driver_name, status, dispatched_by
      ) VALUES (
        'eb000001-0000-0000-0000-000000000001',
        'DSP-2026-0001',
        'fa000001-0000-0000-0000-000000000001',
        '2026-11-19',
        'TN-59-AX-4412',
        'K. Velu',
        'dispatched',
        '33333333-3333-3333-3333-333333333333'
      ) ON CONFLICT (id) DO UPDATE SET status = 'dispatched';

      INSERT INTO dispatch_items (
        id, dispatch_id, item_id, batch_number, dispatched_qty, uom_id, base_quantity
      ) VALUES (
        'ec000001-0000-0000-0000-000000000001',
        'eb000001-0000-0000-0000-000000000001',
        'ffffffff-ffff-ffff-ffff-ffffffffffff',
        'BAT-MRK-20261119-01',
        150.0000, 'PKT', 150.0000
      ) ON CONFLICT DO NOTHING;

      INSERT INTO sales_orders (
        id, order_number, customer_id, salesman_id, order_date, offline_client_uuid, status,
        subtotal_amount, estimated_tax_amount, total_order_value, notes
      ) VALUES (
        'ea000002-0000-0000-0000-000000000002',
        'SO-2026-0002',
        '88888888-8888-8888-8888-888888888888',
        '22222222-2222-2222-2222-222222222222',
        '2026-11-19',
        'b2c3d4e5-f6a1-4b2c-9d3e-4f5a6b7c8d9e',
        'submitted',
        6000.00, 300.00, 6300.00,
        'SYSTEM ALERT: Shortage of 32 packets flagged. Current available finished stock is 88 packets.'
      ) ON CONFLICT (id) DO NOTHING;

      INSERT INTO sales_order_items (
        sales_order_id, item_id, item_name_snapshot, hsn_code_snapshot,
        ordered_qty, approved_qty, uom_id, unit_price, gst_rate_pct, taxable_value, total_item_value
      ) VALUES (
        'ea000002-0000-0000-0000-000000000002',
        'ffffffff-ffff-ffff-ffff-ffffffffffff',
        'Murukku 200g Packet',
        '1905',
        120.0000, NULL, 'PKT', 50.00, 5.00, 6000.00, 6300.00
      ) ON CONFLICT DO NOTHING;
    `);

    // Verify benchmark counts
    const { rows } = await client.query(`
      SELECT 
        (SELECT COUNT(*)::int FROM users) AS users,
        (SELECT COUNT(*)::int FROM items) AS items,
        (SELECT COUNT(*)::int FROM boms) AS boms,
        (SELECT COUNT(*)::int FROM parties) AS parties,
        (SELECT COUNT(*)::int FROM purchase_bills) AS purchase_bills,
        (SELECT COUNT(*)::int FROM production_runs) AS production_runs,
        (SELECT COUNT(*)::int FROM sales_orders) AS sales_orders,
        (SELECT COUNT(*)::int FROM invoices) AS invoices,
        (SELECT COUNT(*)::int FROM dispatches) AS dispatches,
        (SELECT COUNT(*)::int FROM inventory_ledger) AS inventory_ledger
    `);
    console.log('Restored benchmark counts:', rows[0]);

    // Restore FG stock balance (88 pkts @ 30.9034 = 2719.50)
    await client.query(`
      UPDATE item_stock_balances 
      SET current_base_qty = 88.0000, current_moving_wac = 30.9034, current_total_value = 2719.50
      WHERE item_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
    `);

    const { rows: stock } = await client.query(`
      SELECT * FROM item_stock_balances WHERE item_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
    `);
    console.log('FG stock balance:', stock[0]);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
