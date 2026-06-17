'use strict';

/**
 * Integration tests for src/api/users/routes/api-key.route.js
 *
 * The api-key sub-router is mounted inside userRouterApi at /me/api-keys,
 * so we test through the full user router to exercise the authenticate
 * middleware and the mount path together.
 *
 * Strategy:
 * - `authenticate` is mocked identically to user.route.api.test.js (x-test-user header).
 * - `ApiKeyService` is mocked — list, create, and revoke are jest.fn() on the prototype.
 * - `src/utils/cache` is mocked so nodeCache.del can be asserted.
 * - `UserService` is mocked (required because user.route.api.js instantiates it at load time).
 * - A single Express app is built once for the whole suite.
 */

const request = require('supertest');
const express = require('express');

// ---- Mock authenticate before any require of the router ----
jest.mock('../../../../middleware/authenticate.middleware', () => ({
  authenticate: (req, res, next) => {
    const header = req.headers['x-test-user'];
    if (!header) {
      const err = {
        isBoom: true,
        output: {
          statusCode: 401,
          payload: { statusCode: 401, error: 'Unauthorized', message: 'Missing token' },
        },
      };
      return next(err);
    }
    req.user = JSON.parse(header);
    next();
  },
}));

// ---- Mock UserService (instantiated at module-eval time in user.route.api.js) ----
jest.mock('../../services/user.service');

// ---- Mock ApiKeyService (instantiated at module-eval time in api-key.route.js) ----
jest.mock('../../services/api-key.service');
const ApiKeyService = require('../../services/api-key.service');

// ---- Mock node-cache singleton so we can assert nodeCache.del calls ----
const mockNodeCacheDel = jest.fn();
jest.mock('../../../../utils/cache', () => ({
  nodeCache: {
    has: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
    del: mockNodeCacheDel,
  },
  setClientCache: jest.fn(),
}));

// ---- Import the router after all mocks are in place ----
const { userRouterApi } = require('../user.route.api');

// ---------------------------------------------------------------------------
// Error handler that surfaces boom-shaped errors as JSON
// ---------------------------------------------------------------------------
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (err.isBoom) {
    const { statusCode, payload } = err.output;
    return res.status(statusCode).json(payload);
  }
  const statusCode = err?.output?.statusCode || err?.statusCode || 500;
  res.status(statusCode).json({ message: err.message || 'error' });
}

// ---------------------------------------------------------------------------
// Build a single test app
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json());
app.use('/api/v1/users', userRouterApi);
app.use(errorHandler);

// ---------------------------------------------------------------------------
// Test users
// ---------------------------------------------------------------------------
const ADMIN_USER = { userId: 'admin-1', email: 'admin@example.com', role: 'admin', groups: [] };
const REGULAR_USER = { userId: 'user-1', email: 'user@example.com', role: 'user', groups: ['fc'] };

function userHeader(user) {
  return JSON.stringify(user);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns a mock ApiKey instance whose toPublic() omits keyHash.
 */
function mockApiKeyWithPublic(overrides = {}) {
  const pub = {
    id: overrides.id || 'key-1',
    name: overrides.name || 'My Key',
    prefix: overrides.prefix || 'sk_1kg_',
    scopes: overrides.scopes || ['read:redirects'],
    expiresAt: overrides.expiresAt || null,
    createdAt: overrides.createdAt || new Date('2026-01-01').toISOString(),
    lastUsedAt: overrides.lastUsedAt || null,
    active: overrides.active !== undefined ? overrides.active : true,
  };
  return { toPublic: () => pub };
}

// ---------------------------------------------------------------------------
// Reset mocks between tests
// ---------------------------------------------------------------------------
afterEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// GET /api/v1/users/me/api-keys
// ---------------------------------------------------------------------------

describe('GET /api/v1/users/me/api-keys', () => {
  it('returns 401 when no Authorization header is provided', async () => {
    const res = await request(app).get('/api/v1/users/me/api-keys');
    expect(res.status).toBe(401);
  });

  it('returns 200 with the list of keys for an authenticated user', async () => {
    const k1 = mockApiKeyWithPublic({ id: 'key-1', name: 'Key One' });
    const k2 = mockApiKeyWithPublic({ id: 'key-2', name: 'Key Two' });
    ApiKeyService.prototype.list.mockResolvedValue([k1, k2]);

    const res = await request(app)
      .get('/api/v1/users/me/api-keys')
      .set('x-test-user', userHeader(REGULAR_USER));

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('api keys retrieved');
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].id).toBe('key-1');
    expect(res.body.data[1].id).toBe('key-2');
  });

  it('calls list with req.user.userId', async () => {
    ApiKeyService.prototype.list.mockResolvedValue([]);

    await request(app)
      .get('/api/v1/users/me/api-keys')
      .set('x-test-user', userHeader(REGULAR_USER));

    expect(ApiKeyService.prototype.list).toHaveBeenCalledWith(REGULAR_USER.userId);
  });

  it('does not include keyHash in any list item', async () => {
    const k1 = mockApiKeyWithPublic({ id: 'key-1' });
    ApiKeyService.prototype.list.mockResolvedValue([k1]);

    const res = await request(app)
      .get('/api/v1/users/me/api-keys')
      .set('x-test-user', userHeader(REGULAR_USER));

    expect(res.status).toBe(200);
    expect(res.body.data[0]).not.toHaveProperty('keyHash');
    expect(res.body.data[0]).not.toHaveProperty('token');
  });

  it('returns 200 with an empty array when the user has no keys', async () => {
    ApiKeyService.prototype.list.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/v1/users/me/api-keys')
      .set('x-test-user', userHeader(REGULAR_USER));

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('forwards service errors to the error handler', async () => {
    ApiKeyService.prototype.list.mockRejectedValue({
      isBoom: true,
      output: {
        statusCode: 500,
        payload: { statusCode: 500, error: 'Internal Server Error', message: 'db error' },
      },
    });

    const res = await request(app)
      .get('/api/v1/users/me/api-keys')
      .set('x-test-user', userHeader(REGULAR_USER));

    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/users/me/api-keys
// ---------------------------------------------------------------------------

describe('POST /api/v1/users/me/api-keys', () => {
  const validBody = { name: 'CI Token', scopes: ['read:redirects'] };

  it('returns 401 when no Authorization header is provided', async () => {
    const res = await request(app)
      .post('/api/v1/users/me/api-keys')
      .send(validBody);
    expect(res.status).toBe(401);
  });

  it('returns 400 when the required name field is missing', async () => {
    const res = await request(app)
      .post('/api/v1/users/me/api-keys')
      .set('x-test-user', userHeader(REGULAR_USER))
      .send({ scopes: ['read:redirects'] });

    expect(res.status).toBe(400);
    expect(ApiKeyService.prototype.create).not.toHaveBeenCalled();
  });

  it('returns 400 when scopes array is empty', async () => {
    const res = await request(app)
      .post('/api/v1/users/me/api-keys')
      .set('x-test-user', userHeader(REGULAR_USER))
      .send({ name: 'Token', scopes: [] });

    expect(res.status).toBe(400);
    expect(ApiKeyService.prototype.create).not.toHaveBeenCalled();
  });

  it('returns 400 when an invalid scope value is provided', async () => {
    const res = await request(app)
      .post('/api/v1/users/me/api-keys')
      .set('x-test-user', userHeader(REGULAR_USER))
      .send({ name: 'Token', scopes: ['read:invalid'] });

    expect(res.status).toBe(400);
    expect(ApiKeyService.prototype.create).not.toHaveBeenCalled();
  });

  it('returns 201 with token and public fields when a regular user creates a key with a user scope', async () => {
    const savedKey = mockApiKeyWithPublic({ id: 'new-key', name: 'CI Token', scopes: ['read:redirects'] });
    ApiKeyService.prototype.create.mockResolvedValue(savedKey);

    const res = await request(app)
      .post('/api/v1/users/me/api-keys')
      .set('x-test-user', userHeader(REGULAR_USER))
      .send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.message).toBe('api key created');
    expect(res.body.data.id).toBe('new-key');
    expect(res.body.data.name).toBe('CI Token');
  });

  it('response token starts with sk_1kg_', async () => {
    const savedKey = mockApiKeyWithPublic({ id: 'new-key' });
    ApiKeyService.prototype.create.mockResolvedValue(savedKey);

    const res = await request(app)
      .post('/api/v1/users/me/api-keys')
      .set('x-test-user', userHeader(REGULAR_USER))
      .send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.data.token).toBeDefined();
    expect(res.body.data.token).toMatch(/^sk_1kg_/);
  });

  it('response does not include keyHash', async () => {
    const savedKey = mockApiKeyWithPublic({ id: 'new-key' });
    ApiKeyService.prototype.create.mockResolvedValue(savedKey);

    const res = await request(app)
      .post('/api/v1/users/me/api-keys')
      .set('x-test-user', userHeader(REGULAR_USER))
      .send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.data).not.toHaveProperty('keyHash');
  });

  it('returns 403 when a regular user requests an admin-only scope (read:users)', async () => {
    const res = await request(app)
      .post('/api/v1/users/me/api-keys')
      .set('x-test-user', userHeader(REGULAR_USER))
      .send({ name: 'Admin Token', scopes: ['read:users'] });

    expect(res.status).toBe(403);
    expect(ApiKeyService.prototype.create).not.toHaveBeenCalled();
  });

  it('returns 403 when a regular user requests an admin-only scope (write:users)', async () => {
    const res = await request(app)
      .post('/api/v1/users/me/api-keys')
      .set('x-test-user', userHeader(REGULAR_USER))
      .send({ name: 'Admin Token', scopes: ['write:users'] });

    expect(res.status).toBe(403);
    expect(ApiKeyService.prototype.create).not.toHaveBeenCalled();
  });

  it('returns 403 when a regular user requests an admin-only scope (read:groups)', async () => {
    const res = await request(app)
      .post('/api/v1/users/me/api-keys')
      .set('x-test-user', userHeader(REGULAR_USER))
      .send({ name: 'Admin Token', scopes: ['read:groups'] });

    expect(res.status).toBe(403);
    expect(ApiKeyService.prototype.create).not.toHaveBeenCalled();
  });

  it('returns 403 when a regular user requests an admin-only scope (write:groups)', async () => {
    const res = await request(app)
      .post('/api/v1/users/me/api-keys')
      .set('x-test-user', userHeader(REGULAR_USER))
      .send({ name: 'Admin Token', scopes: ['write:groups'] });

    expect(res.status).toBe(403);
    expect(ApiKeyService.prototype.create).not.toHaveBeenCalled();
  });

  it('returns 201 when an admin user requests an admin-only scope (read:users)', async () => {
    const savedKey = mockApiKeyWithPublic({ id: 'admin-key', scopes: ['read:users'] });
    ApiKeyService.prototype.create.mockResolvedValue(savedKey);

    const res = await request(app)
      .post('/api/v1/users/me/api-keys')
      .set('x-test-user', userHeader(ADMIN_USER))
      .send({ name: 'Admin Token', scopes: ['read:users'] });

    expect(res.status).toBe(201);
    expect(res.body.data).not.toHaveProperty('keyHash');
  });

  it('returns 400 when the service throws boom.badRequest (10-key limit reached)', async () => {
    ApiKeyService.prototype.create.mockRejectedValue({
      isBoom: true,
      output: {
        statusCode: 400,
        payload: { statusCode: 400, error: 'Bad Request', message: 'API key limit reached (10)' },
      },
    });

    const res = await request(app)
      .post('/api/v1/users/me/api-keys')
      .set('x-test-user', userHeader(REGULAR_USER))
      .send(validBody);

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('API key limit reached (10)');
  });

  it('calls create with req.user.userId and an ApiKey instance', async () => {
    const savedKey = mockApiKeyWithPublic({ id: 'new-key' });
    ApiKeyService.prototype.create.mockResolvedValue(savedKey);

    await request(app)
      .post('/api/v1/users/me/api-keys')
      .set('x-test-user', userHeader(REGULAR_USER))
      .send(validBody);

    expect(ApiKeyService.prototype.create).toHaveBeenCalledWith(
      REGULAR_USER.userId,
      expect.objectContaining({ name: 'CI Token', scopes: ['read:redirects'] }),
    );
  });

  it('accepts optional expiresAt as ISO date string', async () => {
    const savedKey = mockApiKeyWithPublic({ id: 'exp-key' });
    ApiKeyService.prototype.create.mockResolvedValue(savedKey);

    const res = await request(app)
      .post('/api/v1/users/me/api-keys')
      .set('x-test-user', userHeader(REGULAR_USER))
      .send({ name: 'Expiring Key', scopes: ['read:redirects'], expiresAt: '2027-01-01T00:00:00.000Z' });

    expect(res.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/v1/users/me/api-keys/:keyId
// ---------------------------------------------------------------------------

describe('DELETE /api/v1/users/me/api-keys/:keyId', () => {
  it('returns 401 when no Authorization header is provided', async () => {
    const res = await request(app).delete('/api/v1/users/me/api-keys/key-abc');
    expect(res.status).toBe(401);
  });

  it('returns 200 with revoke confirmation when the key exists', async () => {
    ApiKeyService.prototype.revoke.mockResolvedValue('hash-abc');

    const res = await request(app)
      .delete('/api/v1/users/me/api-keys/key-abc')
      .set('x-test-user', userHeader(REGULAR_USER));

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('api key revoked');
    expect(res.body.data).toEqual({ id: 'key-abc' });
  });

  it('calls revoke with req.user.userId and the keyId param', async () => {
    ApiKeyService.prototype.revoke.mockResolvedValue('hash-xyz');

    await request(app)
      .delete('/api/v1/users/me/api-keys/key-abc')
      .set('x-test-user', userHeader(REGULAR_USER));

    expect(ApiKeyService.prototype.revoke).toHaveBeenCalledWith(REGULAR_USER.userId, 'key-abc');
  });

  it('invalidates the cache with the keyHash returned by revoke', async () => {
    ApiKeyService.prototype.revoke.mockResolvedValue('hash-for-cache');

    await request(app)
      .delete('/api/v1/users/me/api-keys/key-abc')
      .set('x-test-user', userHeader(REGULAR_USER));

    expect(mockNodeCacheDel).toHaveBeenCalledWith('hash-for-cache');
  });

  it('returns 404 when the key does not exist', async () => {
    ApiKeyService.prototype.revoke.mockRejectedValue({
      isBoom: true,
      output: {
        statusCode: 404,
        payload: { statusCode: 404, error: 'Not Found', message: 'API key not found' },
      },
    });

    const res = await request(app)
      .delete('/api/v1/users/me/api-keys/ghost-key')
      .set('x-test-user', userHeader(REGULAR_USER));

    expect(res.status).toBe(404);
  });

  it('does not call nodeCache.del when revoke throws', async () => {
    ApiKeyService.prototype.revoke.mockRejectedValue({
      isBoom: true,
      output: {
        statusCode: 404,
        payload: { statusCode: 404, error: 'Not Found', message: 'API key not found' },
      },
    });

    await request(app)
      .delete('/api/v1/users/me/api-keys/ghost-key')
      .set('x-test-user', userHeader(REGULAR_USER));

    expect(mockNodeCacheDel).not.toHaveBeenCalled();
  });
});
