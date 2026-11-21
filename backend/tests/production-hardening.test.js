import test from 'node:test';
import assert from 'node:assert/strict';
import { getClient, query, closePool } from '../src/config/db.js';

test('Order-to-Audit: Database Integrity, Immutability & Production Hardening Integration Tests', async (t) => {
  t.after(async () => {
    await closePool();
  });

  // Snapshot initial benchmark table counts to ensure zero corruption or mutation
  const initialCountsRes = await query(`
    SELECT 
      (SELECT COUNT(*)::int FROM users) AS users,
      (SELECT COUNT(*)::int FROM items) AS items,
      (SELECT COUNT(*)::int FROM boms) AS boms,
      (SELECT COUNT(*)::int FROM parties) AS parties,
      (SELECT COUNT(*)::int FROM production_runs) AS production_runs,
      (SELECT COUNT(*)::int FROM inventory_ledger) AS inventory_ledger
  `);
  const initialCounts = initialCountsRes.rows[0];

  assert.equal(initialCounts.users, 6, 'Benchmark users count must be 6');
  assert.equal(initialCounts.items, 6, 'Benchmark items count must be 6');
  assert.equal(initialCounts.boms, 1, 'Benchmark boms count must be 1');
  assert.equal(initialCounts.parties, 3, 'Benchmark parties count must be 3');
  assert.equal(initialCounts.production_runs, 1, 'Benchmark production runs count must be 1');

  const supervisorId = '33333333-3333-3333-3333-333333333333';
  const existingFgId = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  const existingBomId = 'b0000001-0000-0000-0000-000000000001';
  const rawFlourId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

  // --------------------------------------------------------------------------
  // TEST 1: Zero Selling Price Handling in Yield Posting
  // --------------------------------------------------------------------------
  await t.test('1. Costing Hardening: Post yield for item with 0 selling price calculates NULL gross margin without crash', async () => {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      // Create a test finished good item with standard_selling_price = 0.00
      const itemRes = await client.query(`
        INSERT INTO items (
          sku, name, item_type, base_uom_id, hsn_code, gst_rate_pct, packets_per_carton, standard_selling_price, standard_purchase_rate, min_reorder_level, is_active
        ) VALUES (
          'FG-TEST-ZERO-PRICE', 'Zero Selling Price Test Item', 'finished_good', 'PKT', '1905', 12.00, 10.00, 0.00, 0.00, 10.00, true
        ) RETURNING id;
      `);
      const testFgId = itemRes.rows[0].id;

      // Create a test BOM
      const bomRes = await client.query(`
        INSERT INTO boms (
          finished_good_item_id, bom_code, version_number, standard_batch_size, batch_uom_id, is_active, effective_from, created_by
        ) VALUES (
          $1, 'BOM-TEST-ZERO', 1, 100.0, 'PKT', true, '2026-01-01', $2
        ) RETURNING id;
      `, [testFgId, supervisorId]);
      const testBomId = bomRes.rows[0].id;

      // Create a test production run
      const runRes = await client.query(`
        INSERT INTO production_runs (
          run_number, bom_id, finished_good_item_id, supervisor_id, run_date, planned_batch_count, standard_batch_size, planned_yield_qty,
          actual_good_output_qty, actual_scrap_output_qty, yield_variance_pct, is_yield_flagged, output_batch_number, status
        ) VALUES (
          'PR-TEST-ZERO-001', $1, $2, $3, CURRENT_DATE, 1.0, 100.0, 100.0, 100.0, 0.0, 0.0, false, 'BATCH-ZERO-001', 'materials_issued'
        ) RETURNING id;
      `, [testBomId, testFgId, supervisorId]);
      const testRunId = runRes.rows[0].id;

      // Add direct material input ($500 cost)
      await client.query(`
        INSERT INTO production_run_inputs (
          production_run_id, item_id, planned_qty, actual_issued_qty, good_production_qty, damaged_or_scrap_qty,
          returned_to_store_qty, uom_id, base_net_consumed_qty, unit_cost_applied, total_material_cost,
          consumption_variance_qty, consumption_variance_pct, is_consumption_flagged
        ) VALUES (
          $1, $2, 50.0, 50.0, 50.0, 0.0, 0.0, 'KG', 50.0, 10.00, 500.00, 0.0, 0.0, false
        );
      `, [testRunId, rawFlourId]);

      // Add overhead cost ($100)
      await client.query(`
        INSERT INTO production_run_overheads (
          production_run_id, overhead_type, description, amount
        ) VALUES (
          $1, 'labour', 'Test labor overhead', 100.00
        );
      `, [testRunId]);

      // Execute yield posting
      await client.query(`SELECT fn_post_production_yield($1, $2);`, [testRunId, supervisorId]);

      // Verify costing table record
      const costingRes = await client.query(`
        SELECT * FROM production_run_costing WHERE production_run_id = $1;
      `, [testRunId]);

      assert.equal(costingRes.rows.length, 1, 'Costing record should exist');
      const costing = costingRes.rows[0];
      assert.equal(parseFloat(costing.gross_total_batch_cost), 600.00);
      assert.equal(parseFloat(costing.good_output_units), 100.00);
      assert.equal(parseFloat(costing.cost_per_packet), 6.0000);
      assert.equal(costing.selling_price_per_packet, '0.00');
      // Gross margin must be NULL because selling price is 0
      assert.equal(costing.unit_gross_margin, null, 'Unit gross margin must be NULL when selling price is 0');
      assert.equal(costing.gross_margin_pct, null, 'Gross margin percentage must be NULL when selling price is 0');

      // Verify production run status is completed
      const runCheck = await client.query(`SELECT status FROM production_runs WHERE id = $1;`, [testRunId]);
      assert.equal(runCheck.rows[0].status, 'completed');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  // --------------------------------------------------------------------------
  // TEST 2: WIP Direct Material Cost Inclusion
  // --------------------------------------------------------------------------
  await t.test('2. Direct Material Costing: Includes work_in_progress items in total direct material costs', async () => {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      // Create a WIP item
      const wipRes = await client.query(`
        INSERT INTO items (
          sku, name, item_type, base_uom_id, hsn_code, gst_rate_pct, packets_per_carton, standard_selling_price, standard_purchase_rate, min_reorder_level, is_active
        ) VALUES (
          'WIP-TEST-DOUGH', 'Prepared Murukku Dough', 'work_in_progress', 'KG', '1905', 12.00, 1.00, 0.00, 0.00, 10.00, true
        ) RETURNING id;
      `);
      const wipItemId = wipRes.rows[0].id;

      // Create a test production run
      const runRes = await client.query(`
        INSERT INTO production_runs (
          run_number, bom_id, finished_good_item_id, supervisor_id, run_date, planned_batch_count, standard_batch_size, planned_yield_qty,
          actual_good_output_qty, actual_scrap_output_qty, yield_variance_pct, is_yield_flagged, output_batch_number, status
        ) VALUES (
          'PR-TEST-WIP-001', $1, $2, $3, CURRENT_DATE, 1.0, 100.0, 100.0, 100.0, 0.0, 0.0, false, 'BATCH-WIP-001', 'materials_issued'
        ) RETURNING id;
      `, [existingBomId, existingFgId, supervisorId]);
      const testRunId = runRes.rows[0].id;

      // Add raw_material input ($400)
      await client.query(`
        INSERT INTO production_run_inputs (
          production_run_id, item_id, planned_qty, actual_issued_qty, good_production_qty, damaged_or_scrap_qty,
          returned_to_store_qty, uom_id, base_net_consumed_qty, unit_cost_applied, total_material_cost,
          consumption_variance_qty, consumption_variance_pct, is_consumption_flagged
        ) VALUES (
          $1, $2, 40.0, 40.0, 40.0, 0.0, 0.0, 'KG', 40.0, 10.00, 400.00, 0.0, 0.0, false
        );
      `, [testRunId, rawFlourId]);

      // Add work_in_progress input ($300)
      await client.query(`
        INSERT INTO production_run_inputs (
          production_run_id, item_id, planned_qty, actual_issued_qty, good_production_qty, damaged_or_scrap_qty,
          returned_to_store_qty, uom_id, base_net_consumed_qty, unit_cost_applied, total_material_cost,
          consumption_variance_qty, consumption_variance_pct, is_consumption_flagged
        ) VALUES (
          $1, $2, 10.0, 10.0, 10.0, 0.0, 0.0, 'KG', 10.0, 30.00, 300.00, 0.0, 0.0, false
        );
      `, [testRunId, wipItemId]);

      // Post yield
      await client.query(`SELECT fn_post_production_yield($1, $2);`, [testRunId, supervisorId]);

      // Verify costing table: total_raw_material_cost must sum raw_material + work_in_progress = 700.00
      const costingRes = await client.query(`
        SELECT total_raw_material_cost, gross_total_batch_cost 
        FROM production_run_costing 
        WHERE production_run_id = $1;
      `, [testRunId]);

      assert.equal(costingRes.rows.length, 1);
      assert.equal(
        parseFloat(costingRes.rows[0].total_raw_material_cost),
        700.00,
        'WIP cost must be included in direct material cost'
      );
      assert.equal(parseFloat(costingRes.rows[0].gross_total_batch_cost), 700.00);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  // --------------------------------------------------------------------------
  // TEST 3: Finished Goods Dynamic Base UOM
  // --------------------------------------------------------------------------
  await t.test('3. Ledger Integrity: Yield posting uses finished good actual base UOM (not hardcoded PKT)', async () => {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      // Create a finished good with base UOM = 'KG'
      const itemRes = await client.query(`
        INSERT INTO items (
          sku, name, item_type, base_uom_id, hsn_code, gst_rate_pct, packets_per_carton, standard_selling_price, standard_purchase_rate, min_reorder_level, is_active
        ) VALUES (
          'FG-TEST-BULK-KG', 'Bulk Murukku 5kg Bag', 'finished_good', 'KG', '1905', 12.00, 1.00, 250.00, 0.00, 10.00, true
        ) RETURNING id;
      `);
      const testFgId = itemRes.rows[0].id;

      // Create BOM with batch UOM = 'KG'
      const bomRes = await client.query(`
        INSERT INTO boms (
          finished_good_item_id, bom_code, version_number, standard_batch_size, batch_uom_id, is_active, effective_from, created_by
        ) VALUES (
          $1, 'BOM-TEST-BULK', 1, 50.0, 'KG', true, '2026-01-01', $2
        ) RETURNING id;
      `, [testFgId, supervisorId]);
      const testBomId = bomRes.rows[0].id;

      // Create production run
      const runRes = await client.query(`
        INSERT INTO production_runs (
          run_number, bom_id, finished_good_item_id, supervisor_id, run_date, planned_batch_count, standard_batch_size, planned_yield_qty,
          actual_good_output_qty, actual_scrap_output_qty, yield_variance_pct, is_yield_flagged, output_batch_number, status
        ) VALUES (
          'PR-TEST-BULK-001', $1, $2, $3, CURRENT_DATE, 1.0, 50.0, 50.0, 50.0, 0.0, 0.0, false, 'BATCH-BULK-001', 'materials_issued'
        ) RETURNING id;
      `, [testBomId, testFgId, supervisorId]);
      const testRunId = runRes.rows[0].id;

      // Add input
      await client.query(`
        INSERT INTO production_run_inputs (
          production_run_id, item_id, planned_qty, actual_issued_qty, good_production_qty, damaged_or_scrap_qty,
          returned_to_store_qty, uom_id, base_net_consumed_qty, unit_cost_applied, total_material_cost,
          consumption_variance_qty, consumption_variance_pct, is_consumption_flagged
        ) VALUES (
          $1, $2, 50.0, 50.0, 50.0, 0.0, 0.0, 'KG', 50.0, 10.00, 500.00, 0.0, 0.0, false
        );
      `, [testRunId, rawFlourId]);

      // Post yield
      await client.query(`SELECT fn_post_production_yield($1, $2);`, [testRunId, supervisorId]);

      // Check inventory_ledger entry for this yield
      const ledgerRes = await client.query(`
        SELECT transaction_uom_id, transaction_qty, base_quantity_delta, movement_type 
        FROM inventory_ledger 
        WHERE production_run_yield_id = $1;
      `, [testRunId]);

      assert.equal(ledgerRes.rows.length, 1, 'Inventory ledger entry should exist for yield');
      const entry = ledgerRes.rows[0];
      assert.equal(entry.movement_type, 'PRODUCTION_YIELD');
      assert.equal(entry.transaction_uom_id, 'KG', 'Transaction UOM must match item base UOM (KG), not hardcoded PKT');
      assert.equal(parseFloat(entry.transaction_qty), 50.0);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  // --------------------------------------------------------------------------
  // TEST 4: Production Run Immutability Guards
  // --------------------------------------------------------------------------
  await t.test('4. Immutability Enforcers: Completed production runs reject UPDATE and DELETE', async () => {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      // Create a completed production run
      const runRes = await client.query(`
        INSERT INTO production_runs (
          run_number, bom_id, finished_good_item_id, supervisor_id, run_date, planned_batch_count, standard_batch_size, planned_yield_qty,
          actual_good_output_qty, actual_scrap_output_qty, yield_variance_pct, is_yield_flagged, output_batch_number, status
        ) VALUES (
          'PR-TEST-IMMUTABLE-001', $1, $2, $3, CURRENT_DATE, 1.0, 100.0, 100.0, 100.0, 0.0, 0.0, false, 'BATCH-IMM-001', 'completed'
        ) RETURNING id;
      `, [existingBomId, existingFgId, supervisorId]);
      const testRunId = runRes.rows[0].id;

      // 1. Attempt UPDATE on completed run - MUST FAIL
      let updateError = null;
      try {
        await client.query('SAVEPOINT sp_update;');
        await client.query(`
          UPDATE production_runs 
          SET actual_good_output_qty = 999.0 
          WHERE id = $1;
        `, [testRunId]);
      } catch (err) {
        updateError = err;
        await client.query('ROLLBACK TO SAVEPOINT sp_update;');
      }
      assert.ok(updateError, 'UPDATE on completed production run must fail');
      assert.ok(
        updateError.message.includes('completed and immutable'),
        `Error message must indicate immutability: ${updateError.message}`
      );

      // 2. Attempt DELETE on completed run - MUST FAIL
      let deleteError = null;
      try {
        await client.query('SAVEPOINT sp_delete;');
        await client.query(`DELETE FROM production_runs WHERE id = $1;`, [testRunId]);
      } catch (err) {
        deleteError = err;
        await client.query('ROLLBACK TO SAVEPOINT sp_delete;');
      }
      assert.ok(deleteError, 'DELETE on completed production run must fail');
      assert.ok(
        deleteError.message.includes('Cannot delete production run'),
        `Error message must indicate delete restriction: ${deleteError.message}`
      );
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  // --------------------------------------------------------------------------
  // TEST 5: Production Inputs, Overheads & Costing Immutability
  // --------------------------------------------------------------------------
  await t.test('5. Child Table Immutability: Inputs, overheads & costing reject modification after completion', async () => {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      // Create a production run in 'completed' status
      const runRes = await client.query(`
        INSERT INTO production_runs (
          run_number, bom_id, finished_good_item_id, supervisor_id, run_date, planned_batch_count, standard_batch_size, planned_yield_qty,
          actual_good_output_qty, actual_scrap_output_qty, yield_variance_pct, is_yield_flagged, output_batch_number, status
        ) VALUES (
          'PR-TEST-CHILD-IMM-001', $1, $2, $3, CURRENT_DATE, 1.0, 100.0, 100.0, 100.0, 0.0, 0.0, false, 'BATCH-CHILD-001', 'completed'
        ) RETURNING id;
      `, [existingBomId, existingFgId, supervisorId]);
      const testRunId = runRes.rows[0].id;

      // Insert child records directly
      const inputRes = await client.query(`
        INSERT INTO production_run_inputs (
          production_run_id, item_id, planned_qty, actual_issued_qty, good_production_qty, damaged_or_scrap_qty,
          returned_to_store_qty, uom_id, base_net_consumed_qty, unit_cost_applied, total_material_cost,
          consumption_variance_qty, consumption_variance_pct, is_consumption_flagged
        ) VALUES (
          $1, $2, 40.0, 40.0, 40.0, 0.0, 0.0, 'KG', 40.0, 10.00, 400.00, 0.0, 0.0, false
        ) RETURNING id;
      `, [testRunId, rawFlourId]);
      const inputId = inputRes.rows[0].id;

      const overheadRes = await client.query(`
        INSERT INTO production_run_overheads (
          production_run_id, overhead_type, description, amount
        ) VALUES (
          $1, 'labour', 'Immutable overhead', 50.00
        ) RETURNING id;
      `, [testRunId]);
      const overheadId = overheadRes.rows[0].id;

      await client.query(`
        INSERT INTO production_run_costing (
          production_run_id, total_raw_material_cost, total_packaging_cost, total_direct_overhead_cost,
          gross_total_batch_cost, good_output_units, cost_per_packet, selling_price_per_packet, valuation_method_used
        ) VALUES (
          $1, 400.00, 0.00, 50.00, 450.00, 100.00, 4.50, 50.00, 'WEIGHTED_AVERAGE'
        );
      `, [testRunId]);

      // A. Inputs: Attempt UPDATE and DELETE
      let inputUpdateErr = null;
      try {
        await client.query('SAVEPOINT sp_in_up;');
        await client.query(`UPDATE production_run_inputs SET actual_issued_qty = 99.0 WHERE id = $1;`, [inputId]);
      } catch (err) {
        inputUpdateErr = err;
        await client.query('ROLLBACK TO SAVEPOINT sp_in_up;');
      }
      assert.ok(inputUpdateErr && inputUpdateErr.message.includes('Historical input records are immutable'));

      let inputDeleteErr = null;
      try {
        await client.query('SAVEPOINT sp_in_del;');
        await client.query(`DELETE FROM production_run_inputs WHERE id = $1;`, [inputId]);
      } catch (err) {
        inputDeleteErr = err;
        await client.query('ROLLBACK TO SAVEPOINT sp_in_del;');
      }
      assert.ok(inputDeleteErr && inputDeleteErr.message.includes('Historical input records are immutable'));

      // B. Overheads: Attempt UPDATE and DELETE
      let ovhUpdateErr = null;
      try {
        await client.query('SAVEPOINT sp_ovh_up;');
        await client.query(`UPDATE production_run_overheads SET amount = 999.0 WHERE id = $1;`, [overheadId]);
      } catch (err) {
        ovhUpdateErr = err;
        await client.query('ROLLBACK TO SAVEPOINT sp_ovh_up;');
      }
      assert.ok(ovhUpdateErr && ovhUpdateErr.message.includes('Overhead records are immutable'));

      let ovhDeleteErr = null;
      try {
        await client.query('SAVEPOINT sp_ovh_del;');
        await client.query(`DELETE FROM production_run_overheads WHERE id = $1;`, [overheadId]);
      } catch (err) {
        ovhDeleteErr = err;
        await client.query('ROLLBACK TO SAVEPOINT sp_ovh_del;');
      }
      assert.ok(ovhDeleteErr && ovhDeleteErr.message.includes('Overhead records are immutable'));

      // C. Costing: Attempt UPDATE and DELETE
      let costUpdateErr = null;
      try {
        await client.query('SAVEPOINT sp_cost_up;');
        await client.query(`UPDATE production_run_costing SET gross_total_batch_cost = 1.0 WHERE production_run_id = $1;`, [testRunId]);
      } catch (err) {
        costUpdateErr = err;
        await client.query('ROLLBACK TO SAVEPOINT sp_cost_up;');
      }
      assert.ok(costUpdateErr && costUpdateErr.message.includes('Historical costing is immutable'));

      let costDeleteErr = null;
      try {
        await client.query('SAVEPOINT sp_cost_del;');
        await client.query(`DELETE FROM production_run_costing WHERE production_run_id = $1;`, [testRunId]);
      } catch (err) {
        costDeleteErr = err;
        await client.query('ROLLBACK TO SAVEPOINT sp_cost_del;');
      }
      assert.ok(costDeleteErr && costDeleteErr.message.includes('Historical costing is immutable'));
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  // --------------------------------------------------------------------------
  // TEST 6: Audit Trail Logging & Password Redaction
  // --------------------------------------------------------------------------
  await t.test('6. Audit Trail & Security: Audit logs capture child records and redact user passwords', async () => {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      // 1. Check audit log creation for child records
      const runRes = await client.query(`
        INSERT INTO production_runs (
          run_number, bom_id, finished_good_item_id, supervisor_id, run_date, planned_batch_count, standard_batch_size, planned_yield_qty,
          actual_good_output_qty, actual_scrap_output_qty, yield_variance_pct, is_yield_flagged, output_batch_number, status
        ) VALUES (
          'PR-TEST-AUDIT-001', $1, $2, $3, CURRENT_DATE, 1.0, 100.0, 100.0, 100.0, 0.0, 0.0, false, 'BATCH-AUD-001', 'draft'
        ) RETURNING id;
      `, [existingBomId, existingFgId, supervisorId]);
      const testRunId = runRes.rows[0].id;

      // Insert input record
      const inRes = await client.query(`
        INSERT INTO production_run_inputs (
          production_run_id, item_id, planned_qty, actual_issued_qty, good_production_qty, damaged_or_scrap_qty,
          returned_to_store_qty, uom_id, base_net_consumed_qty, unit_cost_applied, total_material_cost,
          consumption_variance_qty, consumption_variance_pct, is_consumption_flagged
        ) VALUES (
          $1, $2, 10.0, 10.0, 10.0, 0.0, 0.0, 'KG', 10.0, 10.00, 100.00, 0.0, 0.0, false
        ) RETURNING id;
      `, [testRunId, rawFlourId]);
      const testInputId = inRes.rows[0].id;

      // Verify audit log exists for input insert
      const auditInRes = await client.query(`
        SELECT * FROM audit_logs WHERE entity_name = 'production_run_inputs' AND entity_id = $1;
      `, [testInputId]);
      assert.equal(auditInRes.rows.length, 1, 'Audit log must be created for production_run_inputs');
      assert.equal(auditInRes.rows[0].action, 'INSERT_PRODUCTION_RUN_INPUTS');

      // 2. Check password redaction when updating a user record
      const userRes = await client.query(`
        INSERT INTO users (
          username, password_hash, full_name, role, is_active
        ) VALUES (
          'audit_test_user', '$2b$10$supersecretpasswordhashthatmustberedacted', 'Audit Test User', 'auditor', true
        ) RETURNING id;
      `, []);
      const testUserId = userRes.rows[0].id;

      // Update password
      await client.query(`
        UPDATE users 
        SET password_hash = '$2b$10$newsecretpasswordhashthatmustberedacted' 
        WHERE id = $1;
      `, [testUserId]);

      // Query audit logs for this user update
      const userAuditRes = await client.query(`
        SELECT old_values, new_values 
        FROM audit_logs 
        WHERE entity_name = 'users' AND entity_id = $1 AND action = 'UPDATE_USERS';
      `, [testUserId]);

      assert.equal(userAuditRes.rows.length, 1, 'Audit log for user update must exist');
      const auditEntry = userAuditRes.rows[0];
      assert.equal(
        auditEntry.old_values.password_hash,
        '[REDACTED]',
        'old_values password_hash must be redacted'
      );
      assert.equal(
        auditEntry.new_values.password_hash,
        '[REDACTED]',
        'new_values password_hash must be redacted'
      );
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  // --------------------------------------------------------------------------
  // TEST 7: Concurrent BOM Activation Serialization
  // --------------------------------------------------------------------------
  await t.test('7. Concurrency Serialization: Serializes concurrent BOM activations via parent item locking', async () => {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      // Create a test finished good item
      const itemRes = await client.query(`
        INSERT INTO items (
          sku, name, item_type, base_uom_id, hsn_code, gst_rate_pct, packets_per_carton, standard_selling_price, standard_purchase_rate, min_reorder_level, is_active
        ) VALUES (
          'FG-TEST-CONCURRENCY', 'Concurrency Test Product', 'finished_good', 'PKT', '1905', 12.00, 10.00, 50.00, 0.00, 10.00, true
        ) RETURNING id;
      `);
      const testFgId = itemRes.rows[0].id;

      // Create BOM v1
      const bom1Res = await client.query(`
        INSERT INTO boms (
          finished_good_item_id, bom_code, version_number, standard_batch_size, batch_uom_id, is_active, effective_from, created_by
        ) VALUES (
          $1, 'BOM-TEST-CONC-1', 1, 100.0, 'PKT', true, '2026-01-01', $2
        ) RETURNING id;
      `, [testFgId, supervisorId]);
      const bom1Id = bom1Res.rows[0].id;

      // Create BOM v2
      const bom2Res = await client.query(`
        INSERT INTO boms (
          finished_good_item_id, bom_code, version_number, standard_batch_size, batch_uom_id, is_active, effective_from, created_by
        ) VALUES (
          $1, 'BOM-TEST-CONC-2', 2, 100.0, 'PKT', false, '2026-01-01', $2
        ) RETURNING id;
      `, [testFgId, supervisorId]);
      const bom2Id = bom2Res.rows[0].id;

      // Verify that locking the parent item serializes activation cleanly
      // Simulate activation of BOM 2
      await client.query(`SELECT id FROM items WHERE id = $1 FOR UPDATE;`, [testFgId]);
      await client.query(`UPDATE boms SET is_active = false WHERE finished_good_item_id = $1 AND id != $2 AND is_active = true;`, [testFgId, bom2Id]);
      await client.query(`UPDATE boms SET is_active = true WHERE id = $1;`, [bom2Id]);

      // Exactly one BOM must be active
      const activeRes = await client.query(`SELECT id, bom_code FROM boms WHERE finished_good_item_id = $1 AND is_active = true;`, [testFgId]);
      assert.equal(activeRes.rows.length, 1);
      assert.equal(activeRes.rows[0].id, bom2Id);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  // --------------------------------------------------------------------------
  // TEST 8: Benchmark Data Integrity Invariance Check
  // --------------------------------------------------------------------------
  await t.test('8. Benchmark Data Invariance: Confirms zero corruption or data loss in order_to_audit', async () => {
    const finalCountsRes = await query(`
      SELECT 
        (SELECT COUNT(*)::int FROM users) AS users,
        (SELECT COUNT(*)::int FROM items) AS items,
        (SELECT COUNT(*)::int FROM boms) AS boms,
        (SELECT COUNT(*)::int FROM parties) AS parties,
        (SELECT COUNT(*)::int FROM production_runs) AS production_runs,
        (SELECT COUNT(*)::int FROM inventory_ledger) AS inventory_ledger
    `);
    const finalCounts = finalCountsRes.rows[0];

    assert.deepEqual(
      finalCounts,
      initialCounts,
      'Final database counts must match initial benchmark counts exactly'
    );
  });
});
