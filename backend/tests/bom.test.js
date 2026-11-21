import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import { env } from '../src/config/env.js';
import { authRepository } from '../src/modules/auth/auth.repository.js';
import { itemsRepository } from '../src/modules/items/items.repository.js';
import { unitsRepository } from '../src/modules/units/units.repository.js';
import { bomsRepository } from '../src/modules/boms/boms.repository.js';
import { ROLES } from '../src/modules/auth/auth.constants.js';

test('Order-to-Audit: Bill of Materials (BOM) Management Tests', async (t) => {
  let server;
  let baseUrl;

  // Tokens for RBAC testing
  const ownerToken = jwt.sign(
    { sub: 'a0000000-0000-0000-0000-000000000001', username: 'owner_test', role: ROLES.OWNER },
    env.jwt.secret,
    { algorithm: 'HS256', expiresIn: '1h' }
  );

  const supervisorToken = jwt.sign(
    { sub: 'a0000000-0000-0000-0000-000000000003', username: 'sup_test', role: ROLES.PRODUCTION_SUPERVISOR },
    env.jwt.secret,
    { algorithm: 'HS256', expiresIn: '1h' }
  );

  const salesmanToken = jwt.sign(
    { sub: 'a0000000-0000-0000-0000-000000000002', username: 'sales_test', role: ROLES.SALESMAN },
    env.jwt.secret,
    { algorithm: 'HS256', expiresIn: '1h' }
  );

  // Mock stores
  const mockUsers = new Map([
    ['a0000000-0000-0000-0000-000000000001', { id: 'a0000000-0000-0000-0000-000000000001', username: 'owner_test', role: ROLES.OWNER, is_active: true }],
    ['a0000000-0000-0000-0000-000000000002', { id: 'a0000000-0000-0000-0000-000000000002', username: 'sales_test', role: ROLES.SALESMAN, is_active: true }],
    ['a0000000-0000-0000-0000-000000000003', { id: 'a0000000-0000-0000-0000-000000000003', username: 'sup_test', role: ROLES.PRODUCTION_SUPERVISOR, is_active: true }],
  ]);

  const mockUnits = new Map([
    ['KG', { id: 'KG', name: 'Kilogram', dimension: 'weight', base_unit_id: null, conversion_factor_to_base: 1.0 }],
    ['G', { id: 'G', name: 'Gram', dimension: 'weight', base_unit_id: 'KG', conversion_factor_to_base: 0.001 }],
    ['L', { id: 'L', name: 'Litre', dimension: 'volume', base_unit_id: null, conversion_factor_to_base: 1.0 }],
    ['PKT', { id: 'PKT', name: 'Packet', dimension: 'count', base_unit_id: null, conversion_factor_to_base: 1.0 }],
    ['PCS', { id: 'PCS', name: 'Piece', dimension: 'count', base_unit_id: null, conversion_factor_to_base: 1.0 }],
    ['CTN', { id: 'CTN', name: 'Carton', dimension: 'packaging', base_unit_id: null, conversion_factor_to_base: 1.0 }],
  ]);

  const mockItems = new Map([
    ['b0000000-0000-0000-0000-000000000001', {
      id: 'b0000000-0000-0000-0000-000000000001',
      sku: 'RM-FLOUR-001',
      name: 'Rice Flour',
      item_type: 'raw_material',
      base_uom_id: 'KG',
      is_active: true,
    }],
    ['b0000000-0000-0000-0000-000000000002', {
      id: 'b0000000-0000-0000-0000-000000000002',
      sku: 'RM-OIL-001',
      name: 'Refined Oil',
      item_type: 'raw_material',
      base_uom_id: 'L',
      is_active: true,
    }],
    ['b0000000-0000-0000-0000-000000000003', {
      id: 'b0000000-0000-0000-0000-000000000003',
      sku: 'PM-POUCH-200G',
      name: '200g Printed Pouch',
      item_type: 'packaging',
      base_uom_id: 'PCS',
      is_active: true,
    }],
    ['b0000000-0000-0000-0000-000000000004', {
      id: 'b0000000-0000-0000-0000-000000000004',
      sku: 'FG-MURUKKU-200G',
      name: 'Murukku 200g Packet',
      item_type: 'finished_good',
      base_uom_id: 'PKT',
      packets_per_carton: 20,
      is_active: true,
    }],
  ]);

  const mockBoms = new Map();
  let productionLockedBomId = null;

  // Save original repository methods
  const origAuthFindById = authRepository.findById;
  const origItemsFindById = itemsRepository.findById;
  const origUnitsFindById = unitsRepository.findById;
  const origUnitsComputeBaseQuantity = unitsRepository.computeBaseQuantity;
  const origBoms = { ...bomsRepository };

  t.before(async () => {
    // 1. Mock authRepository
    authRepository.findById = async (id) => mockUsers.get(id) || null;

    // 2. Mock itemsRepository
    itemsRepository.findById = async (id) => mockItems.get(id) || null;

    // 3. Mock unitsRepository
    unitsRepository.findById = async (id) => mockUnits.get(id) || null;
    unitsRepository.computeBaseQuantity = async (itemId, quantity, uomId) => {
      const item = mockItems.get(itemId);
      if (!item) throw new Error(`Item ${itemId} not found`);
      const uom = mockUnits.get(uomId);
      if (!uom) throw new Error(`UOM ${uomId} not found`);
      if (uomId === item.base_uom_id) return quantity;
      if (uomId === 'CTN' && item.base_uom_id === 'PKT') {
        const ppc = item.packets_per_carton || 20;
        return quantity * ppc;
      }
      if (uomId === 'PKT' && item.base_uom_id === 'CTN') {
        const ppc = item.packets_per_carton || 20;
        return quantity / ppc;
      }
      if (uom.base_unit_id === item.base_uom_id) {
        return quantity * uom.conversion_factor_to_base;
      }
      throw new Error(`Incompatible UOM conversion: cannot convert ${uomId} to item base unit ${item.base_uom_id}`);
    };

    // 4. Mock bomsRepository
    bomsRepository.findAll = async ({ page = 1, limit = 20, finished_good_item_id }) => {
      let list = Array.from(mockBoms.values());
      if (finished_good_item_id) list = list.filter((b) => b.finished_good_item_id === finished_good_item_id);
      return { total: list.length, page, limit, totalPages: Math.ceil(list.length / limit) || 1, boms: list };
    };

    bomsRepository.findById = async (id) => {
      const b = mockBoms.get(id);
      if (!b) return null;
      const fg = mockItems.get(b.finished_good_item_id);
      return {
        ...b,
        finished_good_name: fg?.name || 'Finished Good',
        finished_good_sku: fg?.sku || 'FG-SKU',
        finished_good_base_uom: fg?.base_uom_id || 'PKT',
      };
    };

    bomsRepository.findByProductAndVersion = async (fgId, version) => {
      for (const b of mockBoms.values()) {
        if (b.finished_good_item_id === fgId && b.version_number === version) return b;
      }
      return null;
    };

    bomsRepository.findActiveByProductId = async (fgId) => {
      for (const b of mockBoms.values()) {
        if (b.finished_good_item_id === fgId && b.is_active) return b;
      }
      return null;
    };

    bomsRepository.isUsedInProduction = async (bomId) => bomId === productionLockedBomId;

    bomsRepository.createWithMaterials = async (bomData, materials) => {
      const id = `d0000000-0000-0000-0000-00000000000${mockBoms.size + 1}`;
      if (bomData.is_active) {
        for (const b of mockBoms.values()) {
          if (b.finished_good_item_id === bomData.finished_good_item_id) {
            b.is_active = false;
          }
        }
      }
      const fullMaterials = materials.map((m, idx) => {
        const item = mockItems.get(m.item_id);
        const uom = mockUnits.get(m.uom_id);
        return {
          id: `e0000000-0000-0000-0000-00000000000${idx + 1}`,
          bom_id: id,
          item_id: m.item_id,
          standard_qty: m.standard_qty,
          uom_id: m.uom_id,
          scrap_allowance_pct: m.scrap_allowance_pct || 0,
          item_name: item?.name || 'Material Item',
          item_sku: item?.sku || 'MAT-SKU',
          item_type: item?.item_type || 'raw_material',
          uom_name: uom?.name || 'Unit',
        };
      });

      const bom = { id, ...bomData, materials: fullMaterials };
      mockBoms.set(id, bom);
      return bom;
    };

    bomsRepository.updateWithMaterials = async (id, headerData, materials) => {
      const existing = mockBoms.get(id);
      if (!existing) return false;
      if (headerData.is_active) {
        for (const b of mockBoms.values()) {
          if (b.finished_good_item_id === existing.finished_good_item_id && b.id !== id) {
            b.is_active = false;
          }
        }
      }
      Object.assign(existing, headerData);
      if (materials && materials.length > 0) {
        existing.materials = materials.map((m, idx) => {
          const item = mockItems.get(m.item_id);
          const uom = mockUnits.get(m.uom_id);
          return {
            id: `e0000000-0000-0000-0000-00000000000${idx + 1}`,
            bom_id: id,
            item_id: m.item_id,
            standard_qty: m.standard_qty,
            uom_id: m.uom_id,
            scrap_allowance_pct: m.scrap_allowance_pct || 0,
            item_name: item?.name,
            item_sku: item?.sku,
            item_type: item?.item_type,
            uom_name: uom?.name,
          };
        });
      }
      return true;
    };

    bomsRepository.setStatus = async (id, isActive) => {
      const existing = mockBoms.get(id);
      if (!existing) return null;
      if (isActive) {
        for (const b of mockBoms.values()) {
          if (b.finished_good_item_id === existing.finished_good_item_id && b.id !== id) {
            b.is_active = false;
          }
        }
      }
      existing.is_active = isActive;
      return existing;
    };

    // 5. Start ephemeral test server
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://localhost:${port}`;
        resolve();
      });
    });
  });

  t.after(async () => {
    authRepository.findById = origAuthFindById;
    itemsRepository.findById = origItemsFindById;
    unitsRepository.findById = origUnitsFindById;
    unitsRepository.computeBaseQuantity = origUnitsComputeBaseQuantity;
    Object.assign(bomsRepository, origBoms);

    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  // ==========================================================================
  // BOM TESTS
  // ==========================================================================

  let createdBomId;

  await t.test('1. BOM Creation: Successfully creates BOM for finished good with supervisor role', async () => {
    const res = await fetch(`${baseUrl}/api/v1/boms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${supervisorToken}`,
      },
      body: JSON.stringify({
        finished_good_item_id: 'b0000000-0000-0000-0000-000000000004',
        bom_code: 'BOM-MURUKKU-V1',
        version_number: 1,
        standard_batch_size: 200.0,
        batch_uom_id: 'PKT',
        tolerance_variance_pct: 3.0,
        is_active: true,
        effective_from: '2026-01-01',
        notes: 'Standard 200 packet batch recipe',
        materials: [
          {
            item_id: 'b0000000-0000-0000-0000-000000000001', // Rice flour
            standard_qty: 40.0,
            uom_id: 'KG',
            scrap_allowance_pct: 0.0,
          },
          {
            item_id: 'b0000000-0000-0000-0000-000000000002', // Oil
            standard_qty: 10.0,
            uom_id: 'L',
            scrap_allowance_pct: 2.0,
          },
          {
            item_id: 'b0000000-0000-0000-0000-000000000003', // 200g Pouch
            standard_qty: 200.0,
            uom_id: 'PCS',
            scrap_allowance_pct: 1.0,
          },
        ],
      }),
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.bom.bom_code, 'BOM-MURUKKU-V1');
    assert.equal(body.data.bom.materials.length, 3);
    createdBomId = body.data.bom.id;
  });

  await t.test('2. BOM Creation: Rejects creation when finished good is not of type finished_good', async () => {
    const res = await fetch(`${baseUrl}/api/v1/boms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${supervisorToken}`,
      },
      body: JSON.stringify({
        finished_good_item_id: 'b0000000-0000-0000-0000-000000000001', // raw material flour
        bom_code: 'BOM-INVALID-FG',
        version_number: 1,
        standard_batch_size: 100.0,
        batch_uom_id: 'KG',
        effective_from: '2026-01-01',
        materials: [{ item_id: 'b0000000-0000-0000-0000-000000000002', standard_qty: 10.0, uom_id: 'L' }],
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.message.includes('finished_good'));
  });

  await t.test('3. BOM Creation: Rejects finished good included as its own raw material', async () => {
    const res = await fetch(`${baseUrl}/api/v1/boms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${supervisorToken}`,
      },
      body: JSON.stringify({
        finished_good_item_id: 'b0000000-0000-0000-0000-000000000004',
        bom_code: 'BOM-SELF-REF',
        version_number: 2,
        standard_batch_size: 200.0,
        batch_uom_id: 'PKT',
        effective_from: '2026-01-01',
        materials: [
          {
            item_id: 'b0000000-0000-0000-0000-000000000004', // Murukku added to Murukku
            standard_qty: 10.0,
            uom_id: 'PKT',
          },
        ],
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.message.includes('own raw material'));
  });

  await t.test('4. BOM Creation: Rejects zero or negative material quantity', async () => {
    const res = await fetch(`${baseUrl}/api/v1/boms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${supervisorToken}`,
      },
      body: JSON.stringify({
        finished_good_item_id: 'b0000000-0000-0000-0000-000000000004',
        bom_code: 'BOM-NEG-QTY',
        version_number: 2,
        standard_batch_size: 200.0,
        batch_uom_id: 'PKT',
        effective_from: '2026-01-01',
        materials: [
          {
            item_id: 'b0000000-0000-0000-0000-000000000001',
            standard_qty: -5.0, // negative quantity
            uom_id: 'KG',
          },
        ],
      }),
    });

    assert.equal(res.status, 400);
  });

  await t.test('5. BOM Creation: Rejects duplicate material entries within the same BOM', async () => {
    const res = await fetch(`${baseUrl}/api/v1/boms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${supervisorToken}`,
      },
      body: JSON.stringify({
        finished_good_item_id: 'b0000000-0000-0000-0000-000000000004',
        bom_code: 'BOM-DUP-MAT',
        version_number: 2,
        standard_batch_size: 200.0,
        batch_uom_id: 'PKT',
        effective_from: '2026-01-01',
        materials: [
          { item_id: 'b0000000-0000-0000-0000-000000000001', standard_qty: 20.0, uom_id: 'KG' },
          { item_id: 'b0000000-0000-0000-0000-000000000001', standard_qty: 20.0, uom_id: 'KG' }, // duplicate item
        ],
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.message.includes('Duplicate material entry'));
  });

  await t.test('6. BOM Creation: Rejects incompatible UOM dimension for material', async () => {
    const res = await fetch(`${baseUrl}/api/v1/boms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${supervisorToken}`,
      },
      body: JSON.stringify({
        finished_good_item_id: 'b0000000-0000-0000-0000-000000000004',
        bom_code: 'BOM-INCOMPAT-UOM',
        version_number: 2,
        standard_batch_size: 200.0,
        batch_uom_id: 'PKT',
        effective_from: '2026-01-01',
        materials: [
          {
            item_id: 'b0000000-0000-0000-0000-000000000001', // Rice flour (weight: KG)
            standard_qty: 40.0,
            uom_id: 'L', // specified Litre (volume) -> Incompatible!
          },
        ],
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.message.includes('incompatible'));
  });

  await t.test('7. BOM Retrieval: GET /api/v1/boms/:id returns BOM details with full material recipe', async () => {
    const res = await fetch(`${baseUrl}/api/v1/boms/${createdBomId}`, {
      headers: { Authorization: `Bearer ${supervisorToken}` },
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.bom.id, createdBomId);
    assert.equal(body.data.bom.materials.length, 3);
    assert.equal(body.data.bom.finished_good_sku, 'FG-MURUKKU-200G');
  });

  await t.test('8. Material Requirement Calculation: POST /api/v1/boms/:id/calculate-requirements correctly scales requirements', async () => {
    // BOM expected output = 200 packets
    // Requesting 400 packets (exact 2x scale)
    const res = await fetch(`${baseUrl}/api/v1/boms/${createdBomId}/calculate-requirements`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${supervisorToken}`,
      },
      body: JSON.stringify({
        requested_output_qty: 400.0,
      }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.scale_factor, 2.0);

    const flour = body.data.materials.find((m) => m.item_sku === 'RM-FLOUR-001');
    const oil = body.data.materials.find((m) => m.item_sku === 'RM-OIL-001');
    const pouches = body.data.materials.find((m) => m.item_sku === 'PM-POUCH-200G');

    assert.ok(flour);
    assert.ok(oil);
    assert.ok(pouches);

    // Flour: 40 kg * 2 = 80 kg
    assert.equal(flour.planned_required_qty, 80.0);
    assert.equal(flour.total_required_qty, 80.0);

    // Oil: 10 L * 2 = 20 L planned + 2% scrap (0.4 L) = 20.4 L
    assert.equal(oil.planned_required_qty, 20.0);
    assert.equal(oil.scrap_allowance_qty, 0.4);
    assert.equal(oil.total_required_qty, 20.4);

    // Pouches: 200 pcs * 2 = 400 pcs planned + 1% scrap (4 pcs) = 404 pcs
    assert.equal(pouches.planned_required_qty, 400.0);
    assert.equal(pouches.scrap_allowance_qty, 4.0);
    assert.equal(pouches.total_required_qty, 404.0);
  });

  await t.test('9. Version Preservation: Rejects altering recipe on BOM used in recorded production', async () => {
    // Lock this BOM as used in production
    productionLockedBomId = createdBomId;

    const res = await fetch(`${baseUrl}/api/v1/boms/${createdBomId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${supervisorToken}`,
      },
      body: JSON.stringify({
        standard_batch_size: 250.0, // Attempting to alter batch size
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.message.includes('used in recorded production runs'));

    // Release lock
    productionLockedBomId = null;
  });

  await t.test('10. RBAC: Salesman role has NO access to BOM endpoints (403 Forbidden)', async () => {
    // GET /api/v1/boms
    const getRes = await fetch(`${baseUrl}/api/v1/boms`, {
      headers: { Authorization: `Bearer ${salesmanToken}` },
    });
    assert.equal(getRes.status, 403, 'Salesman must receive 403 on BOM list');

    // POST /api/v1/boms
    const postRes = await fetch(`${baseUrl}/api/v1/boms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        finished_good_item_id: 'b0000000-0000-0000-0000-000000000004',
        bom_code: 'BOM-UNAUTH',
        version_number: 3,
        standard_batch_size: 100.0,
        batch_uom_id: 'PKT',
        effective_from: '2026-01-01',
        materials: [{ item_id: 'b0000000-0000-0000-0000-000000000001', standard_qty: 10.0, uom_id: 'KG' }],
      }),
    });
    assert.equal(postRes.status, 403, 'Salesman must receive 403 on BOM create');
  });

  await t.test('11. Output UOM Conversion: Accurately converts compatible output UOM (10 CTN = 200 PKT, scale = 1.0)', async () => {
    // Murukku batch size = 200 PKT. 1 CTN = 20 PKT.
    // 10 CTN = 200 PKT -> exact scale factor 1.0
    const res = await fetch(`${baseUrl}/api/v1/boms/${createdBomId}/calculate-requirements`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${supervisorToken}`,
      },
      body: JSON.stringify({
        requested_output_qty: 10.0,
        output_uom_id: 'CTN',
      }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.requested_output.quantity, 10.0);
    assert.equal(body.data.requested_output.uom_id, 'CTN');
    assert.equal(body.data.normalized_output.quantity, 200.0);
    assert.equal(body.data.normalized_output.uom_id, 'PKT');
    assert.equal(body.data.scale_factor, 1.0);

    const flour = body.data.materials.find((m) => m.item_sku === 'RM-FLOUR-001');
    assert.equal(flour.planned_required_qty, 40.0);
    assert.equal(flour.total_required_qty, 40.0);
  });

  await t.test('12. Output UOM Conversion: Rejects incompatible dimension output UOM (400 Bad Request)', async () => {
    // Finished good is count/packaging ('PKT'). 'L' is volume. Incompatible!
    const res = await fetch(`${baseUrl}/api/v1/boms/${createdBomId}/calculate-requirements`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${supervisorToken}`,
      },
      body: JSON.stringify({
        requested_output_qty: 5.0,
        output_uom_id: 'L',
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.ok(body.message.includes('Incompatible output UOM'));
  });

  await t.test('13. Output UOM Conversion: Rejects non-existent output UOM (400 Bad Request)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/boms/${createdBomId}/calculate-requirements`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${supervisorToken}`,
      },
      body: JSON.stringify({
        requested_output_qty: 10.0,
        output_uom_id: 'XYZ',
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.ok(body.message.includes('does not exist'));
  });

  await t.test('14. BOM Update Validation: Rejects duplicate material items (400 Bad Request)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/boms/${createdBomId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${supervisorToken}`,
      },
      body: JSON.stringify({
        materials: [
          { item_id: 'b0000000-0000-0000-0000-000000000001', standard_qty: 10.0, uom_id: 'KG' },
          { item_id: 'b0000000-0000-0000-0000-000000000001', standard_qty: 20.0, uom_id: 'KG' },
        ],
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.ok(body.message.includes('Duplicate material entry'));
  });

  await t.test('15. BOM Update Validation: Rejects material of type finished_good (400 Bad Request)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/boms/${createdBomId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${supervisorToken}`,
      },
      body: JSON.stringify({
        materials: [
          { item_id: 'b0000000-0000-0000-0000-000000000004', standard_qty: 5.0, uom_id: 'PKT' },
        ],
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.ok(body.message.includes('cannot be included as its own raw material') || body.message.includes('finished_good'));
  });

  await t.test('16. BOM Update Validation: Rejects non-positive material quantity (400 Bad Request)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/boms/${createdBomId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${supervisorToken}`,
      },
      body: JSON.stringify({
        materials: [
          { item_id: 'b0000000-0000-0000-0000-000000000001', standard_qty: -5.0, uom_id: 'KG' },
        ],
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.success, false);
    const hasQtyError = body.message.includes('greater than 0') || (body.errors && body.errors.some((e) => e.message.includes('greater than 0')));
    assert.ok(hasQtyError, 'Should report that standard_qty must be greater than 0');
  });

  await t.test('17. BOM Update Validation: Rejects incompatible material UOM dimension (400 Bad Request)', async () => {
    // Flour base UOM is KG (weight). Providing 'L' (volume) must fail
    const res = await fetch(`${baseUrl}/api/v1/boms/${createdBomId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${supervisorToken}`,
      },
      body: JSON.stringify({
        materials: [
          { item_id: 'b0000000-0000-0000-0000-000000000001', standard_qty: 10.0, uom_id: 'L' },
        ],
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.ok(body.message.includes('incompatible with item base UOM'));
  });

  await t.test('18. BOM Update Validation: Rejects non-positive standard_batch_size (400 Bad Request)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/boms/${createdBomId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${supervisorToken}`,
      },
      body: JSON.stringify({
        standard_batch_size: 0,
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.success, false);
  });

  await t.test('19. BOM Update Validation: Rejects incompatible batch_uom_id dimension (400 Bad Request)', async () => {
    // Finished good base UOM is 'PKT' (count). 'KG' (weight) is incompatible
    const res = await fetch(`${baseUrl}/api/v1/boms/${createdBomId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${supervisorToken}`,
      },
      body: JSON.stringify({
        batch_uom_id: 'KG',
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.ok(body.message.includes('incompatible with finished good base UOM'));
  });
});
