import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import app from '../src/app.js';
import { query, testConnection, closePool } from '../src/config/db.js';
import { env } from '../src/config/env.js';
import { authRepository } from '../src/modules/auth/auth.repository.js';
import { authenticate } from '../src/middleware/auth.middleware.js';
import { authorizeRoles } from '../src/middleware/role.middleware.js';
import { ROLES } from '../src/modules/auth/auth.constants.js';

test('Order-to-Audit Backend Phase 2: Authentication & RBAC Tests', async (t) => {
  let server;
  let baseUrl;
  let ownerUser;
  let salesmanUser;
  let supervisorUser;

  const OWNER_INITIAL_PASS = 'Owner@Test2026';
  const SALESMAN_PASS = 'Salesman@Test2026';

  t.before(async () => {
    // 1. Ensure database connection is active
    const dbInfo = await testConnection();
    assert.equal(dbInfo.connected, true, 'Database must be reachable');

    // 2. Fetch seeded users
    ownerUser = await authRepository.findByUsername('owner_main');
    salesmanUser = await authRepository.findByUsername('salesman_a');
    supervisorUser = await authRepository.findByUsername('supervisor_floor');

    assert.ok(ownerUser, 'owner_main seeded user must exist');
    assert.ok(salesmanUser, 'salesman_a seeded user must exist');
    assert.ok(supervisorUser, 'supervisor_floor seeded user must exist');

    // 3. Set known bcrypt passwords for owner and salesman test users
    const ownerHash = await bcrypt.hash(OWNER_INITIAL_PASS, env.bcrypt.saltRounds);
    const salesmanHash = await bcrypt.hash(SALESMAN_PASS, env.bcrypt.saltRounds);

    await authRepository.updatePasswordHash(ownerUser.id, ownerHash);
    await authRepository.updatePasswordHash(salesmanUser.id, salesmanHash);
    await authRepository.setActiveStatus(ownerUser.id, true);
    await authRepository.setActiveStatus(salesmanUser.id, true);

    // 4. Start ephemeral test server
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://localhost:${port}`;
        resolve();
      });
    });
  });

  t.after(async () => {
    // Restore users to active status if modified
    if (ownerUser) {
      await authRepository.setActiveStatus(ownerUser.id, true);
    }
    if (salesmanUser) {
      await authRepository.setActiveStatus(salesmanUser.id, true);
    }

    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await closePool();
  });

  // ==========================================================================
  // 1. LOGIN TESTS
  // ==========================================================================

  let ownerToken;
  let salesmanToken;

  await t.test('1. POST /api/v1/auth/login: Successful login returns 200, JWT and sanitized user', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'owner_main',
        password: OWNER_INITIAL_PASS,
      }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.message, 'Login successful');
    assert.ok(body.data.token, 'Must return JWT token');
    assert.equal(body.data.user.username, 'owner_main');
    assert.equal(body.data.user.role, 'owner');
    assert.equal(body.data.user.password_hash, undefined, 'Must NEVER return password_hash');

    ownerToken = body.data.token;

    // Verify token structure
    const decoded = jwt.decode(ownerToken);
    assert.equal(decoded.sub, ownerUser.id);
    assert.equal(decoded.username, 'owner_main');
    assert.equal(decoded.role, 'owner');
  });

  await t.test('2. POST /api/v1/auth/login: Successful login for salesman user', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'salesman_a',
        password: SALESMAN_PASS,
      }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.user.role, 'salesman');
    salesmanToken = body.data.token;
  });

  await t.test('3. POST /api/v1/auth/login: Fails with 401 for incorrect password', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'owner_main',
        password: 'IncorrectPassword123!',
      }),
    });

    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.message, 'Invalid username or password');
  });

  await t.test('4. POST /api/v1/auth/login: Fails with 401 for non-existent user', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'non_existent_user_999',
        password: 'SomePassword123!',
      }),
    });

    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.message, 'Invalid username or password');
  });

  await t.test('5. POST /api/v1/auth/login: Gracefully handles legacy Argon2 dummy hash without crashing', async () => {
    // supervisor_floor has seeded dummy Argon2 placeholder hash
    const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'supervisor_floor',
        password: 'AnyPasswordAttempt!',
      }),
    });

    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.message, 'Invalid username or password');
  });

  await t.test('6. POST /api/v1/auth/login: Fails with 401 when account is deactivated', async () => {
    // Temporarily deactivate salesman_a
    await authRepository.setActiveStatus(salesmanUser.id, false);

    const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'salesman_a',
        password: SALESMAN_PASS,
      }),
    });

    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.ok(body.message.includes('inactive'));

    // Reactivate salesman_a
    await authRepository.setActiveStatus(salesmanUser.id, true);
  });

  // ==========================================================================
  // 2. PROTECTED ENDPOINT /me & JWT VERIFICATION TESTS
  // ==========================================================================

  await t.test('7. GET /api/v1/auth/me: Returns current user profile with valid JWT', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: {
        Authorization: `Bearer ${ownerToken}`,
      },
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.user.id, ownerUser.id);
    assert.equal(body.data.user.username, 'owner_main');
    assert.equal(body.data.user.role, 'owner');
    assert.equal(body.data.user.password_hash, undefined);
  });

  await t.test('8. GET /api/v1/auth/me: Fails with 401 when Authorization header is missing', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/me`);

    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.message, 'Authentication token is required');
  });

  await t.test('9. GET /api/v1/auth/me: Fails with 401 on malformed or invalid token', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: {
        Authorization: 'Bearer invalid.token.payload',
      },
    });

    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.message, 'Invalid authentication token');
  });

  await t.test('10. GET /api/v1/auth/me: Fails with 401 on expired JWT', async () => {
    const expiredToken = jwt.sign(
      { sub: ownerUser.id, username: 'owner_main', role: 'owner' },
      env.jwt.secret,
      { expiresIn: '-10s' } // Expired 10 seconds ago
    );

    const res = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: {
        Authorization: `Bearer ${expiredToken}`,
      },
    });

    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.message, 'Token has expired');
  });

  await t.test('11. Live DB Status Check: Valid JWT rejected if account was deactivated after token issuance', async () => {
    // Generate fresh valid token for salesman_a
    const validSalesmanToken = jwt.sign(
      { sub: salesmanUser.id, username: 'salesman_a', role: 'salesman' },
      env.jwt.secret,
      { expiresIn: '1h' }
    );

    // Deactivate salesman_a in PostgreSQL
    await authRepository.setActiveStatus(salesmanUser.id, false);

    const res = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: {
        Authorization: `Bearer ${validSalesmanToken}`,
      },
    });

    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.ok(body.message.includes('deactivated'));

    // Restore salesman_a
    await authRepository.setActiveStatus(salesmanUser.id, true);
  });

  // ==========================================================================
  // 3. CHANGE PASSWORD TESTS
  // ==========================================================================

  const OWNER_NEW_PASS = 'Owner@BrandNew2026';

  await t.test('12. POST /api/v1/auth/change-password: Fails with 400 when current password is wrong', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        currentPassword: 'WrongCurrentPassword!',
        newPassword: OWNER_NEW_PASS,
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.message, 'Current password is incorrect');
  });

  await t.test('13. POST /api/v1/auth/change-password: Fails with 400 on Zod validation if new password is too short', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        currentPassword: OWNER_INITIAL_PASS,
        newPassword: '123', // Less than 6 characters
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.success, false);
  });

  await t.test('14. POST /api/v1/auth/change-password: Succeeds with correct current password and allows subsequent login', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        currentPassword: OWNER_INITIAL_PASS,
        newPassword: OWNER_NEW_PASS,
      }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.message, 'Password updated successfully');

    // Verify login with new password succeeds
    const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'owner_main',
        password: OWNER_NEW_PASS,
      }),
    });

    assert.equal(loginRes.status, 200);
    const loginBody = await loginRes.json();
    assert.equal(loginBody.success, true);
    assert.ok(loginBody.data.token);

    // Old password should now fail
    const oldLoginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'owner_main',
        password: OWNER_INITIAL_PASS,
      }),
    });
    assert.equal(oldLoginRes.status, 401);
  });

  // ==========================================================================
  // 4. RBAC MIDDLEWARE TESTS
  // ==========================================================================

  await t.test('15. Role Authorization: authorizeRoles grants access for allowed roles and returns 403 for disallowed roles', () => {
    const allowedRoles = [ROLES.OWNER, ROLES.FACTORY_ADMIN];
    const middleware = authorizeRoles(...allowedRoles);

    // Case A: User has allowed role 'owner'
    let nextCalledA = false;
    let errorA = null;
    const reqA = { user: { role: 'owner' } };
    middleware(reqA, {}, (err) => {
      nextCalledA = true;
      errorA = err;
    });
    assert.equal(nextCalledA, true);
    assert.equal(errorA, undefined);

    // Case B: User has disallowed role 'salesman'
    let nextCalledB = false;
    let errorB = null;
    const reqB = { user: { role: 'salesman' } };
    middleware(reqB, {}, (err) => {
      nextCalledB = true;
      errorB = err;
    });
    assert.equal(nextCalledB, true);
    assert.ok(errorB);
    assert.equal(errorB.statusCode, 403);
    assert.equal(errorB.message, 'You do not have permission to access this resource');

    // Case C: Unauthenticated request (req.user missing)
    let errorC = null;
    const reqC = {};
    middleware(reqC, {}, (err) => {
      errorC = err;
    });
    assert.ok(errorC);
    assert.equal(errorC.statusCode, 401);
  });

  await t.test('16. Role Constants: Exactly matches the 5 database roles', () => {
    assert.deepEqual(Object.values(ROLES).sort(), [
      'auditor',
      'factory_admin',
      'owner',
      'production_supervisor',
      'salesman',
    ]);
  });
});
