import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import { env } from '../src/config/env.js';
import { authRepository } from '../src/modules/auth/auth.repository.js';
import { unitsRepository } from '../src/modules/units/units.repository.js';
import { itemsRepository } from '../src/modules/items/items.repository.js';
import { partiesRepository } from '../src/modules/parties/parties.repository.js';
import { ROLES } from '../src/modules/auth/auth.constants.js';

test('Order-to-Audit: Master Data Management Tests (Units, Items, Parties)', async (t) => {
  let server;
  let baseUrl;

  // Generate tokens for each role
  const ownerToken = jwt.sign(
    { sub: 'a0000000-0000-0000-0000-000000000001', username: 'owner_test', role: ROLES.OWNER },
    env.jwt.secret,
    { algorithm: 'HS256', expiresIn: '1h' }
  );

  const salesmanToken = jwt.sign(
    { sub: 'a0000000-0000-0000-0000-000000000002', username: 'sales_test', role: ROLES.SALESMAN },
    env.jwt.secret,
    { algorithm: 'HS256', expiresIn: '1h' }
  );

  const supervisorToken = jwt.sign(
    { sub: 'a0000000-0000-0000-0000-000000000003', username: 'sup_test', role: ROLES.PRODUCTION_SUPERVISOR },
    env.jwt.secret,
    { algorithm: 'HS256', expiresIn: '1h' }
  );

  // In-memory mock stores to guarantee zero database modification
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
      hsn_code: '1102',
      gst_rate_pct: 5.0,
      standard_selling_price: 0,
      standard_purchase_rate: 45.0,
      min_reorder_level: 50.0,
      packets_per_carton: 1.0,
      is_active: true,
    }],
    ['b0000000-0000-0000-0000-000000000002', {
      id: 'b0000000-0000-0000-0000-000000000002',
      sku: 'FG-MURUKKU-200G',
      name: 'Murukku 200g Packet',
      item_type: 'finished_good',
      base_uom_id: 'PKT',
      hsn_code: '1905',
      gst_rate_pct: 12.0,
      standard_selling_price: 35.0,
      standard_purchase_rate: 0,
      min_reorder_level: 100.0,
      packets_per_carton: 20.0,
      is_active: true,
    }],
  ]);

  const mockParties = new Map([
    ['c0000000-0000-0000-0000-000000000001', {
      id: 'c0000000-0000-0000-0000-000000000001',
      party_type: 'customer',
      trade_name: 'Anand Sweets & Snacks',
      contact_person: 'Anand Kumar',
      phone: '9840012345',
      email: 'anand@sweets.com',
      gstin: '33AAAAA1234A1Z5',
      state_code: '33',
      state_name: 'Tamil Nadu',
      billing_address: '12 Mount Road, Chennai',
      shipping_address: '12 Mount Road, Chennai',
      credit_limit: 100000.0,
      payment_terms_days: 30,
      is_active: true,
    }],
  ]);

  // Save original methods
  const origAuthFindById = authRepository.findById;
  const origUnits = { ...unitsRepository };
  const origItems = { ...itemsRepository };
  const origParties = { ...partiesRepository };

  t.before(async () => {
    // 1. Mock authRepository
    authRepository.findById = async (id) => mockUsers.get(id) || null;

    // 2. Mock unitsRepository
    unitsRepository.findAll = async () => Array.from(mockUnits.values());
    unitsRepository.findById = async (id) => mockUnits.get(id) || null;
    unitsRepository.create = async (data) => {
      mockUnits.set(data.id, data);
      return data;
    };
    unitsRepository.computeBaseQuantity = async (itemId, qty, uomId) => {
      const uom = mockUnits.get(uomId);
      return qty * (uom ? uom.conversion_factor_to_base : 1);
    };

    // 3. Mock itemsRepository
    itemsRepository.findAll = async ({ page = 1, limit = 20, search, item_type }) => {
      let list = Array.from(mockItems.values());
      if (search) list = list.filter((i) => i.name.toLowerCase().includes(search.toLowerCase()) || i.sku.toLowerCase().includes(search.toLowerCase()));
      if (item_type) list = list.filter((i) => i.item_type === item_type);
      return { total: list.length, page, limit, totalPages: Math.ceil(list.length / limit) || 1, items: list };
    };
    itemsRepository.findById = async (id) => mockItems.get(id) || null;
    itemsRepository.findBySku = async (sku) => {
      for (const item of mockItems.values()) {
        if (item.sku.toLowerCase() === sku.toLowerCase()) return item;
      }
      return null;
    };
    itemsRepository.create = async (data) => {
      const id = `b0000000-0000-0000-0000-00000000000${mockItems.size + 1}`;
      const item = { id, ...data };
      mockItems.set(id, item);
      return item;
    };
    itemsRepository.update = async (id, data) => {
      const existing = mockItems.get(id);
      if (!existing) return null;
      const updated = { ...existing, ...data };
      mockItems.set(id, updated);
      return updated;
    };
    itemsRepository.setStatus = async (id, isActive) => {
      const existing = mockItems.get(id);
      if (!existing) return null;
      existing.is_active = isActive;
      mockItems.set(id, existing);
      return existing;
    };
    itemsRepository.countActiveBomReferences = async () => 0;

    // 4. Mock partiesRepository
    partiesRepository.findAll = async ({ page = 1, limit = 20, search, party_type }) => {
      let list = Array.from(mockParties.values());
      if (search) list = list.filter((p) => p.trade_name.toLowerCase().includes(search.toLowerCase()));
      if (party_type) list = list.filter((p) => p.party_type === party_type);
      return { total: list.length, page, limit, totalPages: Math.ceil(list.length / limit) || 1, parties: list };
    };
    partiesRepository.findById = async (id) => mockParties.get(id) || null;
    partiesRepository.findByGstin = async (gstin) => {
      for (const party of mockParties.values()) {
        if (party.gstin && party.gstin.toUpperCase() === gstin.toUpperCase()) return party;
      }
      return null;
    };
    partiesRepository.create = async (data) => {
      const id = `c0000000-0000-0000-0000-00000000000${mockParties.size + 1}`;
      const party = { id, ...data };
      mockParties.set(id, party);
      return party;
    };
    partiesRepository.update = async (id, data) => {
      const existing = mockParties.get(id);
      if (!existing) return null;
      const updated = { ...existing, ...data };
      mockParties.set(id, updated);
      return updated;
    };
    partiesRepository.setStatus = async (id, isActive) => {
      const existing = mockParties.get(id);
      if (!existing) return null;
      existing.is_active = isActive;
      mockParties.set(id, existing);
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
    // Restore all mocked repositories
    authRepository.findById = origAuthFindById;
    Object.assign(unitsRepository, origUnits);
    Object.assign(itemsRepository, origItems);
    Object.assign(partiesRepository, origParties);

    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  // ==========================================================================
  // UNITS OF MEASURE TESTS
  // ==========================================================================

  await t.test('1. Units: GET /api/v1/units lists all units of measure', async () => {
    const res = await fetch(`${baseUrl}/api/v1/units`, {
      headers: { Authorization: `Bearer ${salesmanToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(Array.isArray(body.data.units));
    assert.ok(body.data.units.some((u) => u.id === 'KG'));
  });

  await t.test('2. Units: GET /api/v1/units/:id returns details for valid unit code', async () => {
    const res = await fetch(`${baseUrl}/api/v1/units/KG`, {
      headers: { Authorization: `Bearer ${salesmanToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.unit.id, 'KG');
    assert.equal(body.data.unit.dimension, 'weight');
  });

  await t.test('3. Units: GET /api/v1/units/:id returns 404 for unknown unit', async () => {
    const res = await fetch(`${baseUrl}/api/v1/units/UNKNOWN`, {
      headers: { Authorization: `Bearer ${salesmanToken}` },
    });
    assert.equal(res.status, 404);
  });

  await t.test('4. Units: POST /api/v1/units creates unit with owner role', async () => {
    const res = await fetch(`${baseUrl}/api/v1/units`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        id: 'MG',
        name: 'Milligram',
        dimension: 'weight',
        base_unit_id: 'KG',
        conversion_factor_to_base: 0.000001,
      }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.unit.id, 'MG');
  });

  await t.test('5. Units: POST /api/v1/units returns 403 Forbidden for salesman role', async () => {
    const res = await fetch(`${baseUrl}/api/v1/units`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        id: 'TON',
        name: 'Metric Ton',
        dimension: 'weight',
        base_unit_id: 'KG',
        conversion_factor_to_base: 1000.0,
      }),
    });
    assert.equal(res.status, 403);
  });

  // ==========================================================================
  // ITEMS MANAGEMENT TESTS
  // ==========================================================================

  let createdItemId;

  await t.test('6. Items: GET /api/v1/items lists items with pagination & search', async () => {
    const res = await fetch(`${baseUrl}/api/v1/items?search=Flour`, {
      headers: { Authorization: `Bearer ${salesmanToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.items.length, 1);
    assert.equal(body.data.items[0].sku, 'RM-FLOUR-001');
  });

  await t.test('7. Items: POST /api/v1/items creates a new raw material item with owner role', async () => {
    const res = await fetch(`${baseUrl}/api/v1/items`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        sku: 'RM-OIL-001',
        name: 'Refined Palm Oil',
        item_type: 'raw_material',
        base_uom_id: 'L',
        hsn_code: '1511',
        gst_rate_pct: 5.0,
        standard_purchase_rate: 95.0,
        standard_selling_price: 0,
        min_reorder_level: 20.0,
        packets_per_carton: 1.0,
      }),
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.item.sku, 'RM-OIL-001');
    createdItemId = body.data.item.id;
  });

  await t.test('8. Items: POST /api/v1/items returns 409 Conflict on duplicate SKU', async () => {
    const res = await fetch(`${baseUrl}/api/v1/items`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        sku: 'RM-FLOUR-001', // already exists
        name: 'Duplicate Flour',
        item_type: 'raw_material',
        base_uom_id: 'KG',
        hsn_code: '1102',
      }),
    });
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.ok(body.message.includes('already exists'));
  });

  await t.test('9. Items: POST /api/v1/items returns 400 Bad Request on invalid base UOM', async () => {
    const res = await fetch(`${baseUrl}/api/v1/items`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        sku: 'RM-INVALID-UOM',
        name: 'Test Item',
        item_type: 'raw_material',
        base_uom_id: 'NON_EXISTENT_UOM',
        hsn_code: '1102',
      }),
    });
    assert.equal(res.status, 400);
  });

  await t.test('10. Items: POST /api/v1/items returns 400 Bad Request on invalid item_type classification', async () => {
    const res = await fetch(`${baseUrl}/api/v1/items`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        sku: 'RM-INVALID-TYPE',
        name: 'Test Item',
        item_type: 'invalid_classification_type',
        base_uom_id: 'KG',
        hsn_code: '1102',
      }),
    });
    assert.equal(res.status, 400);
  });

  await t.test('11. Items: PATCH /api/v1/items/:id updates item details', async () => {
    const res = await fetch(`${baseUrl}/api/v1/items/${createdItemId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        standard_purchase_rate: 98.5,
        min_reorder_level: 25.0,
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.item.standard_purchase_rate, 98.5);
  });

  await t.test('12. Items: PATCH /api/v1/items/:id/status toggles item active status', async () => {
    const res = await fetch(`${baseUrl}/api/v1/items/${createdItemId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({ is_active: false }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.item.is_active, false);
  });

  await t.test('13. Items: POST /api/v1/items returns 403 Forbidden for salesman role', async () => {
    const res = await fetch(`${baseUrl}/api/v1/items`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        sku: 'RM-TEST-UNAUTH',
        name: 'Unauth Item',
        item_type: 'raw_material',
        base_uom_id: 'KG',
        hsn_code: '1102',
      }),
    });
    assert.equal(res.status, 403);
  });

  // ==========================================================================
  // PARTIES MANAGEMENT TESTS
  // ==========================================================================

  let createdPartyId;

  await t.test('14. Parties: GET /api/v1/parties lists parties for salesman role', async () => {
    const res = await fetch(`${baseUrl}/api/v1/parties`, {
      headers: { Authorization: `Bearer ${salesmanToken}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.data.parties.length >= 1);
  });

  await t.test('15. Parties: GET /api/v1/parties returns 403 Forbidden for production supervisor', async () => {
    const res = await fetch(`${baseUrl}/api/v1/parties`, {
      headers: { Authorization: `Bearer ${supervisorToken}` },
    });
    assert.equal(res.status, 403, 'Production supervisor must NOT have access to parties data');
  });

  await t.test('16. Parties: POST /api/v1/parties creates party with owner role', async () => {
    const res = await fetch(`${baseUrl}/api/v1/parties`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        party_type: 'supplier',
        trade_name: 'Shree Krishna Agro Traders',
        contact_person: 'Gopal Sharma',
        phone: '9845098450',
        email: 'gopal@agrotraders.com',
        gstin: '29ABCDE1234F1Z5',
        state_code: '29',
        state_name: 'Karnataka',
        billing_address: '45 APMC Yard, Bangalore',
        credit_limit: 500000.0,
        payment_terms_days: 15,
      }),
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.party.trade_name, 'Shree Krishna Agro Traders');
    createdPartyId = body.data.party.id;
  });

  await t.test('17. Parties: POST /api/v1/parties returns 400 Bad Request on invalid GSTIN format', async () => {
    const res = await fetch(`${baseUrl}/api/v1/parties`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        party_type: 'customer',
        trade_name: 'Invalid GSTIN Party',
        phone: '9840098400',
        gstin: 'INVALID_GSTIN_123',
        state_code: '33',
        state_name: 'Tamil Nadu',
        billing_address: 'Chennai',
      }),
    });
    assert.equal(res.status, 400);
  });

  await t.test('18. Parties: POST /api/v1/parties returns 400 Bad Request on GSTIN state code mismatch', async () => {
    const res = await fetch(`${baseUrl}/api/v1/parties`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        party_type: 'customer',
        trade_name: 'State Mismatch Party',
        phone: '9840098400',
        gstin: '33AAAAA1234A1Z5', // Tamil Nadu (33)
        state_code: '29',          // Specified Karnataka (29) -> Mismatch!
        state_name: 'Karnataka',
        billing_address: 'Bangalore',
      }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.errors?.some((e) => e.message.includes('state code')));
  });

  await t.test('19. Parties: POST /api/v1/parties returns 409 Conflict on duplicate GSTIN', async () => {
    const res = await fetch(`${baseUrl}/api/v1/parties`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        party_type: 'customer',
        trade_name: 'Duplicate GSTIN Store',
        phone: '9840098400',
        gstin: '33AAAAA1234A1Z5', // already registered to Anand Sweets
        state_code: '33',
        state_name: 'Tamil Nadu',
        billing_address: 'Madurai',
      }),
    });
    assert.equal(res.status, 409);
  });

  await t.test('20. Parties: PATCH /api/v1/parties/:id updates party and toggles status', async () => {
    const updateRes = await fetch(`${baseUrl}/api/v1/parties/${createdPartyId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        credit_limit: 600000.0,
      }),
    });
    assert.equal(updateRes.status, 200);

    const statusRes = await fetch(`${baseUrl}/api/v1/parties/${createdPartyId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({ is_active: false }),
    });
    assert.equal(statusRes.status, 200);
    const statusBody = await statusRes.json();
    assert.equal(statusBody.data.party.is_active, false);
  });

  await t.test('21. Parties: POST /api/v1/parties returns 403 Forbidden for salesman role', async () => {
    const res = await fetch(`${baseUrl}/api/v1/parties`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${salesmanToken}`,
      },
      body: JSON.stringify({
        party_type: 'customer',
        trade_name: 'Unauthorized Create',
        phone: '9840098400',
        state_code: '33',
        state_name: 'Tamil Nadu',
        billing_address: 'Chennai',
      }),
    });
    assert.equal(res.status, 403);
  });
});
