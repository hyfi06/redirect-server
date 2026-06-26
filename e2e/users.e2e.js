/**
 * E2E — User CRUD, /me endpoint, and access control.
 *
 * Requires:
 *   - Server running on E2E_BASE_URL (default http://localhost:3000)
 *   - GCP Application Default Credentials
 *   - .env with JWT_SECRET
 *
 * Run: npm run test:e2e -- --testPathPattern="users\.e2e"
 */
'use strict';

const { request } = require('./helpers/client');
const { adminToken, userToken } = require('./helpers/auth');
const { createAdmin } = require('./helpers/seed');
const { cleanAll } = require('./helpers/teardown');

// Populated by the 'admin creates user' test; used by subsequent tests.
let createdUserId, createdUserToken;
// Stored API responses from beforeAll.
let listUsersRes;

beforeAll(async () => {
  await createAdmin();
  // Warm up: verify admin can list users before individual tests run.
  listUsersRes = await request('GET', '/api/v1/users', { token: adminToken() });
}, 30000);

afterAll(async () => {
  await cleanAll();
}, 30000);

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

test('admin creates user → 201 with public fields', async () => {
  const res = await request('POST', '/api/v1/users', {
    body: {
      email: 'e2e-users-new@e2e.example.com',
      firstName: 'E2E',
      lastName: 'UsersNew',
      role: 'user',
      groups: [],
    },
    token: adminToken(),
  });
  expect(res.status).toBe(201);
  expect(res.data.data).toHaveProperty('id');
  expect(res.data.data).toHaveProperty('email', 'e2e-users-new@e2e.example.com');
  // Auth tokens must never appear in the response (§3: moved to subcollection).
  expect(res.data.data).not.toHaveProperty('googleToken');
  expect(res.data.data).not.toHaveProperty('googleRefreshToken');
  expect(res.data.data).not.toHaveProperty('auth');

  createdUserId = res.data.data.id;
  createdUserToken = userToken(createdUserId, []);
});

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

test('admin lists users → 200, non-empty array', () => {
  expect(listUsersRes.status).toBe(200);
  expect(Array.isArray(listUsersRes.data.data)).toBe(true);
  expect(listUsersRes.data.data.length).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// /me
// ---------------------------------------------------------------------------

test('user GET /me → 200 with profile, no auth tokens exposed', async () => {
  // Use adminToken so this test does not depend on createdUserId being set.
  const res = await request('GET', '/api/v1/users/me', { token: adminToken() });
  expect(res.status).toBe(200);
  expect(res.data.data).toHaveProperty('id');
  expect(res.data.data).toHaveProperty('email');
  expect(res.data.data).toHaveProperty('role');
  expect(res.data.data).toHaveProperty('groups');
  // OAuth tokens must not appear — they live in the auth subcollection now.
  expect(res.data.data).not.toHaveProperty('googleToken');
  expect(res.data.data).not.toHaveProperty('googleRefreshToken');
  expect(res.data.data).not.toHaveProperty('auth');
});

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

test('user PATCH their own profile → 200 with updated field', async () => {
  // Depends on 'admin creates user' test having set createdUserId.
  const res = await request('PATCH', `/api/v1/users/${createdUserId}`, {
    body: { firstName: 'UpdatedName' },
    token: createdUserToken,
  });
  expect(res.status).toBe(200);
  expect(res.data.data.firstName).toBe('UpdatedName');
});

test("user PATCH another user's profile → 403", async () => {
  // createdUserToken belongs to createdUserId; 'e2e-admin-001' is a different user.
  const res = await request('PATCH', '/api/v1/users/e2e-admin-001', {
    body: { firstName: 'Hacked' },
    token: createdUserToken,
  });
  expect(res.status).toBe(403);
});

// ---------------------------------------------------------------------------
// Soft-delete
// ---------------------------------------------------------------------------

test('admin soft-deletes user → 200; user absent from active list; present in inactive list', async () => {
  const deleteRes = await request('DELETE', `/api/v1/users/${createdUserId}`, {
    token: adminToken(),
  });
  expect(deleteRes.status).toBe(200);

  // Active list must NOT include the soft-deleted user.
  const activeRes = await request('GET', '/api/v1/users', { token: adminToken() });
  expect(activeRes.status).toBe(200);
  const activeIds = activeRes.data.data.map((u) => u.id);
  expect(activeIds).not.toContain(createdUserId);

  // Inactive list MUST include the soft-deleted user.
  const inactiveRes = await request('GET', '/api/v1/users?inactive=true', {
    token: adminToken(),
  });
  expect(inactiveRes.status).toBe(200);
  const inactiveIds = inactiveRes.data.data.map((u) => u.id);
  expect(inactiveIds).toContain(createdUserId);
});
