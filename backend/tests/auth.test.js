import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import app from '../src/app.js';
import { env } from '../src/config/env.js';
import { authRepository } from '../src/modules/auth/auth.repository.js';
import { loginRateLimiter } from '../src/middleware/rateLimiter.middleware.js';
import { ROLES } from '../src/modules/auth/auth.constants.js';

test('Order-to-Audit Backend Phase 2: Isolated Authentication & RBAC Tests', async (t) => {
  let server;
  let baseUrl;

  // Save original repository methods for safe restoration
  const originalRepo = {
    findByUsername: authRepository.findByUsername,
    findById: authRepository.findById,
    findWithHashById: authRepository.findWithHashById,
    updatePasswordHash: authRepository.updatePasswordHash,
    setActiveStatus: authRepository.setActiveStatus,
  };

  // Test passwords meeting the >= 12 character requirement
  const OWNER_PASS = 'Owner@SecurePass2026!';
  const SALESMAN_PASS = 'Salesman@SecurePass2026!';
  const INACTIVE_PASS = 'Inactive@SecurePass2026!';
  const OWNER_NEW_PASS = 'Owner@BrandNewSecure2026!';

  // In-memory isolated mock users (NEVER touches PostgreSQL benchmark users)
  let mockUsers = new Map();

  t.before(async () => {
    // 1. Prepare bcrypt hashes for mock users
    const ownerHash = await bcrypt.hash(OWNER_PASS, 10);
    const salesmanHash = await bcrypt.hash(SALESMAN_PASS, 10);
    const inactiveHash = await bcrypt.hash(INACTIVE_PASS, 10);

    const testOwner = {
      id: 'a0000000-0000-0000-0000-000000000001',
      username: 'test_owner',
      password_hash: ownerHash,
      full_name: 'Test Owner Mock',
      phone: '9876543210',
      role: ROLES.OWNER,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const testSalesman = {
      id: 'a0000000-0000-0000-0000-000000000002',
      username: 'test_salesman',
      password_hash: salesmanHash,
      full_name: 'Test Salesman Mock',
      phone: '9876543211',
      role: ROLES.SALESMAN,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const testInactive = {
      id: 'a0000000-0000-0000-0000-000000000003',
      username: 'test_inactive',
      password_hash: inactiveHash,
      full_name: 'Test Inactive Mock',
      phone: '9876543212',
      role: ROLES.SALESMAN,
      is_active: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const testArgon2 = {
      id: 'a0000000-0000-0000-0000-000000000004',
      username: 'test_argon2',
      password_hash: '$argon2id$v=19$m=65536,t=3,p=4$dummyhash',
      full_name: 'Test Argon2 Dummy Mock',
      phone: '9876543213',
      role: ROLES.PRODUCTION_SUPERVISOR,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    mockUsers.set('test_owner', testOwner);
    mockUsers.set('test_salesman', testSalesman);
    mockUsers.set('test_inactive', testInactive);
    mockUsers.set('test_argon2', testArgon2);

    // 2. Wire mocked repository methods
    authRepository.findByUsername = async (username) => {
      const user = mockUsers.get(username);
      return user ? { ...user } : null;
    };

    authRepository.findById = async (id) => {
      for (const u of mockUsers.values()) {
        if (u.id === id) {
          const sanitized = { ...u };
          delete sanitized.password_hash;
          return sanitized;
        }
      }
      return null;
    };

    authRepository.findWithHashById = async (id) => {
      for (const u of mockUsers.values()) {
        if (u.id === id) {
          return { ...u };
        }
      }
      return null;
    };

    authRepository.updatePasswordHash = async (userId, newHash) => {
      for (const [key, u] of mockUsers.entries()) {
        if (u.id === userId) {
          u.password_hash = newHash;
          u.updated_at = new Date().toISOString();
          mockUsers.set(key, u);
          return {
            id: u.id,
            username: u.username,
            full_name: u.full_name,
            role: u.role,
            is_active: u.is_active,
            updated_at: u.updated_at,
          };
        }
      }
      return null;
    };

    authRepository.setActiveStatus = async (userId, isActive) => {
      for (const [key, u] of mockUsers.entries()) {
        if (u.id === userId) {
          u.is_active = isActive;
          u.updated_at = new Date().toISOString();
          mockUsers.set(key, u);
          return { id: u.id, username: u.username, is_active: u.is_active };
        }
      }
      return null;
    };

    // 3. Reset rate limiter state
    loginRateLimiter.reset();

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
    // Restore original repository methods
    authRepository.findByUsername = originalRepo.findByUsername;
    authRepository.findById = originalRepo.findById;
    authRepository.findWithHashById = originalRepo.findWithHashById;
    authRepository.updatePasswordHash = originalRepo.updatePasswordHash;
    authRepository.setActiveStatus = originalRepo.setActiveStatus;

    loginRateLimiter.reset();

    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  // ==========================================================================
  // 1. ISOLATED LOGIN TESTS
  // ==========================================================================

  let ownerToken;
  let salesmanToken;

  await t.test('1. POST /api/v1/auth/login: Successful login returns 200, JWT token and sanitized user', async () => {
    loginRateLimiter.reset();

    const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'test_owner',
        password: OWNER_PASS,
      }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.message, 'Login successful');
    assert.ok(body.data.token, 'Must return JWT token');
    assert.equal(body.data.user.username, 'test_owner');
    assert.equal(body.data.user.role, 'owner');
    assert.equal(body.data.user.password_hash, undefined, 'Must NEVER return password_hash');

    ownerToken = body.data.token;

    // Verify token claims and signature with HS256
    const decoded = jwt.verify(ownerToken, env.jwt.secret, { algorithms: ['HS256'] });
    assert.equal(decoded.sub, 'a0000000-0000-0000-0000-000000000001');
    assert.equal(decoded.username, 'test_owner');
    assert.equal(decoded.role, 'owner');
  });

  await t.test('2. POST /api/v1/auth/login: Successful login for salesman user', async () => {
    loginRateLimiter.reset();

    const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'test_salesman',
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
    loginRateLimiter.reset();

    const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'test_owner',
        password: 'WrongPassword123!',
      }),
    });

    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.message, 'Invalid username or password');
  });

  await t.test('4. POST /api/v1/auth/login: Fails with 401 for non-existent user', async () => {
    loginRateLimiter.reset();

    const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'non_existent_mock_user',
        password: 'AnyPassword123!',
      }),
    });

    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.message, 'Invalid username or password');
  });

  await t.test('5. POST /api/v1/auth/login: Gracefully handles legacy Argon2 dummy hash without crashing', async () => {
    loginRateLimiter.reset();

    const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'test_argon2',
        password: 'AnyPasswordAttempt!',
      }),
    });

    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.message, 'Invalid username or password');
  });

  await t.test('6. POST /api/v1/auth/login: Fails with 401 when account is inactive', async () => {
    loginRateLimiter.reset();

    const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'test_inactive',
        password: INACTIVE_PASS,
      }),
    });

    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.ok(body.message.includes('inactive'));
  });

  // ==========================================================================
  // 2. RATE LIMITING TESTS
  // ==========================================================================

  await t.test('7. Login Rate Limiter: Returns HTTP 429 after 5 repeated login attempts', async () => {
    loginRateLimiter.reset();

    // Issue 5 attempts (allowed limit)
    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'test_owner',
          password: 'IncorrectPasswordAttempt',
        }),
      });
      assert.equal(res.status, 401);
    }

    // 6th attempt must be rejected by rate limiter
    const blockedRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'test_owner',
        password: 'IncorrectPasswordAttempt',
      }),
    });

    assert.equal(blockedRes.status, 429);
    const blockedBody = await blockedRes.json();
    assert.equal(blockedBody.success, false);
    assert.equal(blockedBody.statusCode, 429);
    assert.ok(blockedRes.headers.get('Retry-After'), 'Must include Retry-After header');
    assert.ok(blockedBody.message.includes('Too many login attempts'));

    // Reset rate limiter for remaining tests
    loginRateLimiter.reset();
  });

  // ==========================================================================
  // 3. JWT VERIFICATION & PROTECTED /me TESTS
  // ==========================================================================

  await t.test('8. GET /api/v1/auth/me: Returns current user profile with valid JWT', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: {
        Authorization: `Bearer ${ownerToken}`,
      },
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.user.id, 'a0000000-0000-0000-0000-000000000001');
    assert.equal(body.data.user.username, 'test_owner');
    assert.equal(body.data.user.role, 'owner');
    assert.equal(body.data.user.password_hash, undefined);
  });

  await t.test('9. GET /api/v1/auth/me: Fails with 401 when Authorization header is missing', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/me`);

    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.message, 'Authentication token is required');
  });

  await t.test('10. GET /api/v1/auth/me: Fails with 401 on malformed or invalid token', async () => {
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

  await t.test('11. GET /api/v1/auth/me: Fails with 401 on expired JWT', async () => {
    const expiredToken = jwt.sign(
      { sub: 'a0000000-0000-0000-0000-000000000001', username: 'test_owner', role: 'owner' },
      env.jwt.secret,
      { algorithm: 'HS256', expiresIn: '-10s' }
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

  await t.test('12. Live DB Status Check: Valid JWT rejected if account was deactivated after token issuance', async () => {
    const validSalesmanToken = jwt.sign(
      { sub: 'a0000000-0000-0000-0000-000000000002', username: 'test_salesman', role: 'salesman' },
      env.jwt.secret,
      { algorithm: 'HS256', expiresIn: '1h' }
    );

    // Deactivate mock user in repository
    await authRepository.setActiveStatus('a0000000-0000-0000-0000-000000000002', false);

    const res = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: {
        Authorization: `Bearer ${validSalesmanToken}`,
      },
    });

    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.ok(body.message.includes('deactivated'));

    // Restore mock user
    await authRepository.setActiveStatus('a0000000-0000-0000-0000-000000000002', true);
  });

  // ==========================================================================
  // 4. PASSWORD CHANGE & VALIDATION TESTS
  // ==========================================================================

  await t.test('13. POST /api/v1/auth/change-password: Fails with 400 when current password is wrong', async () => {
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

  await t.test('14. POST /api/v1/auth/change-password: Fails with 400 when new password is under 12 characters', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        currentPassword: OWNER_PASS,
        newPassword: 'Short12345!', // 11 characters (< 12)
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.ok(body.errors?.some((e) => e.message.includes('12 characters')));
  });

  await t.test('15. POST /api/v1/auth/change-password: Fails with 400 when password exceeds bcrypt 72-byte limit', async () => {
    const overlyLongPassword = 'A'.repeat(75); // 75 bytes (> 72)

    const res = await fetch(`${baseUrl}/api/v1/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        currentPassword: OWNER_PASS,
        newPassword: overlyLongPassword,
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.success, false);
  });

  await t.test('16. POST /api/v1/auth/change-password: Succeeds with valid credentials and enables login with new password', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        currentPassword: OWNER_PASS,
        newPassword: OWNER_NEW_PASS,
      }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.message, 'Password updated successfully');

    loginRateLimiter.reset();

    // Verify subsequent login with new password succeeds
    const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'test_owner',
        password: OWNER_NEW_PASS,
      }),
    });

    assert.equal(loginRes.status, 200);
    const loginBody = await loginRes.json();
    assert.equal(loginBody.success, true);
    assert.ok(loginBody.data.token);

    // Verify old password now fails
    const oldLoginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'test_owner',
        password: OWNER_PASS,
      }),
    });
    assert.equal(oldLoginRes.status, 401);
  });

  // ==========================================================================
  // 5. HTTP-LEVEL RBAC AUTHORIZATION TESTS (403 VERIFICATION)
  // ==========================================================================

  await t.test('17. HTTP-level RBAC: Disallowed role receives HTTP 403 Forbidden', async () => {
    // /api/v1/auth/test-role-protected requires owner or factory_admin role
    // Request with salesmanToken (role: 'salesman')
    const res = await fetch(`${baseUrl}/api/v1/auth/test-role-protected`, {
      headers: {
        Authorization: `Bearer ${salesmanToken}`,
      },
    });

    assert.equal(res.status, 403, 'Disallowed role must receive HTTP 403 Forbidden');
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.statusCode, 403);
    assert.equal(body.message, 'You do not have permission to access this resource');
  });

  await t.test('18. HTTP-level RBAC: Allowed role receives HTTP 200 OK', async () => {
    // Request with ownerToken (role: 'owner')
    const res = await fetch(`${baseUrl}/api/v1/auth/test-role-protected`, {
      headers: {
        Authorization: `Bearer ${ownerToken}`,
      },
    });

    assert.equal(res.status, 200, 'Allowed role must receive HTTP 200 OK');
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.message, 'Authorized role access granted');
    assert.equal(body.user.role, 'owner');
  });

  await t.test('19. HTTP-level RBAC: Unauthenticated request receives HTTP 401 Unauthorized', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/test-role-protected`);

    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.statusCode, 401);
  });

  // ==========================================================================
  // 6. ROLE CONSTANTS INTEGRITY
  // ==========================================================================

  await t.test('20. Role Constants: Exactly matches the 5 database roles', () => {
    assert.deepEqual(Object.values(ROLES).sort(), [
      'auditor',
      'factory_admin',
      'owner',
      'production_supervisor',
      'salesman',
    ]);
  });
});
