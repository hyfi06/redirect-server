/**
 * E2E — Group CRUD, membership sync, soft-delete, and access control.
 *
 * Requires:
 *   - Server running on E2E_BASE_URL (default http://localhost:3000)
 *   - GCP Application Default Credentials
 *   - .env with JWT_SECRET
 *
 * Run: npm run test:e2e -- --testPathPattern="groups\.e2e"
 */
'use strict';

const { request } = require('./helpers/client');
const { adminToken, userToken } = require('./helpers/auth');
const { createAdmin } = require('./helpers/seed');
const { cleanAll } = require('./helpers/teardown');

// Populated by sequential tests.
let groupId, groupUserId, regularUserToken;

beforeAll(async () => {
  await createAdmin();
}, 30000);

afterAll(async () => {
  await cleanAll();
}, 30000);

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

test('admin creates group → 201 with correct slug', async () => {
  const res = await request('POST', '/api/v1/groups', {
    body: { name: 'E2E Groups Test', slug: 'e2e-grp-test' },
    token: adminToken(),
  });
  expect(res.status).toBe(201);
  expect(res.data.data).toHaveProperty('id');
  expect(res.data.data.slug).toBe('e2e-grp-test');
  groupId = res.data.data.id;
});

// ---------------------------------------------------------------------------
// Membership sync
// ---------------------------------------------------------------------------

test('admin adds user to group via PATCH → 200; User.groups updated', async () => {
  // Create the user who will be added to the group.
  const userRes = await request('POST', '/api/v1/users', {
    body: {
      email: 'e2e-grp-member@e2e.example.com',
      firstName: 'E2E',
      lastName: 'GrpMember',
      role: 'user',
      groups: [],
    },
    token: adminToken(),
  });
  expect(userRes.status).toBe(201);
  groupUserId = userRes.data.data.id;
  regularUserToken = userToken(groupUserId, []);

  // PATCH the group with the new member.
  const patchRes = await request('PATCH', `/api/v1/groups/${groupId}`, {
    body: { users: [groupUserId] },
    token: adminToken(),
  });
  expect(patchRes.status).toBe(200);
  // GroupService.update syncs the user document in the same WriteBatch.
  expect(patchRes.data.data.users).toContain(groupUserId);

  // Verify User.groups was updated (GET /users/:id is admin-only).
  const userGet = await request('GET', `/api/v1/users/${groupUserId}`, {
    token: adminToken(),
  });
  expect(userGet.status).toBe(200);
  expect(userGet.data.data.groups).toContain('e2e-grp-test');
});

// ---------------------------------------------------------------------------
// Soft-delete and inactive query
// ---------------------------------------------------------------------------

test('admin soft-deletes group → 200', async () => {
  const res = await request('DELETE', `/api/v1/groups/${groupId}`, {
    token: adminToken(),
  });
  expect(res.status).toBe(200);
});

test('GET /groups without ?inactive does not include soft-deleted group', async () => {
  const res = await request('GET', '/api/v1/groups', { token: adminToken() });
  expect(res.status).toBe(200);
  const ids = res.data.data.map((g) => g.id);
  expect(ids).not.toContain(groupId);
});

test('GET /groups?inactive=true includes soft-deleted group (admin only)', async () => {
  const res = await request('GET', '/api/v1/groups?inactive=true', { token: adminToken() });
  expect(res.status).toBe(200);
  const ids = res.data.data.map((g) => g.id);
  expect(ids).toContain(groupId);
});

// ---------------------------------------------------------------------------
// Access control
// ---------------------------------------------------------------------------

test('non-admin user cannot create group → 403', async () => {
  const res = await request('POST', '/api/v1/groups', {
    body: { name: 'Unauthorized Group', slug: 'e2e-unauth-grp' },
    token: regularUserToken,
  });
  expect(res.status).toBe(403);
});
