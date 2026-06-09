/**
 * Integration tests for src/api/groups/routes/group.route.api.js
 *
 * Strategy:
 * - `authenticate` is mocked at module level. The mock reads an x-test-user
 *   header to inject req.user, or calls next(boom.unauthorized()) when absent.
 * - GroupService and UserServices are fully mocked before the router is imported.
 * - A single Express app is built once for the whole suite.
 * - The error handler mirrors the one in the real app pipeline.
 */

const request = require('supertest');
const express = require('express');

// ---- Shared method bag exposed to test bodies ----
const mockGroupMethods = {
  getAll: jest.fn(),
  find: jest.fn(),
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

// ---- Mock GroupService ----
jest.mock('../../services/group.service.api', () => {
  return jest.fn().mockImplementation(() => mockGroupMethods);
});

// ---- Mock UserServices (only instantiated in the route module, never called directly in routes) ----
jest.mock('../../../users/services/user.service.api', () => {
  return jest.fn().mockImplementation(() => ({}));
});

// ---- Import the router after mocks are in place ----
const { groupRouterApi } = require('../group.route.api');

// ---- Minimal error handler matching the app's pipeline ----
function errorHandler(err, req, res, next) {
  if (err.isBoom) {
    const { statusCode, payload } = err.output;
    return res.status(statusCode).json(payload);
  }
  res.status(500).json({ statusCode: 500, error: 'Internal Server Error', message: err.message });
}

const app = express();
app.use(express.json());
app.use('/groups', groupRouterApi);
app.use(errorHandler);

// ---- Test users ----
const ADMIN_USER = { userId: 'admin-1', email: 'admin@test.com', role: 'admin', groups: [] };
const REGULAR_USER = { userId: 'user-1', email: 'user@test.com', role: 'user', groups: ['fc', 'cs'] };
const NO_GROUP_USER = { userId: 'user-3', email: 'nogroup@test.com', role: 'user', groups: [] };
const OTHER_USER = { userId: 'user-2', email: 'other@test.com', role: 'user', groups: ['math'] };

function userHeader(user) {
  return JSON.stringify(user);
}

// ---- Sample data ----
const SAMPLE_GROUP = {
  id: 'group-1',
  name: 'Facultad de Ciencias',
  slug: 'fc',
  users: ['user@test.com'],
};

afterEach(() => jest.clearAllMocks());

// ─────────────────────────────────────────────────────────────────────────────
// authenticate applied to every route
// ─────────────────────────────────────────────────────────────────────────────
describe('authenticate applied to all routes', () => {
  it('GET / returns 401 when no Authorization header is provided', async () => {
    const res = await request(app).get('/groups');
    expect(res.status).toBe(401);
  });

  it('GET /:id returns 401 when no Authorization header is provided', async () => {
    const res = await request(app).get('/groups/group-1');
    expect(res.status).toBe(401);
  });

  it('POST / returns 401 when no Authorization header is provided', async () => {
    const res = await request(app).post('/groups').send({ name: 'Test', slug: 'test' });
    expect(res.status).toBe(401);
  });

  it('PATCH /:id returns 401 when no Authorization header is provided', async () => {
    const res = await request(app).patch('/groups/group-1').send({ name: 'New Name' });
    expect(res.status).toBe(401);
  });

  it('DELETE /:id returns 401 when no Authorization header is provided', async () => {
    const res = await request(app).delete('/groups/group-1');
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /groups', () => {
  it('admin: calls getAll and returns all groups with 200', async () => {
    mockGroupMethods.getAll.mockResolvedValue([SAMPLE_GROUP]);
    const res = await request(app)
      .get('/groups')
      .set('x-test-user', userHeader(ADMIN_USER));
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('groups retrieved');
    expect(res.body.data).toEqual([SAMPLE_GROUP]);
    expect(mockGroupMethods.getAll).toHaveBeenCalledTimes(1);
    expect(mockGroupMethods.find).not.toHaveBeenCalled();
  });

  it('regular user with groups: calls find with slug in user.groups', async () => {
    mockGroupMethods.find.mockResolvedValue([SAMPLE_GROUP]);
    const res = await request(app)
      .get('/groups')
      .set('x-test-user', userHeader(REGULAR_USER));
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('groups retrieved');
    expect(mockGroupMethods.find).toHaveBeenCalledWith(
      ['slug', 'in', REGULAR_USER.groups],
      expect.any(Object)
    );
    expect(mockGroupMethods.getAll).not.toHaveBeenCalled();
  });

  it('user with no groups: returns { data: [] } without calling the service', async () => {
    const res = await request(app)
      .get('/groups')
      .set('x-test-user', userHeader(NO_GROUP_USER));
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('groups retrieved');
    expect(res.body.data).toEqual([]);
    expect(mockGroupMethods.find).not.toHaveBeenCalled();
    expect(mockGroupMethods.getAll).not.toHaveBeenCalled();
  });

  it('forwards service errors to the error handler', async () => {
    mockGroupMethods.getAll.mockRejectedValue(new Error('Firestore down'));
    const res = await request(app)
      .get('/groups')
      .set('x-test-user', userHeader(ADMIN_USER));
    expect(res.status).toBe(500);
  });

  it('rejects unknown query params with 400', async () => {
    const res = await request(app)
      .get('/groups?unknown=bad')
      .set('x-test-user', userHeader(ADMIN_USER));
    expect(res.status).toBe(400);
  });

  it('admin with offset and limit: calls getAll with parsed integers and returns 200', async () => {
    mockGroupMethods.getAll.mockResolvedValue([]);
    const res = await request(app)
      .get('/groups?offset=5&limit=10')
      .set('x-test-user', userHeader(ADMIN_USER));
    expect(res.status).toBe(200);
    expect(mockGroupMethods.getAll).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 5, limit: 10 }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /:id
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /groups/:id', () => {
  it('admin: returns any group with 200', async () => {
    mockGroupMethods.findOne.mockResolvedValue(SAMPLE_GROUP);
    const res = await request(app)
      .get('/groups/group-1')
      .set('x-test-user', userHeader(ADMIN_USER));
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('group retrieved');
    expect(res.body.data).toEqual(SAMPLE_GROUP);
  });

  it('user who belongs to the group: returns the group with 200', async () => {
    mockGroupMethods.findOne.mockResolvedValue(SAMPLE_GROUP); // slug: 'fc'
    const res = await request(app)
      .get('/groups/group-1')
      .set('x-test-user', userHeader(REGULAR_USER)); // groups: ['fc', 'cs']
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(SAMPLE_GROUP);
  });

  it('user who does not belong to the group: returns 403', async () => {
    mockGroupMethods.findOne.mockResolvedValue(SAMPLE_GROUP); // slug: 'fc'
    const res = await request(app)
      .get('/groups/group-1')
      .set('x-test-user', userHeader(OTHER_USER)); // groups: ['math']
    expect(res.status).toBe(403);
  });

  it('returns 404 when group is not found', async () => {
    const notFoundErr = {
      isBoom: true,
      output: { statusCode: 404, payload: { statusCode: 404, error: 'Not Found', message: 'Resource not found' } },
    };
    mockGroupMethods.findOne.mockRejectedValue(notFoundErr);
    const res = await request(app)
      .get('/groups/missing')
      .set('x-test-user', userHeader(ADMIN_USER));
    expect(res.status).toBe(404);
  });

  it('calls findOne with the id from the URL params', async () => {
    mockGroupMethods.findOne.mockResolvedValue(SAMPLE_GROUP);
    await request(app)
      .get('/groups/group-1')
      .set('x-test-user', userHeader(ADMIN_USER));
    expect(mockGroupMethods.findOne).toHaveBeenCalledWith('group-1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /groups', () => {
  it('admin creates a group and returns 201', async () => {
    mockGroupMethods.create.mockResolvedValue(SAMPLE_GROUP);
    const res = await request(app)
      .post('/groups')
      .set('x-test-user', userHeader(ADMIN_USER))
      .send({ name: 'Facultad de Ciencias', slug: 'fc' });
    expect(res.status).toBe(201);
    expect(res.body.message).toBe('group created');
    expect(res.body.data).toEqual(SAMPLE_GROUP);
  });

  it('non-admin receives 403 and service is not called', async () => {
    const res = await request(app)
      .post('/groups')
      .set('x-test-user', userHeader(REGULAR_USER))
      .send({ name: 'Facultad de Ciencias', slug: 'fc' });
    expect(res.status).toBe(403);
    expect(mockGroupMethods.create).not.toHaveBeenCalled();
  });

  it('returns 400 when name is absent from the body', async () => {
    const res = await request(app)
      .post('/groups')
      .set('x-test-user', userHeader(ADMIN_USER))
      .send({ slug: 'fc' });
    expect(res.status).toBe(400);
    expect(mockGroupMethods.create).not.toHaveBeenCalled();
  });

  it('returns 400 when slug is absent from the body', async () => {
    const res = await request(app)
      .post('/groups')
      .set('x-test-user', userHeader(ADMIN_USER))
      .send({ name: 'Test' });
    expect(res.status).toBe(400);
    expect(mockGroupMethods.create).not.toHaveBeenCalled();
  });

  it('returns 400 when slug is already taken', async () => {
    const boomErr = {
      isBoom: true,
      output: { statusCode: 400, payload: { statusCode: 400, error: 'Bad Request', message: 'Slug already taken' } },
    };
    mockGroupMethods.create.mockRejectedValue(boomErr);
    const res = await request(app)
      .post('/groups')
      .set('x-test-user', userHeader(ADMIN_USER))
      .send({ name: 'Test', slug: 'fc' });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Slug already taken');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /:id
// ─────────────────────────────────────────────────────────────────────────────
describe('PATCH /groups/:id', () => {
  it('admin updates name and returns 200', async () => {
    const updated = { ...SAMPLE_GROUP, name: 'New Name' };
    mockGroupMethods.update.mockResolvedValue(updated);
    const res = await request(app)
      .patch('/groups/group-1')
      .set('x-test-user', userHeader(ADMIN_USER))
      .send({ name: 'New Name' });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('group updated');
    expect(res.body.data).toEqual(updated);
  });

  it('admin updates users and returns 200', async () => {
    const updated = { ...SAMPLE_GROUP, users: ['a@test.com', 'b@test.com'] };
    mockGroupMethods.update.mockResolvedValue(updated);
    const res = await request(app)
      .patch('/groups/group-1')
      .set('x-test-user', userHeader(ADMIN_USER))
      .send({ users: ['a@test.com', 'b@test.com'] });
    expect(res.status).toBe(200);
    expect(res.body.data.users).toEqual(['a@test.com', 'b@test.com']);
  });

  it('returns 400 with "slug is immutable" when slug is in the body', async () => {
    const res = await request(app)
      .patch('/groups/group-1')
      .set('x-test-user', userHeader(ADMIN_USER))
      .send({ slug: 'new-slug' });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('slug is immutable');
    expect(mockGroupMethods.update).not.toHaveBeenCalled();
  });

  it('non-admin receives 403 and never reaches the slug check', async () => {
    const res = await request(app)
      .patch('/groups/group-1')
      .set('x-test-user', userHeader(REGULAR_USER))
      .send({ name: 'Hacked' });
    expect(res.status).toBe(403);
    expect(mockGroupMethods.update).not.toHaveBeenCalled();
  });

  it('non-admin sending slug receives 403 (authorize runs before slug check)', async () => {
    const res = await request(app)
      .patch('/groups/group-1')
      .set('x-test-user', userHeader(REGULAR_USER))
      .send({ slug: 'new-slug' });
    // authorize('admin') runs before the slug check in the handler
    expect(res.status).toBe(403);
  });

  it('returns 400 when body contains an invalid email in users', async () => {
    const res = await request(app)
      .patch('/groups/group-1')
      .set('x-test-user', userHeader(ADMIN_USER))
      .send({ users: ['not-an-email'] });
    expect(res.status).toBe(400);
    expect(mockGroupMethods.update).not.toHaveBeenCalled();
  });

  it('returns 404 when group is not found', async () => {
    const notFoundErr = {
      isBoom: true,
      output: { statusCode: 404, payload: { statusCode: 404, error: 'Not Found', message: 'Resource not found' } },
    };
    mockGroupMethods.update.mockRejectedValue(notFoundErr);
    const res = await request(app)
      .patch('/groups/missing')
      .set('x-test-user', userHeader(ADMIN_USER))
      .send({ name: 'Test' });
    expect(res.status).toBe(404);
  });

  it('accepts an empty body — all fields are optional in updateGroupSchema', async () => {
    const updated = SAMPLE_GROUP;
    mockGroupMethods.update.mockResolvedValue(updated);
    const res = await request(app)
      .patch('/groups/group-1')
      .set('x-test-user', userHeader(ADMIN_USER))
      .send({});
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /:id
// ─────────────────────────────────────────────────────────────────────────────
describe('DELETE /groups/:id', () => {
  it('admin deletes a group and returns 200 with { data: id }', async () => {
    mockGroupMethods.delete.mockResolvedValue('group-1');
    const res = await request(app)
      .delete('/groups/group-1')
      .set('x-test-user', userHeader(ADMIN_USER));
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('group deleted');
    expect(res.body.data).toBe('group-1');
  });

  it('non-admin receives 403 and service is not called', async () => {
    const res = await request(app)
      .delete('/groups/group-1')
      .set('x-test-user', userHeader(REGULAR_USER));
    expect(res.status).toBe(403);
    expect(mockGroupMethods.delete).not.toHaveBeenCalled();
  });

  it('returns 404 when group is not found', async () => {
    const notFoundErr = {
      isBoom: true,
      output: { statusCode: 404, payload: { statusCode: 404, error: 'Not Found', message: 'Resource not found' } },
    };
    mockGroupMethods.delete.mockRejectedValue(notFoundErr);
    const res = await request(app)
      .delete('/groups/missing')
      .set('x-test-user', userHeader(ADMIN_USER));
    expect(res.status).toBe(404);
  });

  it('calls delete with the id from the URL params', async () => {
    mockGroupMethods.delete.mockResolvedValue('group-42');
    await request(app)
      .delete('/groups/group-42')
      .set('x-test-user', userHeader(ADMIN_USER));
    expect(mockGroupMethods.delete).toHaveBeenCalledWith('group-42');
  });
});
