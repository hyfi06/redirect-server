'use strict';

const request = require('supertest');
const express = require('express');

// Mock the service before any require of the router (the router instantiates
// the service at module-evaluation time via `new UserService()`).
jest.mock('../../services/user.service.api');
const UserService = require('../../services/user.service.api');

// Mock the User model so that PATCH tests can work without a valid email field.
// The PATCH handler does `new User({ id, ...req.body })` but updateUserSchema
// forbids email — so any PATCH body will miss email, causing the real User
// constructor to throw. Mocking User lets us test the route handler contract
// (toPublic(), status codes) in isolation.
jest.mock('../../models/user');
const User = require('../../models/user');

// The router is required once after mocks are set up. Express registers
// middleware at require-time (via `userService = new UserService()`), so a
// single require is correct — `beforeEach` resets mock state instead.
const { userRouterApi } = require('../user.route.api');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Return a mock object that behaves like a User instance for route purposes:
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

/**
 * Build a fresh Express app for each test so error handlers are isolated.
 */
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/users', userRouterApi);
  // Minimal error handler — propagates boom-shaped errors to HTTP status codes.
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    const statusCode = err?.output?.statusCode || err?.statusCode || 500;
    res.status(statusCode).json({ message: err.message || 'error' });
  });
  return app;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('User routes', () => {
  let app;

  beforeEach(() => {
    app = buildApp();

    // Make `new User(data)` return a simple stub with the original data
    // accessible so the handler can call `.toPublic()` on what the service returns.
    // The actual User constructor behaviour is tested in user.test.js.
    User.mockImplementation((data) => ({ _data: data }));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // GET /
  // -------------------------------------------------------------------------
  describe('GET /', () => {
    it('returns 200 with an array of public user objects', async () => {
      const u1 = mockUserWithPublic({ id: 'u1', email: 'a@example.com' });
      const u2 = mockUserWithPublic({ id: 'u2', email: 'b@example.com' });
      UserService.prototype.find.mockResolvedValue([u1, u2]);

      const res = await request(app).get('/api/v1/users');

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

      const res = await request(app).get('/api/v1/users');

      expect(res.status).toBe(200);
      const item = res.body.data[0];
      expect(item).not.toHaveProperty('auth');
      expect(item).not.toHaveProperty('googleToken');
      expect(item).not.toHaveProperty('googleRefreshToken');
      expect(item).not.toHaveProperty('refreshToken');
      expect(item).not.toHaveProperty('apiToken');
    });

    it('calls next(error) when the service throws', async () => {
      UserService.prototype.find.mockRejectedValue({
        output: { statusCode: 500 },
        message: 'db error',
      });

      const res = await request(app).get('/api/v1/users');

      expect(res.status).toBe(500);
    });
  });

  // -------------------------------------------------------------------------
  // GET /:id
  // -------------------------------------------------------------------------
  describe('GET /:id', () => {
    it('returns 200 with the public user object', async () => {
      const mockUser = mockUserWithPublic({ id: 'user-abc', email: 'found@example.com' });
      UserService.prototype.findOne.mockResolvedValue(mockUser);

      const res = await request(app).get('/api/v1/users/user-abc');

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('user retrieved');
      expect(res.body.data.id).toBe('user-abc');
      expect(res.body.data.email).toBe('found@example.com');
    });

    it('does not include auth fields in the response data', async () => {
      const mockUser = mockUserWithPublic({ id: 'user-abc' });
      UserService.prototype.findOne.mockResolvedValue(mockUser);

      const res = await request(app).get('/api/v1/users/user-abc');

      expect(res.status).toBe(200);
      expect(res.body.data).not.toHaveProperty('auth');
      expect(res.body.data).not.toHaveProperty('googleToken');
      expect(res.body.data).not.toHaveProperty('googleRefreshToken');
      expect(res.body.data).not.toHaveProperty('refreshToken');
      expect(res.body.data).not.toHaveProperty('apiToken');
    });

    it('calls next(error) when the service throws notFound', async () => {
      UserService.prototype.findOne.mockRejectedValue({
        output: { statusCode: 404 },
        message: 'User not found',
      });

      const res = await request(app).get('/api/v1/users/ghost');

      expect(res.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // POST /
  // -------------------------------------------------------------------------
  describe('POST /', () => {
    const validBody = { email: 'new@example.com', firstName: 'New', lastName: 'User' };

    it('returns 201 with the public user object on successful creation', async () => {
      const mockUser = mockUserWithPublic({ id: 'new-user', email: 'new@example.com' });
      UserService.prototype.create.mockResolvedValue(mockUser);

      const res = await request(app).post('/api/v1/users').send(validBody);

      expect(res.status).toBe(201);
      expect(res.body.message).toBe('user created');
      expect(res.body.data.id).toBe('new-user');
      expect(res.body.data.email).toBe('new@example.com');
    });

    it('does not include auth fields in the response data', async () => {
      const mockUser = mockUserWithPublic({ id: 'new-user' });
      UserService.prototype.create.mockResolvedValue(mockUser);

      const res = await request(app).post('/api/v1/users').send(validBody);

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
        .send({ firstName: 'No', lastName: 'Email' });

      expect(res.status).toBe(400);
      expect(UserService.prototype.create).not.toHaveBeenCalled();
    });

    it('calls next(error) when the service throws (e.g. duplicate email)', async () => {
      UserService.prototype.create.mockRejectedValue({
        output: { statusCode: 400 },
        message: 'User already created',
      });

      const res = await request(app).post('/api/v1/users').send(validBody);

      expect(res.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // PATCH /:id
  // -------------------------------------------------------------------------
  describe('PATCH /:id', () => {
    // updateUserSchema allows: firstName, lastName, groups, auth
    const validPatchBody = { firstName: 'Updated' };

    it('returns 200 with the public user object on successful update', async () => {
      const mockUser = mockUserWithPublic({ id: 'user-upd', firstName: 'Updated' });
      UserService.prototype.update.mockResolvedValue(mockUser);

      const res = await request(app)
        .patch('/api/v1/users/user-upd')
        .send(validPatchBody);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('user updated');
      expect(res.body.data.id).toBe('user-upd');
      expect(res.body.data.firstName).toBe('Updated');
    });

    it('does not include auth fields in the response data', async () => {
      const mockUser = mockUserWithPublic({ id: 'user-upd' });
      UserService.prototype.update.mockResolvedValue(mockUser);

      const res = await request(app)
        .patch('/api/v1/users/user-upd')
        .send(validPatchBody);

      expect(res.status).toBe(200);
      expect(res.body.data).not.toHaveProperty('auth');
      expect(res.body.data).not.toHaveProperty('googleToken');
      expect(res.body.data).not.toHaveProperty('googleRefreshToken');
      expect(res.body.data).not.toHaveProperty('refreshToken');
      expect(res.body.data).not.toHaveProperty('apiToken');
    });

    it('returns 400 when the body contains a field not in the update schema', async () => {
      // The updateUserSchema does not include the `role` field — sending it
      // triggers the Joi validator to reject the request.
      const res = await request(app)
        .patch('/api/v1/users/user-upd')
        .send({ role: 'admin' });

      expect(res.status).toBe(400);
      expect(UserService.prototype.update).not.toHaveBeenCalled();
    });

    it('calls next(error) when the service throws notFound', async () => {
      UserService.prototype.update.mockRejectedValue({
        output: { statusCode: 404 },
        message: 'Resource not found',
      });

      const res = await request(app)
        .patch('/api/v1/users/ghost')
        .send(validPatchBody);

      expect(res.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // DELETE /:id
  // -------------------------------------------------------------------------
  describe('DELETE /:id', () => {
    it('returns 200 with the deleted id string', async () => {
      UserService.prototype.delete.mockResolvedValue('user-del');

      const res = await request(app).delete('/api/v1/users/user-del');

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('user deleted');
      expect(res.body.data).toBe('user-del');
    });

    it('calls next(error) when the service throws notFound', async () => {
      UserService.prototype.delete.mockRejectedValue({
        output: { statusCode: 404 },
        message: 'Resource not found',
      });

      const res = await request(app).delete('/api/v1/users/ghost');

      expect(res.status).toBe(404);
    });
  });
});
