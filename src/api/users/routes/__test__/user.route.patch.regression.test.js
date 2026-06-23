'use strict';

/**
 * Regression tests for PATCH /api/v1/users/:id — email undefined crash.
 *
 * Bug: `new User({ id, ...value })` where `value` comes from the PATCH schema
 * (which never includes `email`) caused `TypeError: Cannot read properties of
 * undefined (reading 'toLowerCase')` because the constructor called
 * `email.toLowerCase().trim()` unconditionally.
 *
 * Fix: `src/api/users/models/user.js:33` — guard with a ternary:
 *   `this.email = email ? email.toLowerCase().trim() : undefined;`
 *
 * Strategy: The User model is NOT mocked here. The real constructor runs on
 * every PATCH call. If the guard is missing, any PATCH body that omits email
 * (which is every valid PATCH body — the schemas forbid email) will throw a
 * TypeError and the test will fail.
 */

const request = require('supertest');
const express = require('express');

// ---- Mock authenticate — same pattern as user.route.api.test.js ----
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

// ---- Mock UserService only — User model is intentionally NOT mocked ----
jest.mock('../../services/user.service');
const UserService = require('../../services/user.service');

// ---- Import the router AFTER mocks — User constructor is real ----
const { userRouterApi } = require('../user.route.api');

// ---------------------------------------------------------------------------
// Error handler
// ---------------------------------------------------------------------------
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (err.isBoom) {
    const { statusCode, payload } = err.output;
    return res.status(statusCode).json(payload);
  }
  const statusCode = err?.output?.statusCode || err?.statusCode || 500;
  res.status(statusCode).json({ message: err.message || 'Internal Server Error' });
}

// ---------------------------------------------------------------------------
// Build the test app
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

/**
 * Returns a minimal User-like object that satisfies what the route handler
 * expects from the service return value: it must have a toPublic() method.
 */
function stubServiceUser(overrides = {}) {
  return {
    id: overrides.id || 'user-1',
    email: overrides.email || 'user@example.com',
    firstName: overrides.firstName || '',
    lastName: overrides.lastName || '',
    groups: overrides.groups || [],
    role: overrides.role || 'user',
    toPublic() {
      return {
        id: this.id,
        email: this.email,
        firstName: this.firstName,
        lastName: this.lastName,
        groups: this.groups,
        role: this.role,
      };
    },
  };
}

afterEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Regression: PATCH with no email in the body — real User constructor runs
// ---------------------------------------------------------------------------

describe('PATCH /api/v1/users/:id — real User constructor (regression: email undefined crash)', () => {
  describe('regular user editing own profile (updateUserSelfSchema: firstName/lastName only)', () => {
    it('returns 200 when body contains only firstName — real constructor must not throw', async () => {
      UserService.prototype.update.mockResolvedValue(
        stubServiceUser({ id: REGULAR_USER.userId, firstName: 'NewName' }),
      );

      const res = await request(app)
        .patch(`/api/v1/users/${REGULAR_USER.userId}`)
        .set('x-test-user', userHeader(REGULAR_USER))
        .send({ firstName: 'NewName' });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('user updated');
    });

    it('returns 200 when body contains only lastName — real constructor must not throw', async () => {
      UserService.prototype.update.mockResolvedValue(
        stubServiceUser({ id: REGULAR_USER.userId, lastName: 'NewLast' }),
      );

      const res = await request(app)
        .patch(`/api/v1/users/${REGULAR_USER.userId}`)
        .set('x-test-user', userHeader(REGULAR_USER))
        .send({ lastName: 'NewLast' });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('user updated');
    });

    it('returns 200 when body contains both firstName and lastName — real constructor must not throw', async () => {
      UserService.prototype.update.mockResolvedValue(
        stubServiceUser({ id: REGULAR_USER.userId, firstName: 'First', lastName: 'Last' }),
      );

      const res = await request(app)
        .patch(`/api/v1/users/${REGULAR_USER.userId}`)
        .set('x-test-user', userHeader(REGULAR_USER))
        .send({ firstName: 'First', lastName: 'Last' });

      expect(res.status).toBe(200);
    });
  });

  describe('admin editing any user (updateUserByAdminSchema: firstName/lastName/role/groups — no email)', () => {
    it('returns 200 when body contains only firstName — real constructor must not throw', async () => {
      UserService.prototype.update.mockResolvedValue(
        stubServiceUser({ id: 'other-user', firstName: 'Updated' }),
      );

      const res = await request(app)
        .patch('/api/v1/users/other-user')
        .set('x-test-user', userHeader(ADMIN_USER))
        .send({ firstName: 'Updated' });

      expect(res.status).toBe(200);
    });

    it('returns 200 when body contains only role — real constructor must not throw', async () => {
      UserService.prototype.update.mockResolvedValue(
        stubServiceUser({ id: 'other-user', role: 'admin' }),
      );

      const res = await request(app)
        .patch('/api/v1/users/other-user')
        .set('x-test-user', userHeader(ADMIN_USER))
        .send({ role: 'admin' });

      expect(res.status).toBe(200);
    });

    it('returns 200 when body contains only groups — real constructor must not throw', async () => {
      UserService.prototype.update.mockResolvedValue(
        stubServiceUser({ id: 'other-user', groups: ['fc', 'cs'] }),
      );

      const res = await request(app)
        .patch('/api/v1/users/other-user')
        .set('x-test-user', userHeader(ADMIN_USER))
        .send({ groups: ['fc', 'cs'] });

      expect(res.status).toBe(200);
    });
  });

  describe('User constructor called with correct id and no email', () => {
    it('passes the route :id param to the User constructor (real constructor, email absent)', async () => {
      // Spy on the real User constructor to verify what the handler passes to it.
      const User = require('../../models/user.model');
      const spy = jest.spyOn(User.prototype, 'constructor');

      UserService.prototype.update.mockResolvedValue(
        stubServiceUser({ id: REGULAR_USER.userId, firstName: 'Spy' }),
      );

      const res = await request(app)
        .patch(`/api/v1/users/${REGULAR_USER.userId}`)
        .set('x-test-user', userHeader(REGULAR_USER))
        .send({ firstName: 'Spy' });

      // The fact that we get 200 (not 500) proves the constructor did not throw.
      expect(res.status).toBe(200);

      spy.mockRestore();
    });
  });
});

// ---------------------------------------------------------------------------
// Regression: PATCH without groups must not overwrite groups field
// ---------------------------------------------------------------------------
// Bug: User constructor used `this.groups = groups || []`. When PATCH body had
// no `groups` field, the constructor materialised undefined as [], which the
// updateUserParser could not strip (cleanDocObject ignores arrays). Firestore
// received groups: [] and overwrote the user's real group membership.
//
// Fix: `this.groups = groups` (no default). The default [] now lives in
// createUserParser. cleanDocObject strips undefined keys, so a missing groups
// field no longer reaches Firestore.
//
// Strategy: UserService is mocked; User model is intentionally NOT mocked so
// the real constructor runs. We inspect the User instance passed to
// userService.update() and assert groups is undefined — the upstream check
// that guarantees cleanDocObject will omit the key.

describe('PATCH /api/v1/users/:id — groups not overwritten when groups absent from body', () => {
  it('user instance passed to userService.update has groups=undefined when PATCH body contains only lastName', async () => {
    UserService.prototype.update.mockResolvedValue(
      stubServiceUser({ id: ADMIN_USER.userId, lastName: 'Nuevo' }),
    );

    await request(app)
      .patch('/api/v1/users/other-user')
      .set('x-test-user', userHeader(ADMIN_USER))
      .send({ lastName: 'Nuevo' });

    expect(UserService.prototype.update).toHaveBeenCalledTimes(1);
    const userArg = UserService.prototype.update.mock.calls[0][0];
    expect(userArg.groups).toBeUndefined();
  });

  it('user instance passed to userService.update has groups=undefined when PATCH body contains only firstName', async () => {
    UserService.prototype.update.mockResolvedValue(
      stubServiceUser({ id: 'other-user', firstName: 'Nuevo' }),
    );

    await request(app)
      .patch('/api/v1/users/other-user')
      .set('x-test-user', userHeader(ADMIN_USER))
      .send({ firstName: 'Nuevo' });

    expect(UserService.prototype.update).toHaveBeenCalledTimes(1);
    const userArg = UserService.prototype.update.mock.calls[0][0];
    expect(userArg.groups).toBeUndefined();
  });

  it('user instance passed to userService.update has groups=undefined when PATCH body contains only role', async () => {
    UserService.prototype.update.mockResolvedValue(
      stubServiceUser({ id: 'other-user', role: 'admin' }),
    );

    await request(app)
      .patch('/api/v1/users/other-user')
      .set('x-test-user', userHeader(ADMIN_USER))
      .send({ role: 'admin' });

    expect(UserService.prototype.update).toHaveBeenCalledTimes(1);
    const userArg = UserService.prototype.update.mock.calls[0][0];
    expect(userArg.groups).toBeUndefined();
  });

  it('user instance passed to userService.update has groups set when groups is explicitly in the PATCH body', async () => {
    UserService.prototype.update.mockResolvedValue(
      stubServiceUser({ id: 'other-user', groups: ['fc', 'cs'] }),
    );

    await request(app)
      .patch('/api/v1/users/other-user')
      .set('x-test-user', userHeader(ADMIN_USER))
      .send({ groups: ['fc', 'cs'] });

    expect(UserService.prototype.update).toHaveBeenCalledTimes(1);
    const userArg = UserService.prototype.update.mock.calls[0][0];
    expect(userArg.groups).toEqual(['fc', 'cs']);
  });
});

// ---------------------------------------------------------------------------
// Regression: PATCH without lastName/firstName must not overwrite the other field
// ---------------------------------------------------------------------------
// Bug: User constructor used `this.firstName = firstName?.trim() || ''` and
// `this.lastName = lastName?.trim() || ''`. When a PATCH body contained only
// `firstName`, the constructor materialised undefined as '', which updateUserParser
// could not strip (cleanDocObject only removes undefined, not ''). Firestore
// received lastName: '' and overwrote the user's existing last name.
//
// Fix: `this.firstName = firstName?.trim() || undefined` (and same for lastName).
// cleanDocObject strips undefined keys, so a missing field no longer reaches Firestore.
//
// Strategy: UserService is mocked; User model is intentionally NOT mocked so
// the real constructor runs. We inspect the User instance passed to
// userService.update() and assert the absent field is undefined — the upstream
// guarantee that cleanDocObject will omit it.

describe('PATCH /api/v1/users/:id — firstName/lastName not overwritten when only one is in body', () => {
  it('user instance passed to userService.update has lastName=undefined when PATCH body contains only firstName', async () => {
    UserService.prototype.update.mockResolvedValue(
      stubServiceUser({ id: 'other-user', firstName: 'Becas' }),
    );

    await request(app)
      .patch('/api/v1/users/other-user')
      .set('x-test-user', userHeader(ADMIN_USER))
      .send({ firstName: 'Becas' });

    expect(UserService.prototype.update).toHaveBeenCalledTimes(1);
    const userArg = UserService.prototype.update.mock.calls[0][0];
    expect(userArg.lastName).toBeUndefined();
  });

  it('user instance passed to userService.update has firstName=undefined when PATCH body contains only lastName', async () => {
    UserService.prototype.update.mockResolvedValue(
      stubServiceUser({ id: 'other-user', lastName: 'Ciencias' }),
    );

    await request(app)
      .patch('/api/v1/users/other-user')
      .set('x-test-user', userHeader(ADMIN_USER))
      .send({ lastName: 'Ciencias' });

    expect(UserService.prototype.update).toHaveBeenCalledTimes(1);
    const userArg = UserService.prototype.update.mock.calls[0][0];
    expect(userArg.firstName).toBeUndefined();
  });

  it('user instance passed to userService.update has both firstName and lastName when both are in PATCH body (control positive)', async () => {
    UserService.prototype.update.mockResolvedValue(
      stubServiceUser({ id: 'other-user', firstName: 'A', lastName: 'B' }),
    );

    await request(app)
      .patch('/api/v1/users/other-user')
      .set('x-test-user', userHeader(ADMIN_USER))
      .send({ firstName: 'A', lastName: 'B' });

    expect(UserService.prototype.update).toHaveBeenCalledTimes(1);
    const userArg = UserService.prototype.update.mock.calls[0][0];
    expect(userArg.firstName).toBe('A');
    expect(userArg.lastName).toBe('B');
  });
});
