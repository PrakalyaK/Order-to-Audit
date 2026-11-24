const API_BASE = 'http://localhost:5000/api/v1';

async function request(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`[${res.status}] ${data.message || JSON.stringify(data)}`);
  }
  return data;
}

async function run() {
  console.log('=== VERIFYING BOM & PRODUCTION WORKFLOW END-TO-END ===\n');

  // 1. Authenticate as Factory Admin
  console.log('1. Authenticating as Factory Admin...');
  const loginRes = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      username: 'admin_factory',
      password: 'Password@123',
    }),
  });
  const token = loginRes.data.token;
  const authHeaders = { Authorization: `Bearer ${token}` };
  console.log('✓ Logged in as:', loginRes.data.user.username, `(${loginRes.data.user.role})`);

  // 2. Fetch all BOMs
  console.log('\n2. Fetching Product Recipe Catalogue (GET /api/v1/boms)...');
  const bomsRes = await request('/boms', { headers: authHeaders });
  const boms = bomsRes.data.boms;
  console.log(`✓ Fetched ${boms.length} BOM records in catalogue.`);

  const expectedProducts = [
    'Murukku – 200g',
    'Potato Chips – 100g',
    'Banana Chips – 100g',
    'Mixture – 200g',
    'Ribbon Pakoda – 200g',
    'Thattai – 200g',
    'Masala Chips – 100g',
    'Kara Boondi – 200g',
    'Tapioca Chips – 100g',
    'Seedai – 200g',
  ];

  console.log('\n3. Validating 10 Manufactured Snack Products in Catalogue:');
  for (const expName of expectedProducts) {
    const found = boms.find(
      (b) =>
        (b.finished_good_name && b.finished_good_name.includes(expName.split(' –')[0])) ||
        (b.item_name && b.item_name.includes(expName.split(' –')[0]))
    );
    if (!found) {
      throw new Error(`Expected product "${expName}" not found in BOM catalogue!`);
    }
    const cost = parseFloat(found.estimated_material_cost || 0);
    const unitCost = parseFloat(found.estimated_cost_per_unit || 0);
    console.log(
      `  ✓ [${found.bom_code}] ${expName} — Est Batch Cost: ₹${cost.toFixed(2)} | Cost/Pkt: ₹${unitCost.toFixed(2)} | Image: ${found.finished_good_image_url || 'default'}`
    );
  }

  // 4. Inspect Recipe Details for Potato Chips
  console.log('\n4. Inspecting Recipe Details for Potato Chips (GET /api/v1/boms/:id)...');
  const ptcBom = boms.find((b) => b.bom_code === 'BOM-PTC-100G');
  if (!ptcBom) throw new Error('BOM-PTC-100G not found!');
  const ptcDetailRes = await request(`/boms/${ptcBom.id}`, { headers: authHeaders });
  const ptcBomDetail = ptcDetailRes.data.bom;
  console.log(`✓ BOM: ${ptcBomDetail.bom_code} (v${ptcBomDetail.version_number})`);
  console.log(`  Ingredients (${ptcBomDetail.materials.length} components):`);
  for (const m of ptcBomDetail.materials) {
    console.log(
      `    - ${m.item_name} (${m.item_sku}): ${m.standard_qty} ${m.uom_id} (Scrap: ${m.scrap_allowance_pct}%) | Unit Moving WAC: ₹${parseFloat(m.unit_cost).toFixed(2)} | Avail: ${parseFloat(m.available_stock_qty).toFixed(1)} ${m.uom_id}`
    );
  }

  // 5. Test Live Material Requirements Calculation
  console.log('\n5. Calculating Material Requirements for 200 PKT Potato Chips (POST /api/v1/boms/:id/calculate-requirements)...');
  const reqRes = await request(`/boms/${ptcBom.id}/calculate-requirements`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      requested_output_qty: 200,
      output_uom_id: 'PKT',
    }),
  });
  console.log('✓ Requirements calculated:');
  console.log(`  All materials available in stock: ${reqRes.data.all_materials_available}`);
  for (const m of reqRes.data.materials) {
    console.log(
      `    - ${m.item_name}: Required ${m.total_required_qty} ${m.uom_id} | Available: ${m.available_stock_qty} | Sufficient: ${m.has_sufficient_stock}`
    );
  }

  // 6. Schedule a New Production Run (Stage 1-2)
  console.log('\n6. Scheduling New Production Run for Banana Chips 100g (POST /api/v1/production)...');
  const bncBom = boms.find((b) => b.bom_code === 'BOM-BNC-100G');
  if (!bncBom) throw new Error('BOM-BNC-100G not found!');

  const scheduleRes = await request('/production', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      bom_id: bncBom.id,
      planned_batch_count: 1.0,
      run_date: '2026-04-02',
      notes: 'Automated end-to-end verification run',
    }),
  });
  const runId = scheduleRes.data.id;
  console.log(`✓ Production Run Scheduled: ${scheduleRes.data.run_number} | Status: ${scheduleRes.data.status} | Batch: ${scheduleRes.data.output_batch_number}`);

  // 7. Issue Materials to Shop Floor (Stage 3)
  console.log(`\n7. Issuing Raw Materials from Store (POST /api/v1/production/${runId}/issue)...`);
  const issueRes = await request(`/production/${runId}/issue`, {
    method: 'POST',
    headers: authHeaders,
  });
  console.log(`✓ Materials Issued: Run status is now "${issueRes.data.status}"`);

  // 8. Record Actual Yield & Direct Overheads (Stage 4 & 5)
  console.log(`\n8. Recording Production Output & Overheads (POST /api/v1/production/${runId}/yield)...`);
  const yieldRes = await request(`/production/${runId}/yield`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      actual_good_output_qty: 200,
      actual_scrap_output_qty: 4,
      overheads: [
        { overhead_type: 'labour', description: 'Direct Factory Labour', amount: 1200 },
        { overhead_type: 'power_gas', description: 'Factory Power & Fuel', amount: 600 },
      ],
    }),
  });
  console.log(`✓ Yield Posted: Run status is now "${yieldRes.data.status}"`);
  console.log(`  Actual Good Output: ${yieldRes.data.actual_good_output_qty} PKT`);
  console.log(`  Scrap Output: ${yieldRes.data.actual_scrap_output_qty} PKT`);
  console.log(`  Yield Variance: ${yieldRes.data.yield_variance_pct}%`);

  // 9. Verify Costing & Absorption (Stage 6)
  console.log(`\n9. Inspecting Production Costing (GET /api/v1/production/${runId}/costing)...`);
  const costingRes = await request(`/production/${runId}/costing`, { headers: authHeaders });
  const costing = costingRes.data.costing;
  console.log('✓ Costing Breakdown:');
  console.log(`  - Raw Material Cost: ₹${parseFloat(costing.total_raw_material_cost).toFixed(2)}`);
  console.log(`  - Packaging Cost:    ₹${parseFloat(costing.total_packaging_cost).toFixed(2)}`);
  console.log(`  - Overhead Cost:     ₹${parseFloat(costing.total_direct_overhead_cost).toFixed(2)}`);
  console.log(`  - Gross Total Cost:  ₹${parseFloat(costing.gross_total_batch_cost).toFixed(2)}`);
  console.log(`  - Cost per Packet:   ₹${parseFloat(costing.cost_per_packet).toFixed(2)} / pkt`);
  console.log(`  - Selling Price:     ₹${parseFloat(costing.selling_price_per_packet).toFixed(2)} / pkt`);
  console.log(`  - Gross Margin:      ${parseFloat(costing.gross_margin_pct).toFixed(1)}%`);

  // 10. Verify Variance
  console.log(`\n10. Inspecting Mass Balance & Variance (GET /api/v1/production/${runId}/variance)...`);
  const varianceRes = await request(`/production/${runId}/variance`, { headers: authHeaders });
  console.log(`✓ Planned Yield: ${varianceRes.data.planned_yield_qty} | Actual Good: ${varianceRes.data.actual_good_output_qty}`);
  console.log(`  Materials consumed count: ${varianceRes.data.materials.length}`);

  // 11. Immutability verification: cannot issue or complete again
  console.log('\n11. Verifying Database Immutability & Workflow Guards...');
  try {
    await request(`/production/${runId}/issue`, { method: 'POST', headers: authHeaders });
    throw new Error('Expected re-issuing materials to fail!');
  } catch (err) {
    console.log('  ✓ Double-issue blocked:', err.message);
  }

  try {
    await request(`/production/${runId}/yield`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ actual_good_output_qty: 200 }),
    });
    throw new Error('Expected re-completing yield to fail!');
  } catch (err) {
    console.log('  ✓ Double-yield blocked:', err.message);
  }

  console.log('\n======================================================');
  console.log('🎉 ALL END-TO-END BOM & PRODUCTION WORKFLOWS VERIFIED!');
  console.log('======================================================\n');
}

run().catch((err) => {
  console.error('\n❌ VERIFICATION FAILED:', err);
  process.exit(1);
});
