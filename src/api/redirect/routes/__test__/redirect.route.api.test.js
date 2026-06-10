/**
 * Integration tests for src/api/redirect/routes/redirect.route.api.js
 *
 * Strategy:
 * - `authenticate` is mocked at module level. The mock reads an x-test-user header
 *   to inject req.user, or calls next(boom.unauthorized()) when the header is absent.
 * - RedirectServiceApi is fully mocked. Method implementations are set per test via
 *   the shared `mockMethods` object which the constructor closure captures.
 * - A single Express app is built once for the whole suite. This avoids the
 *   jest.resetModules() complications that break mock registries.
 */

const request = require('supertest');
const express = require('express');

// ---- Shared method bag exposed to test bodies ----
const mockMethods = {
  find: jest.fn(),
  getAll: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
};

// ---- Mock authenticate before any require of the route ----
jest.mock('../../../../middleware/authenticate.middleware', () => ({
  authenticate: (req, res, next) => {
    const header = req.headers['x-test-user'];
    if (!header) {
      // Produce a real-shaped boom 401 without importing boom here
      const err = { isBoom: true, output: { statusCode: 401, payload: { statusCode: 401, error: 'Unauthorized', message: 'Missing token' } } };
      return next(err);
    }
    req.user = JSON.parse(header);
    next();
  },
}));

// ---- Mock RedirectServiceApi ----
jest.mock('../../services/redirect.service', () => {
  return jest.fn().mockImplementation(() => mockMethods);
});

// ---- Import the router after mocks are in place ----
const { redirectRouterApi } = require('../redirect.route.api');

// ---- Build the test app once ----
function errorHandler(err, req, res, next) {
  if (err.isBoom) {
    const { statusCode, payload } = err.output;
    return res.status(statusCode).json(payload);
  }
  res.status(500).json({ statusCode: 500, error: 'Internal Server Error', message: err.message });
}

const app = express();
app.use(express.json());
app.use('/redirects', redirectRouterApi);
app.use(errorHandler);

// ---- Test users ----
const ADMIN_USER = { userId: 'admin-1', email: 'admin@test.com', role: 'admin', groups: [] };
const REGULAR_USER = { userId: 'user-1', email: 'user@test.com', role: 'user', groups: ['fc'] };
const MULTI_GROUP_USER = { userId: 'user-2', email: 'multi@test.com', role: 'user', groups: ['fc', 'cs'] };
const NO_GROUP_USER = { userId: 'user-3', email: 'nogroup@test.com', role: 'user', groups: [] };

function userHeader(user) {
  return JSON.stringify(user);
}

// ---- Sample data ----
const SAMPLE_REDIRECT = {
  id: 'redirect-1',
  path: '/fc/seminar',
  url: 'https://example.com',
  owner: 'user@test.com',
  permission: [],
  categories: [],
};

afterEach(() => jest.clearAllMocks());

// ---------------------------------------------------------------------------
// §2.1 — authenticate is applied to every route
// ---------------------------------------------------------------------------

describe('§2.1 — authenticate applied to all routes', () => {
  it('GET / returns 401 when no Authorization header is provided', async () => {
    const res = await request(app).get('/redirects');
    expect(res.status).toBe(401);
  });

  it('GET /:id returns 401 when no Authorization header is provided', async () => {
    const res = await request(app).get('/redirects/redirect-1');
    expect(res.status).toBe(401);
  });

  it('POST / returns 401 when no Authorization header is provided', async () => {
    const res = await request(app)
      .post('/redirects')
      .send({ path: 'seminar', url: 'https://example.com' });
    expect(res.status).toBe(401);
  });

  it('PATCH /:id returns 401 when no Authorization header is provided', async () => {
    const res = await request(app)
      .patch('/redirects/redirect-1')
      .send({ url: 'https://new.example.com' });
    expect(res.status).toBe(401);
  });

  it('DELETE /:id returns 401 when no Authorization header is provided', async () => {
    const res = await request(app).delete('/redirects/redirect-1');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET / — filter behaviour (§2.3)
// ---------------------------------------------------------------------------

describe('GET /redirects — filter construction', () => {
  it('returns 200 with data array when service resolves (admin calls getAll)', async () => {
    mockMethods.getAll.mockResolvedValue([SAMPLE_REDIRECT]);
    const res = await request(app)
      .get('/redirects')
      .set('x-test-user', userHeader(ADMIN_USER));
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('redirects retrieved');
    expect(res.body.data).toEqual([SAMPLE_REDIRECT]);
    expect(mockMethods.getAll).toHaveBeenCalledTimes(1);
    expect(mockMethods.find).not.toHaveBeenCalled();
  });

  it('uses an owner-only Filter when user has no groups', async () => {
    mockMethods.find.mockResolvedValue([]);
    await request(app)
      .get('/redirects')
      .set('x-test-user', userHeader(NO_GROUP_USER));

    expect(mockMethods.find).toHaveBeenCalledTimes(1);
    const [filters] = mockMethods.find.mock.calls[0];
    expect(filters).toHaveLength(1);
    // A plain Filter.where has no nested filters array — it's a leaf node
    const filter = filters[0];
    expect(filter.filters).toBeUndefined();
    // Filter.where serializes as { field: string, operator: string, value: any }
    expect(filter.field).toBe('owner');
    expect(filter.operator).toBe('==');
    expect(filter.value).toBe(NO_GROUP_USER.email);
  });

  it('wraps owner and permissions in a Filter.or when user belongs to one group', async () => {
    mockMethods.find.mockResolvedValue([]);
    await request(app)
      .get('/redirects')
      .set('x-test-user', userHeader(REGULAR_USER));

    const [filters] = mockMethods.find.mock.calls[0];
    expect(filters).toHaveLength(1);
    const filter = filters[0];
    // Filter.or contains a nested `filters` array with two elements
    expect(filter.filters).toBeDefined();
    expect(filter.filters).toHaveLength(2);
  });

  it('passes array-contains-any with both group slugs for multi-group user', async () => {
    mockMethods.find.mockResolvedValue([]);
    await request(app)
      .get('/redirects')
      .set('x-test-user', userHeader(MULTI_GROUP_USER));

    const [filters] = mockMethods.find.mock.calls[0];
    const orFilter = filters[0];
    // Locate the array-contains-any leaf inside the or
    // Filter.where serializes as { field: string, operator: string, value: any }
    const permFilter = orFilter.filters.find(f => f.operator === 'array-contains-any');
    expect(permFilter).toBeDefined();
    expect(permFilter.value).toEqual(expect.arrayContaining(['read:fc', 'read:cs']));
  });

  it('forwards service errors to the error handler (admin getAll failure)', async () => {
    mockMethods.getAll.mockRejectedValue(new Error('Firestore down'));
    const res = await request(app)
      .get('/redirects')
      .set('x-test-user', userHeader(ADMIN_USER));
    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// GET /:id
// ---------------------------------------------------------------------------

describe('GET /redirects/:id', () => {
  it('returns 200 with the redirect data when the service resolves', async () => {
    mockMethods.findOne.mockResolvedValue(SAMPLE_REDIRECT);
    const res = await request(app)
      .get('/redirects/redirect-1')
      .set('x-test-user', userHeader(ADMIN_USER));
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('redirect retrieved');
    expect(res.body.data).toEqual(SAMPLE_REDIRECT);
  });

  it('calls service.findOne with the id from the URL params', async () => {
    mockMethods.findOne.mockResolvedValue(SAMPLE_REDIRECT);
    await request(app)
      .get('/redirects/redirect-1')
      .set('x-test-user', userHeader(ADMIN_USER));
    expect(mockMethods.findOne).toHaveBeenCalledWith('redirect-1');
  });

  it('forwards service errors to the error handler', async () => {
    const boomErr = {
      isBoom: true,
      output: { statusCode: 404, payload: { statusCode: 404, error: 'Not Found', message: 'not found' } },
    };
    mockMethods.findOne.mockRejectedValue(boomErr);
    const res = await request(app)
      .get('/redirects/redirect-1')
      .set('x-test-user', userHeader(ADMIN_USER));
    expect(res.status).toBe(404);
  });

  it('admin can read a redirect they do not own and have no permission entry for', async () => {
    const redirect = { ...SAMPLE_REDIRECT, owner: 'someone-else@test.com', permission: [] };
    mockMethods.findOne.mockResolvedValue(redirect);
    const res = await request(app)
      .get('/redirects/redirect-1')
      .set('x-test-user', userHeader(ADMIN_USER));
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('redirect retrieved');
    expect(res.body.data).toEqual(redirect);
  });

  it('owner can read their own redirect regardless of permission list', async () => {
    const redirect = { ...SAMPLE_REDIRECT, owner: REGULAR_USER.email, permission: [] };
    mockMethods.findOne.mockResolvedValue(redirect);
    const res = await request(app)
      .get('/redirects/redirect-1')
      .set('x-test-user', userHeader(REGULAR_USER));
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('redirect retrieved');
  });

  it('user with a matching group read-permission can read a redirect they do not own', async () => {
    const groupUser = { userId: 'user-4', email: 'other@test.com', role: 'user', groups: ['fc'] };
    const redirect = { ...SAMPLE_REDIRECT, owner: 'owner@test.com', permission: ['read:fc'] };
    mockMethods.findOne.mockResolvedValue(redirect);
    const res = await request(app)
      .get('/redirects/redirect-1')
      .set('x-test-user', userHeader(groupUser));
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('redirect retrieved');
  });

  it('returns 403 when user belongs to a different group than the permission list', async () => {
    const stranger = { userId: 'user-5', email: 'stranger@test.com', role: 'user', groups: ['cs'] };
    const redirect = { ...SAMPLE_REDIRECT, owner: 'owner@test.com', permission: ['read:fc'] };
    mockMethods.findOne.mockResolvedValue(redirect);
    const res = await request(app)
      .get('/redirects/redirect-1')
      .set('x-test-user', userHeader(stranger));
    expect(res.status).toBe(403);
  });

  it('returns 403 when user has no groups and is not the owner', async () => {
    const stranger = { userId: 'user-6', email: 'stranger@test.com', role: 'user', groups: [] };
    const redirect = { ...SAMPLE_REDIRECT, owner: 'owner@test.com', permission: [] };
    mockMethods.findOne.mockResolvedValue(redirect);
    const res = await request(app)
      .get('/redirects/redirect-1')
      .set('x-test-user', userHeader(stranger));
    expect(res.status).toBe(403);
  });

  it('does not throw when redirect has no permission field — treats it as empty', async () => {
    const stranger = { userId: 'user-7', email: 'stranger@test.com', role: 'user', groups: ['fc'] };
    // Deliberately omit the permission field to exercise the (data.permission || []) guard
    const redirect = { id: 'redirect-1', path: '/fc/seminar', url: 'https://example.com', owner: 'owner@test.com' };
    mockMethods.findOne.mockResolvedValue(redirect);
    const res = await request(app)
      .get('/redirects/redirect-1')
      .set('x-test-user', userHeader(stranger));
    // The user has no ownership and no matching permission — expect 403, not a 500 crash
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// POST / — namespace validation + owner assignment (§2.3)
// ---------------------------------------------------------------------------

describe('POST /redirects — namespace and owner', () => {
  it('admin without group creates redirect with fullPath = /<path>', async () => {
    mockMethods.create.mockResolvedValue(SAMPLE_REDIRECT);
    const res = await request(app)
      .post('/redirects')
      .set('x-test-user', userHeader(ADMIN_USER))
      .send({ path: 'promo', url: 'https://example.com' });
    expect(res.status).toBe(201);
    const createdRedirect = mockMethods.create.mock.calls[0][0];
    expect(createdRedirect.path).toBe('/promo');
  });

  it('admin with group creates redirect with fullPath = /<group>/<path>', async () => {
    mockMethods.create.mockResolvedValue(SAMPLE_REDIRECT);
    const res = await request(app)
      .post('/redirects')
      .set('x-test-user', userHeader(ADMIN_USER))
      .send({ group: 'fc', path: 'seminar', url: 'https://example.com' });
    expect(res.status).toBe(201);
    const createdRedirect = mockMethods.create.mock.calls[0][0];
    expect(createdRedirect.path).toBe('/fc/seminar');
  });

  it('sets owner from req.user.email — not from the request body', async () => {
    mockMethods.create.mockResolvedValue(SAMPLE_REDIRECT);
    await request(app)
      .post('/redirects')
      .set('x-test-user', userHeader(ADMIN_USER))
      .send({ path: 'promo', url: 'https://example.com' });
    const createdRedirect = mockMethods.create.mock.calls[0][0];
    expect(createdRedirect.owner).toBe(ADMIN_USER.email);
  });

  it('returns 400 when the request body includes an owner field (schema disallows it)', async () => {
    const res = await request(app)
      .post('/redirects')
      .set('x-test-user', userHeader(ADMIN_USER))
      .send({ path: 'promo', url: 'https://example.com', owner: 'attacker@evil.com' });
    expect(res.status).toBe(400);
    expect(mockMethods.create).not.toHaveBeenCalled();
  });

  it('returns 403 when non-admin provides no group', async () => {
    const res = await request(app)
      .post('/redirects')
      .set('x-test-user', userHeader(REGULAR_USER))
      .send({ path: 'seminar', url: 'https://example.com' });
    expect(res.status).toBe(403);
    expect(mockMethods.create).not.toHaveBeenCalled();
  });

  it('returns 403 when non-admin provides a group they do not belong to', async () => {
    const res = await request(app)
      .post('/redirects')
      .set('x-test-user', userHeader(REGULAR_USER))
      .send({ group: 'math', path: 'seminar', url: 'https://example.com' });
    expect(res.status).toBe(403);
    expect(mockMethods.create).not.toHaveBeenCalled();
  });

  it('non-admin with a valid group creates redirect with fullPath = /<group>/<path>', async () => {
    mockMethods.create.mockResolvedValue(SAMPLE_REDIRECT);
    const res = await request(app)
      .post('/redirects')
      .set('x-test-user', userHeader(REGULAR_USER))
      .send({ group: 'fc', path: 'seminar', url: 'https://example.com' });
    expect(res.status).toBe(201);
    const createdRedirect = mockMethods.create.mock.calls[0][0];
    expect(createdRedirect.path).toBe('/fc/seminar');
    expect(createdRedirect.owner).toBe(REGULAR_USER.email);
  });

  it('returns 400 when path contains a leading slash (Joi schema rejects it)', async () => {
    const res = await request(app)
      .post('/redirects')
      .set('x-test-user', userHeader(ADMIN_USER))
      .send({ path: '/seminar', url: 'https://example.com' });
    expect(res.status).toBe(400);
    expect(mockMethods.create).not.toHaveBeenCalled();
  });

  it('returns 201 with message "redirect created" on success', async () => {
    mockMethods.create.mockResolvedValue(SAMPLE_REDIRECT);
    const res = await request(app)
      .post('/redirects')
      .set('x-test-user', userHeader(ADMIN_USER))
      .send({ path: 'promo', url: 'https://example.com' });
    expect(res.status).toBe(201);
    expect(res.body.message).toBe('redirect created');
  });

  it('forwards service errors to the error handler', async () => {
    const boomErr = {
      isBoom: true,
      output: { statusCode: 400, payload: { statusCode: 400, error: 'Bad Request', message: 'Path already taken' } },
    };
    mockMethods.create.mockRejectedValue(boomErr);
    const res = await request(app)
      .post('/redirects')
      .set('x-test-user', userHeader(ADMIN_USER))
      .send({ path: 'promo', url: 'https://example.com' });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// PATCH /:id — ownership check (§2.3)
// ---------------------------------------------------------------------------

describe('PATCH /redirects/:id — ownership', () => {
  it('admin can modify a redirect owned by another user', async () => {
    mockMethods.findOne.mockResolvedValue({ ...SAMPLE_REDIRECT, owner: 'other@test.com' });
    mockMethods.update.mockResolvedValue({ ...SAMPLE_REDIRECT, url: 'https://new.example.com' });
    const res = await request(app)
      .patch('/redirects/redirect-1')
      .set('x-test-user', userHeader(ADMIN_USER))
      .send({ url: 'https://new.example.com' });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('redirect updated');
  });

  it('owner can modify their own redirect', async () => {
    mockMethods.findOne.mockResolvedValue({ ...SAMPLE_REDIRECT, owner: REGULAR_USER.email });
    mockMethods.update.mockResolvedValue({ ...SAMPLE_REDIRECT, url: 'https://new.example.com' });
    const res = await request(app)
      .patch('/redirects/redirect-1')
      .set('x-test-user', userHeader(REGULAR_USER))
      .send({ url: 'https://new.example.com' });
    expect(res.status).toBe(200);
  });

  it('returns 403 when non-admin non-owner attempts to modify the redirect', async () => {
    const otherUser = { userId: 'user-99', email: 'other@test.com', role: 'user', groups: ['fc'] };
    mockMethods.findOne.mockResolvedValue({ ...SAMPLE_REDIRECT, owner: REGULAR_USER.email });
    const res = await request(app)
      .patch('/redirects/redirect-1')
      .set('x-test-user', userHeader(otherUser))
      .send({ url: 'https://new.example.com' });
    expect(res.status).toBe(403);
    expect(mockMethods.update).not.toHaveBeenCalled();
  });

  it('forwards a findOne error before performing the update', async () => {
    const boomErr = {
      isBoom: true,
      output: { statusCode: 404, payload: { statusCode: 404, error: 'Not Found', message: 'not found' } },
    };
    mockMethods.findOne.mockRejectedValue(boomErr);
    const res = await request(app)
      .patch('/redirects/redirect-1')
      .set('x-test-user', userHeader(REGULAR_USER))
      .send({ url: 'https://new.example.com' });
    expect(res.status).toBe(404);
    expect(mockMethods.update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// DELETE /:id — ownership check (§2.3)
// ---------------------------------------------------------------------------

describe('DELETE /redirects/:id — ownership', () => {
  it('admin can delete a redirect owned by another user', async () => {
    mockMethods.findOne.mockResolvedValue({ ...SAMPLE_REDIRECT, owner: 'other@test.com' });
    mockMethods.delete.mockResolvedValue('redirect-1');
    const res = await request(app)
      .delete('/redirects/redirect-1')
      .set('x-test-user', userHeader(ADMIN_USER));
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('redirect deleted');
  });

  it('owner can delete their own redirect', async () => {
    mockMethods.findOne.mockResolvedValue({ ...SAMPLE_REDIRECT, owner: REGULAR_USER.email });
    mockMethods.delete.mockResolvedValue('redirect-1');
    const res = await request(app)
      .delete('/redirects/redirect-1')
      .set('x-test-user', userHeader(REGULAR_USER));
    expect(res.status).toBe(200);
  });

  it('returns 403 when non-admin non-owner attempts to delete the redirect', async () => {
    const otherUser = { userId: 'user-99', email: 'other@test.com', role: 'user', groups: ['fc'] };
    mockMethods.findOne.mockResolvedValue({ ...SAMPLE_REDIRECT, owner: REGULAR_USER.email });
    const res = await request(app)
      .delete('/redirects/redirect-1')
      .set('x-test-user', userHeader(otherUser));
    expect(res.status).toBe(403);
    expect(mockMethods.delete).not.toHaveBeenCalled();
  });

  it('forwards a findOne error before performing the delete', async () => {
    const boomErr = {
      isBoom: true,
      output: { statusCode: 404, payload: { statusCode: 404, error: 'Not Found', message: 'not found' } },
    };
    mockMethods.findOne.mockRejectedValue(boomErr);
    const res = await request(app)
      .delete('/redirects/redirect-1')
      .set('x-test-user', userHeader(REGULAR_USER));
    expect(res.status).toBe(404);
    expect(mockMethods.delete).not.toHaveBeenCalled();
  });
});
