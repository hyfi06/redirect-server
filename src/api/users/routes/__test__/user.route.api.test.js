'use strict';

/**
 * Integration tests for src/api/users/routes/user.route.api.js
 *
 * Strategy:
 * - `authenticate` is mocked at module level using the x-test-user header pattern
 *   established in redirect.route.api.test.js. The mock injects req.user from the
 *   header or calls next(boom 401) when the header is absent.
 * - `authorize` runs real — tests use appropriate role in x-test-user.
 * - `UserService` is fully mocked. `User` model is mocked so PATCH tests work
 *   without needing a valid email in the body.
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

// ---- Mock the service before any require of the router ----
// (The router instantiates the service at module-evaluation time via `new UserService()`.)
jest.mock('../../services/user.service');
const UserService = require('../../services/user.service');

// ---- Mock the User model ----
// PATCH handler does `new User({ id, ...req.body })` but updateUserSelfSchema
// forbids email — so any PATCH body will miss email, causing the real User
// constructor to throw. Mocking User lets us test the route handler contract
// (toPublic(), status codes) in isolation.
jest.mock('../../models/user.model');
const User = require('../../models/user.model');

// ---- Import the router after mocks are in place ----
const { userRouterApi } = require('../user.route.api');

// ---------------------------------------------------------------------------
// Error handler that properly surfaces boom-shaped errors
// ---------------------------------------------------------------------------
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (err.isBoom) {
    const { statusCode, payload } = err.output;
    return res.status(statusCode).json(payload);
  }
  // Non-boom errors (e.g. direct boom objects without isBoom, or plain errors)
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
 * Returns a mock object that behaves like a User instance for route purposes:
 * it has a `toPublic()` method that returns only the safe public fields.
 */
function mockUserWithPublic(overrides = {}) {
  const pub = {
    id: overrides.id || 'user-1',
    email: overrides.email || 'test@example.com',
    firstName: overrides.firstName || 'Test',
    lastName: overrides.lastName || 'User',
    groups: overrides.groups || [],
    role: overrides.role || 'user',
    created: overrides.created,
    updated: overrides.updated,
  };
  return { toPublic: () => pub };
}

// ---------------------------------------------------------------------------
// Reset mocks between tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  // Make `new User(data)` return a simple stub so the handler can call `.toPublic()`
  // on what the service returns. The actual User constructor is tested in user.test.js.
  User.mockImplementation((data) => ({ _data: data }));
});

afterEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Authentication — all routes require a valid JWT
// ---------------------------------------------------------------------------

describe('authenticate applied to all user routes', () => {
  it('GET / returns 401 when no Authorization header is provided', async () => {
    const res = await request(app).get('/api/v1/users');
    expect(res.status).toBe(401);
  });

  it('GET /me returns 401 when no Authorization header is provided', async () => {
    const res = await request(app).get('/api/v1/users/me');
    expect(res.status).toBe(401);
  });

  it('GET /:id returns 401 when no Authorization header is provided', async () => {
    const res = await request(app).get('/api/v1/users/user-abc');
    expect(res.status).toBe(401);
  });

  it('POST / returns 401 when no Authorization header is provided', async () => {
    const res = await request(app)
      .post('/api/v1/users')
      .send({ email: 'new@example.com' });
    expect(res.status).toBe(401);
  });

  it('PATCH /:id returns 401 when no Authorization header is provided', async () => {
    const res = await request(app)
      .patch('/api/v1/users/user-abc')
      .send({ firstName: 'Updated' });
    expect(res.status).toBe(401);
  });

  it('DELETE /:id returns 401 when no Authorization header is provided', async () => {
    const res = await request(app).delete('/api/v1/users/user-abc');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Admin-only routes — 403 for regular users
// ---------------------------------------------------------------------------

describe('admin-only routes return 403 for regular users', () => {
  it('GET / returns 403 for a regular user', async () => {
    const res = await request(app)
      .get('/api/v1/users')
      .set('x-test-user', userHeader(REGULAR_USER));
    expect(res.status).toBe(403);
    expect(UserService.prototype.find).not.toHaveBeenCalled();
  });

  it('GET /:id returns 403 for a regular user', async () => {
    const res = await request(app)
      .get('/api/v1/users/user-abc')
      .set('x-test-user', userHeader(REGULAR_USER));
    expect(res.status).toBe(403);
    expect(UserService.prototype.findOne).not.toHaveBeenCalled();
  });

  it('POST / returns 403 for a regular user', async () => {
    const res = await request(app)
      .post('/api/v1/users')
      .set('x-test-user', userHeader(REGULAR_USER))
      .send({ email: 'new@example.com' });
    expect(res.status).toBe(403);
    expect(UserService.prototype.create).not.toHaveBeenCalled();
  });

  it('DELETE /:id returns 403 for a regular user', async () => {
    const res = await request(app)
      .delete('/api/v1/users/user-abc')
      .set('x-test-user', userHeader(REGULAR_USER));
    expect(res.status).toBe(403);
    expect(UserService.prototype.delete).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// GET / — admin only
// ---------------------------------------------------------------------------

describe('GET /api/v1/users', () => {
  it('returns 200 with an array of public user objects for an admin', async () => {
    const u1 = mockUserWithPublic({ id: 'u1', email: 'a@example.com' });
    const u2 = mockUserWithPublic({ id: 'u2', email: 'b@example.com' });
    UserService.prototype.find.mockResolvedValue([u1, u2]);

    const res = await request(app)
      .get('/api/v1/users')
      .set('x-test-user', userHeader(ADMIN_USER));

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('users retrieved');
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].id).toBe('u1');
    expect(res.body.data[1].id).toBe('u2');
  });

  it('does not include auth fields in any item of the response array', async () => {
    const u1 = mockUserWithPublic({ id: 'u1' });
    UserService.prototype.find.mockResolvedValue([u1]);

    const res = await request(app)
      .get('/api/v1/users')
      .set('x-test-user', userHeader(ADMIN_USER));

    expect(res.status).toBe(200);
    const item = res.body.data[0];
    expect(item).not.toHaveProperty('auth');
    expect(item).not.toHaveProperty('googleToken');
    expect(item).not.toHaveProperty('googleRefreshToken');
    expect(item).not.toHaveProperty('refreshToken');
    expect(item).not.toHaveProperty('apiToken');
  });

  it('forwards service errors to the error handler', async () => {
    UserService.prototype.find.mockRejectedValue({
      isBoom: true,
      output: { statusCode: 500, payload: { statusCode: 500, error: 'Internal Server Error', message: 'db error' } },
    });

    const res = await request(app)
      .get('/api/v1/users')
      .set('x-test-user', userHeader(ADMIN_USER));

    expect(res.status).toBe(500);
  });

  // GAP-3: query parameter validation via getUsersQuerySchema
  describe('query parameter validation (GAP-3)', () => {
    it('returns 200 when no query params are provided', async () => {
      UserService.prototype.find.mockResolvedValue([]);

      const res = await request(app)
        .get('/api/v1/users')
        .set('x-test-user', userHeader(ADMIN_USER));

      expect(res.status).toBe(200);
    });

    it('returns 200 with valid offset and limit params', async () => {
      UserService.prototype.find.mockResolvedValue([]);

      const res = await request(app)
        .get('/api/v1/users?offset=2&limit=10')
        .set('x-test-user', userHeader(ADMIN_USER));

      expect(res.status).toBe(200);
    });

    it('returns 400 when offset is not a number', async () => {
      const res = await request(app)
        .get('/api/v1/users?offset=abc')
        .set('x-test-user', userHeader(ADMIN_USER));

      expect(res.status).toBe(400);
      expect(UserService.prototype.find).not.toHaveBeenCalled();
    });

    it('returns 400 when limit is zero', async () => {
      const res = await request(app)
        .get('/api/v1/users?limit=0')
        .set('x-test-user', userHeader(ADMIN_USER));

      expect(res.status).toBe(400);
      expect(UserService.prototype.find).not.toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------
// GET /me — any authenticated user
// ---------------------------------------------------------------------------

describe('GET /api/v1/users/me', () => {
  it('returns 200 with the authenticated admin user profile', async () => {
    const mockUser = mockUserWithPublic({ id: 'admin-1', email: 'admin@example.com', role: 'admin' });
    UserService.prototype.findOne.mockResolvedValue(mockUser);

    const res = await request(app)
      .get('/api/v1/users/me')
      .set('x-test-user', userHeader(ADMIN_USER));

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('profile retrieved');
    expect(res.body.data.id).toBe('admin-1');
    expect(res.body.data.email).toBe('admin@example.com');
  });

  it('returns 200 with a regular user profile', async () => {
    const mockUser = mockUserWithPublic({ id: 'user-1', email: 'user@example.com', role: 'user' });
    UserService.prototype.findOne.mockResolvedValue(mockUser);

    const res = await request(app)
      .get('/api/v1/users/me')
      .set('x-test-user', userHeader(REGULAR_USER));

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('profile retrieved');
    expect(res.body.data.id).toBe('user-1');
  });

  it('calls findOne with req.user.userId', async () => {
    const mockUser = mockUserWithPublic({ id: 'user-1' });
    UserService.prototype.findOne.mockResolvedValue(mockUser);

    await request(app)
      .get('/api/v1/users/me')
      .set('x-test-user', userHeader(REGULAR_USER));

    expect(UserService.prototype.findOne).toHaveBeenCalledWith(REGULAR_USER.userId);
  });

  it('does not include auth fields in the response data', async () => {
    const mockUser = mockUserWithPublic({ id: 'user-1' });
    UserService.prototype.findOne.mockResolvedValue(mockUser);

    const res = await request(app)
      .get('/api/v1/users/me')
      .set('x-test-user', userHeader(REGULAR_USER));

    expect(res.status).toBe(200);
    expect(res.body.data).not.toHaveProperty('auth');
    expect(res.body.data).not.toHaveProperty('googleToken');
    expect(res.body.data).not.toHaveProperty('googleRefreshToken');
    expect(res.body.data).not.toHaveProperty('refreshToken');
    expect(res.body.data).not.toHaveProperty('apiToken');
  });

  it('returns 404 when the user is not found in Firestore', async () => {
    UserService.prototype.findOne.mockRejectedValue({
      isBoom: true,
      output: {
        statusCode: 404,
        payload: { statusCode: 404, error: 'Not Found', message: 'Resource not found' },
      },
    });

    const res = await request(app)
      .get('/api/v1/users/me')
      .set('x-test-user', userHeader(REGULAR_USER));

    expect(res.status).toBe(404);
  });

  it('is not intercepted by GET /:id — responds correctly for the literal path /me', async () => {
    // This guards the D-B4-4 mounting order decision: /me must come before /:id.
    const mockUser = mockUserWithPublic({ id: REGULAR_USER.userId });
    UserService.prototype.findOne.mockResolvedValue(mockUser);

    const res = await request(app)
      .get('/api/v1/users/me')
      .set('x-test-user', userHeader(REGULAR_USER));

    // If /:id was matched instead, authorize('admin') would fire and return 403.
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('profile retrieved');
  });
});

// ---------------------------------------------------------------------------
// GET /:id — admin only
// ---------------------------------------------------------------------------

describe('GET /api/v1/users/:id', () => {
  it('returns 200 with the public user object for an admin', async () => {
    const mockUser = mockUserWithPublic({ id: 'user-abc', email: 'found@example.com' });
    UserService.prototype.findOne.mockResolvedValue(mockUser);

    const res = await request(app)
      .get('/api/v1/users/user-abc')
      .set('x-test-user', userHeader(ADMIN_USER));

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('user retrieved');
    expect(res.body.data.id).toBe('user-abc');
    expect(res.body.data.email).toBe('found@example.com');
  });

  it('does not include auth fields in the response data', async () => {
    const mockUser = mockUserWithPublic({ id: 'user-abc' });
    UserService.prototype.findOne.mockResolvedValue(mockUser);

    const res = await request(app)
      .get('/api/v1/users/user-abc')
      .set('x-test-user', userHeader(ADMIN_USER));

    expect(res.status).toBe(200);
    expect(res.body.data).not.toHaveProperty('auth');
    expect(res.body.data).not.toHaveProperty('googleToken');
    expect(res.body.data).not.toHaveProperty('googleRefreshToken');
    expect(res.body.data).not.toHaveProperty('refreshToken');
    expect(res.body.data).not.toHaveProperty('apiToken');
  });

  it('forwards notFound errors from the service to the error handler', async () => {
    UserService.prototype.findOne.mockRejectedValue({
      isBoom: true,
      output: {
        statusCode: 404,
        payload: { statusCode: 404, error: 'Not Found', message: 'Resource not found' },
      },
    });

    const res = await request(app)
      .get('/api/v1/users/ghost')
      .set('x-test-user', userHeader(ADMIN_USER));

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST / — admin only
// ---------------------------------------------------------------------------

describe('POST /api/v1/users', () => {
  const validBody = { email: 'new@example.com', firstName: 'New', lastName: 'User' };

  it('returns 201 with the public user object on successful creation', async () => {
    const mockUser = mockUserWithPublic({ id: 'new-user', email: 'new@example.com' });
    UserService.prototype.create.mockResolvedValue(mockUser);

    const res = await request(app)
      .post('/api/v1/users')
      .set('x-test-user', userHeader(ADMIN_USER))
      .send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.message).toBe('user created');
    expect(res.body.data.id).toBe('new-user');
    expect(res.body.data.email).toBe('new@example.com');
  });

  it('does not include auth fields in the response data', async () => {
    const mockUser = mockUserWithPublic({ id: 'new-user' });
    UserService.prototype.create.mockResolvedValue(mockUser);

    const res = await request(app)
      .post('/api/v1/users')
      .set('x-test-user', userHeader(ADMIN_USER))
      .send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.data).not.toHaveProperty('auth');
    expect(res.body.data).not.toHaveProperty('googleToken');
    expect(res.body.data).not.toHaveProperty('googleRefreshToken');
    expect(res.body.data).not.toHaveProperty('refreshToken');
    expect(res.body.data).not.toHaveProperty('apiToken');
  });

  it('returns 400 when the required email field is missing', async () => {
    const res = await request(app)
      .post('/api/v1/users')
      .set('x-test-user', userHeader(ADMIN_USER))
      .send({ firstName: 'No', lastName: 'Email' });

    expect(res.status).toBe(400);
    expect(UserService.prototype.create).not.toHaveBeenCalled();
  });

  it('forwards service errors to the error handler (e.g. duplicate email)', async () => {
    UserService.prototype.create.mockRejectedValue({
      isBoom: true,
      output: {
        statusCode: 400,
        payload: { statusCode: 400, error: 'Bad Request', message: 'User already created' },
      },
    });

    const res = await request(app)
      .post('/api/v1/users')
      .set('x-test-user', userHeader(ADMIN_USER))
      .send(validBody);

    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// PATCH /:id — dynamic schema + ownership check
// ---------------------------------------------------------------------------

describe('PATCH /api/v1/users/:id', () => {
  describe('admin editing any user', () => {
    it('returns 200 when admin updates firstName', async () => {
      const mockUser = mockUserWithPublic({ id: 'user-upd', firstName: 'Updated' });
      UserService.prototype.update.mockResolvedValue(mockUser);

      const res = await request(app)
        .patch('/api/v1/users/user-upd')
        .set('x-test-user', userHeader(ADMIN_USER))
        .send({ firstName: 'Updated' });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('user updated');
      expect(res.body.data.id).toBe('user-upd');
      expect(res.body.data.firstName).toBe('Updated');
    });

    it('returns 200 when admin updates role', async () => {
      const mockUser = mockUserWithPublic({ id: 'user-upd', role: 'admin' });
      UserService.prototype.update.mockResolvedValue(mockUser);

      const res = await request(app)
        .patch('/api/v1/users/user-upd')
        .set('x-test-user', userHeader(ADMIN_USER))
        .send({ role: 'admin' });

      expect(res.status).toBe(200);
      expect(UserService.prototype.update).toHaveBeenCalledTimes(1);
    });

    it('returns 200 when admin updates groups', async () => {
      const mockUser = mockUserWithPublic({ id: 'user-upd', groups: ['fc', 'cs'] });
      UserService.prototype.update.mockResolvedValue(mockUser);

      const res = await request(app)
        .patch('/api/v1/users/user-upd')
        .set('x-test-user', userHeader(ADMIN_USER))
        .send({ groups: ['fc', 'cs'] });

      expect(res.status).toBe(200);
      expect(UserService.prototype.update).toHaveBeenCalledTimes(1);
    });

    it('returns 400 when admin sends an invalid role value', async () => {
      const res = await request(app)
        .patch('/api/v1/users/user-upd')
        .set('x-test-user', userHeader(ADMIN_USER))
        .send({ role: 'superuser' });

      expect(res.status).toBe(400);
      expect(UserService.prototype.update).not.toHaveBeenCalled();
    });

    it('returns 400 when admin sends a field not in the admin update schema', async () => {
      const res = await request(app)
        .patch('/api/v1/users/user-upd')
        .set('x-test-user', userHeader(ADMIN_USER))
        .send({ email: 'changed@example.com' });

      expect(res.status).toBe(400);
      expect(UserService.prototype.update).not.toHaveBeenCalled();
    });

    it('admin can edit another user profile (no ownership restriction)', async () => {
      const mockUser = mockUserWithPublic({ id: 'other-user', firstName: 'Updated' });
      UserService.prototype.update.mockResolvedValue(mockUser);

      const res = await request(app)
        .patch('/api/v1/users/other-user')
        .set('x-test-user', userHeader(ADMIN_USER))
        .send({ firstName: 'Updated' });

      expect(res.status).toBe(200);
    });

    it('does not include auth fields in the response data', async () => {
      const mockUser = mockUserWithPublic({ id: 'user-upd' });
      UserService.prototype.update.mockResolvedValue(mockUser);

      const res = await request(app)
        .patch('/api/v1/users/user-upd')
        .set('x-test-user', userHeader(ADMIN_USER))
        .send({ firstName: 'Updated' });

      expect(res.status).toBe(200);
      expect(res.body.data).not.toHaveProperty('auth');
      expect(res.body.data).not.toHaveProperty('googleToken');
      expect(res.body.data).not.toHaveProperty('googleRefreshToken');
      expect(res.body.data).not.toHaveProperty('refreshToken');
      expect(res.body.data).not.toHaveProperty('apiToken');
    });
  });

  describe('regular user editing own profile', () => {
    it('returns 200 when user updates their own firstName', async () => {
      const mockUser = mockUserWithPublic({ id: REGULAR_USER.userId, firstName: 'Updated' });
      UserService.prototype.update.mockResolvedValue(mockUser);

      const res = await request(app)
        .patch(`/api/v1/users/${REGULAR_USER.userId}`)
        .set('x-test-user', userHeader(REGULAR_USER))
        .send({ firstName: 'Updated' });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('user updated');
    });

    it('returns 200 when user updates their own lastName', async () => {
      const mockUser = mockUserWithPublic({ id: REGULAR_USER.userId, lastName: 'NewLast' });
      UserService.prototype.update.mockResolvedValue(mockUser);

      const res = await request(app)
        .patch(`/api/v1/users/${REGULAR_USER.userId}`)
        .set('x-test-user', userHeader(REGULAR_USER))
        .send({ lastName: 'NewLast' });

      expect(res.status).toBe(200);
    });

    it('returns 400 when a regular user attempts to change their role', async () => {
      const res = await request(app)
        .patch(`/api/v1/users/${REGULAR_USER.userId}`)
        .set('x-test-user', userHeader(REGULAR_USER))
        .send({ role: 'admin' });

      expect(res.status).toBe(400);
      expect(UserService.prototype.update).not.toHaveBeenCalled();
    });

    it('returns 400 when a regular user attempts to change their groups', async () => {
      const res = await request(app)
        .patch(`/api/v1/users/${REGULAR_USER.userId}`)
        .set('x-test-user', userHeader(REGULAR_USER))
        .send({ groups: ['cs'] });

      expect(res.status).toBe(400);
      expect(UserService.prototype.update).not.toHaveBeenCalled();
    });

    it('returns 400 when a regular user sends a field not in the self update schema', async () => {
      const res = await request(app)
        .patch(`/api/v1/users/${REGULAR_USER.userId}`)
        .set('x-test-user', userHeader(REGULAR_USER))
        .send({ email: 'changed@example.com' });

      expect(res.status).toBe(400);
      expect(UserService.prototype.update).not.toHaveBeenCalled();
    });
  });

  describe('ownership enforcement', () => {
    it('returns 403 when a regular user attempts to edit another user profile', async () => {
      const res = await request(app)
        .patch('/api/v1/users/different-user-id')
        .set('x-test-user', userHeader(REGULAR_USER))
        .send({ firstName: 'Hacker' });

      expect(res.status).toBe(403);
      expect(UserService.prototype.update).not.toHaveBeenCalled();
    });
  });

  describe('service errors', () => {
    it('forwards notFound errors to the error handler', async () => {
      UserService.prototype.update.mockRejectedValue({
        isBoom: true,
        output: {
          statusCode: 404,
          payload: { statusCode: 404, error: 'Not Found', message: 'Resource not found' },
        },
      });

      const res = await request(app)
        .patch(`/api/v1/users/${REGULAR_USER.userId}`)
        .set('x-test-user', userHeader(REGULAR_USER))
        .send({ firstName: 'Updated' });

      expect(res.status).toBe(404);
    });
  });
});

// ---------------------------------------------------------------------------
// DELETE /:id — admin only
// ---------------------------------------------------------------------------

describe('DELETE /api/v1/users/:id', () => {
  it('returns 200 with the deleted id string for an admin', async () => {
    UserService.prototype.delete.mockResolvedValue('user-del');

    const res = await request(app)
      .delete('/api/v1/users/user-del')
      .set('x-test-user', userHeader(ADMIN_USER));

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('user deleted');
    expect(res.body.data).toBe('user-del');
  });

  it('forwards notFound errors from the service to the error handler', async () => {
    UserService.prototype.delete.mockRejectedValue({
      isBoom: true,
      output: {
        statusCode: 404,
        payload: { statusCode: 404, error: 'Not Found', message: 'Resource not found' },
      },
    });

    const res = await request(app)
      .delete('/api/v1/users/ghost')
      .set('x-test-user', userHeader(ADMIN_USER));

    expect(res.status).toBe(404);
  });
});
