import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app.js';
import { testConnection, closePool } from '../src/config/db.js';

test('Order-to-Audit Backend Phase 1 Tests', async (t) => {
  let server;
  let baseUrl;

  t.before(async () => {
    // Start server on an ephemeral port (0) for testing
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://localhost:${port}`;
        resolve();
      });
    });
  });

  t.after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await closePool();
  });

  await t.test('1. Database Connectivity: testConnection() successfully queries PostgreSQL', async () => {
    const dbInfo = await testConnection();
    assert.equal(dbInfo.connected, true);
    assert.ok(dbInfo.serverTime);
    assert.ok(dbInfo.pgVersion);
    assert.ok(typeof dbInfo.durationMs === 'number');
  });

  await t.test('2. Root Endpoint: GET / returns API information', async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, 'online');
    assert.ok(data.healthCheck);
  });

  await t.test('3. Health Endpoint: GET /api/v1/health returns HTTP 200 with DB status', async () => {
    const res = await fetch(`${baseUrl}/api/v1/health`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.status, 'healthy');
    assert.ok(data.timestamp);
    assert.equal(data.database.status, 'connected');
    assert.equal(data.database.name, 'order_to_audit');
    assert.ok(data.database.serverTime);
    assert.ok(typeof data.database.responseTimeMs === 'number');
  });

  await t.test('4. Health Alias Endpoint: GET /health returns HTTP 200', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.database.status, 'connected');
  });

  await t.test('5. Centralized 404 Handler: GET /api/v1/unknown returns structured 404', async () => {
    const res = await fetch(`${baseUrl}/api/v1/unknown-endpoint`);
    assert.equal(res.status, 404);
    const data = await res.json();
    assert.equal(data.success, false);
    assert.equal(data.statusCode, 404);
    assert.ok(data.message.includes('Route not found'));
  });

  await t.test('6. Health Endpoint Failure Mode: returns HTTP 503 when database is disconnected', async () => {
    const { checkHealth } = await import('../src/modules/health/health.controller.js');
    
    // Simulate disconnected state by closing pool
    await closePool();

    let statusCode;
    let jsonBody;
    const mockRes = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        jsonBody = data;
        return this;
      },
    };

    await checkHealth({}, mockRes);
    assert.equal(statusCode, 503);
    assert.equal(jsonBody.success, false);
    assert.equal(jsonBody.status, 'unhealthy');
    assert.equal(jsonBody.database.status, 'disconnected');
    assert.ok(jsonBody.database.error);
  });
});
