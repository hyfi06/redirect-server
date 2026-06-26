/**
 * E2E — API Key lifecycle: create, authenticate, scope enforcement, revoke.
 *
 * Requires:
 *   - Server running on E2E_BASE_URL (default http://localhost:3000)
 *   - GCP Application Default Credentials
 *   - .env with JWT_SECRET
 *
 * Run: npm run test:e2e -- --testPathPattern="api-keys\.e2e"
 *
 * Note on revocation test: the server calls nodeCache.del(keyHash) on revoke
 * (best-effort same-instance invalidation). The 31-second wait after revocation
 * ensures the 30-second cache TTL has expired even if invalidation failed — e.g.
 * in a multi-instance deployment where the revoke hit a different instance than
 * the auth check.
 */
'use strict';

const { request } = require('./helpers/client');
const { adminToken, userToken } = require('./helpers/auth');
const { createAdmin } = require('./helpers/seed');
const { cleanAll } = require('./helpers/teardown');

// Populated by the sequential test run.
let regularUserId, regularUserToken;
let apiKeyId, apiKeyToken;

beforeAll(async () => {
  await createAdmin();

  // Create a regular user to own the API key.
  const userRes = await request('POST', '/api/v1/users', {
    body: {
      email: 'e2e-apikey-user@e2e.test',
      firstName: 'E2E',
      lastName: 'ApiKeyUser',
      role: 'user',
      groups: [],
    },
    token: adminToken(),
  });
  regularUserId = userRes.data.data.id;
  regularUserToken = userToken(regularUserId, []);
}, 30000);

afterAll(async () => {
  await cleanAll();
}, 30000);

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

test('user creates API key with scope read:redirects → 201, token present once', async () => {
  const res = await request('POST', '/api/v1/users/me/api-keys', {
    body: { name: 'E2E Test Key', scopes: ['read:redirects'] },
    token: regularUserToken,
  });
  expect(res.status).toBe(201);
  expect(res.data.data).toHaveProperty('id');
  // The plaintext token is returned only on creation; it is never stored.
  expect(res.data.data.token).toMatch(/^sk_1kg_/);
  // Sensitive hash must NOT be exposed.
  expect(res.data.data).not.toHaveProperty('keyHash');

  apiKeyId = res.data.data.id;
  apiKeyToken = res.data.data.token;
});

// ---------------------------------------------------------------------------
// Authenticate
// ---------------------------------------------------------------------------

test('API key authenticates GET /redirects → 200', async () => {
  const res = await request('GET', '/api/v1/redirects', { token: apiKeyToken });
  expect(res.status).toBe(200);
});

// ---------------------------------------------------------------------------
// Scope enforcement
// ---------------------------------------------------------------------------

test('API key with read:redirects scope cannot POST /redirects → 403', async () => {
  const res = await request('POST', '/api/v1/redirects', {
    body: { path: 'e2e-scope-test', url: 'https://example.com' },
    token: apiKeyToken,
  });
  // write:redirects is required for POST; this key only has read:redirects.
  expect(res.status).toBe(403);
});

// ---------------------------------------------------------------------------
// Revoke
// ---------------------------------------------------------------------------

test('user revokes API key → 200', async () => {
  const res = await request('DELETE', `/api/v1/users/me/api-keys/${apiKeyId}`, {
    token: regularUserToken,
  });
  expect(res.status).toBe(200);
  expect(res.data.data.id).toBe(apiKeyId);
});

test(
  'revoked API key is rejected after cache TTL expires → 401',
  async () => {
    // Wait 31 seconds to guarantee the 30-second node-cache TTL has elapsed.
    // The DELETE handler also calls nodeCache.del(keyHash) for same-instance
    // invalidation, so in practice the key may be rejected immediately — but
    // the sleep provides a safety net for multi-instance or caching edge cases.
    await new Promise((resolve) => setTimeout(resolve, 31000));
    const res = await request('GET', '/api/v1/redirects', { token: apiKeyToken });
    expect(res.status).toBe(401);
  },
  40000, // Per-test timeout: 31s wait + headroom
);
