/**
 * E2E — Redirect CRUD, catch-all public router, and access control.
 *
 * Requires:
 *   - Server running on E2E_BASE_URL (default http://localhost:3000)
 *   - GCP Application Default Credentials (`gcloud auth application-default login`)
 *   - .env with JWT_SECRET
 *
 * Run: npm run test:e2e -- --testPathPattern="redirects\.e2e"
 */
'use strict';

const http = require('http');
const { request, BASE_URL } = require('./helpers/client');
const { adminToken, userToken } = require('./helpers/auth');
const { createAdmin } = require('./helpers/seed');
const { cleanAll } = require('./helpers/teardown');

// Stored API responses from beforeAll — first two tests verify these.
let adminRedirectRes, userRedirectRes;
// IDs used by later tests.
let adminRedirectId, userRedirectId, regularUserId, regularUserToken;

/**
 * Makes a raw HTTP GET without following redirects.
 * Avoids fetch's opaque-redirect filtering (status 0) that hides the actual
 * 302 status code and Location header from callers.
 * @param {string} path
 * @returns {Promise<{ status: number, location: string|undefined }>}
 */
function rawGet(path) {
  return new Promise((resolve, reject) => {
    http.get(`${BASE_URL}${path}`, (res) => {
      resolve({ status: res.statusCode, location: res.headers.location });
      res.resume(); // drain the body so the socket is released
    }).on('error', reject);
  });
}

beforeAll(async () => {
  await createAdmin();

  // Create the shared group used by the regular-user redirect tests.
  await request('POST', '/api/v1/groups', {
    body: { name: 'E2E Redirect Group', slug: 'e2e-group' },
    token: adminToken(),
  });

  // Create the regular user and assign them to e2e-group.
  const userRes = await request('POST', '/api/v1/users', {
    body: {
      email: 'e2e-redir-user@e2e.test',
      firstName: 'E2E',
      lastName: 'RedirUser',
      role: 'user',
      groups: ['e2e-group'],
    },
    token: adminToken(),
  });
  regularUserId = userRes.data.data.id;
  regularUserToken = userToken(regularUserId, ['e2e-group']);

  // Admin redirect: root-level path (no group)
  // path sent WITHOUT leading slash; handler stores it as /e2e-root/test
  adminRedirectRes = await request('POST', '/api/v1/redirects', {
    body: { path: 'e2e-root/test', url: 'https://example.com' },
    token: adminToken(),
  });
  adminRedirectId = adminRedirectRes.data?.data?.id;

  // Regular-user redirect: under their group slug
  userRedirectRes = await request('POST', '/api/v1/redirects', {
    body: { path: 'test', url: 'https://example.org', group: 'e2e-group' },
    token: regularUserToken,
  });
  userRedirectId = userRedirectRes.data?.data?.id;
}, 30000);

afterAll(async () => {
  await cleanAll();
}, 30000);

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

test('admin creates root-level redirect → 201', () => {
  expect(adminRedirectRes.status).toBe(201);
  expect(adminRedirectRes.data.data.path).toBe('/e2e-root/test');
  expect(adminRedirectRes.data.data.url).toBe('https://example.com');
});

test('regular user creates redirect under their group → 201', () => {
  expect(userRedirectRes.status).toBe(201);
  expect(userRedirectRes.data.data.path).toBe('/e2e-group/test');
  expect(userRedirectRes.data.data.url).toBe('https://example.org');
});

test('regular user cannot create redirect outside their group → 403', async () => {
  const res = await request('POST', '/api/v1/redirects', {
    body: { path: 'forbidden', url: 'https://example.net', group: 'other-group' },
    token: regularUserToken,
  });
  expect(res.status).toBe(403);
});

// ---------------------------------------------------------------------------
// Public catch-all router
// ---------------------------------------------------------------------------

test('catch-all resolves redirect → 302 with correct Location', async () => {
  const { status, location } = await rawGet('/e2e-root/test');
  expect(status).toBe(302);
  expect(location).toBe('https://example.com');
});

test('catch-all returns 404 for nonexistent path', async () => {
  // /e2e-noexiste-xxx does not match bot-reject patterns, so it reaches Firestore.
  const { status } = await rawGet('/e2e-noexiste-xxx');
  expect(status).toBe(404);
});

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

test('admin GET /redirects sees all redirects', async () => {
  const res = await request('GET', '/api/v1/redirects', { token: adminToken() });
  expect(res.status).toBe(200);
  const ids = res.data.data.map((r) => r.id);
  expect(ids).toContain(adminRedirectId);
  expect(ids).toContain(userRedirectId);
});

test('regular user GET /redirects sees only their own and group redirects', async () => {
  const res = await request('GET', '/api/v1/redirects', { token: regularUserToken });
  expect(res.status).toBe(200);
  const ids = res.data.data.map((r) => r.id);
  // The user is the owner of userRedirectId.
  expect(ids).toContain(userRedirectId);
  // The user should NOT see the admin's redirect (different owner, no permission).
  expect(ids).not.toContain(adminRedirectId);
});

// ---------------------------------------------------------------------------
// Get by ID
// ---------------------------------------------------------------------------

test('GET /redirects/:id for own redirect → 200', async () => {
  const res = await request('GET', `/api/v1/redirects/${userRedirectId}`, {
    token: regularUserToken,
  });
  expect(res.status).toBe(200);
  expect(res.data.data.id).toBe(userRedirectId);
});

test("GET /redirects/:id for another user's redirect without permission → 403", async () => {
  // adminRedirectId has no permission entries, so regular user cannot read it.
  const res = await request('GET', `/api/v1/redirects/${adminRedirectId}`, {
    token: regularUserToken,
  });
  expect(res.status).toBe(403);
});

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

test('PATCH /redirects/:id for own redirect → 200 with updated url', async () => {
  const res = await request('PATCH', `/api/v1/redirects/${userRedirectId}`, {
    body: { url: 'https://example.org/updated' },
    token: regularUserToken,
  });
  expect(res.status).toBe(200);
  expect(res.data.data.url).toBe('https://example.org/updated');
});

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

test('DELETE /redirects/:id for own redirect → 200', async () => {
  const res = await request('DELETE', `/api/v1/redirects/${userRedirectId}`, {
    token: regularUserToken,
  });
  expect(res.status).toBe(200);
  // Subsequent GET from admin should return 404.
  const check = await request('GET', `/api/v1/redirects/${userRedirectId}`, {
    token: adminToken(),
  });
  expect(check.status).toBe(404);
});
