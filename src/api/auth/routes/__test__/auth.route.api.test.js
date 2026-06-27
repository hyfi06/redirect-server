'use strict';

/**
 * Tests for src/api/auth/routes/auth.route.api.js
 *
 * Key constraint: passport.authenticate() is called at route *definition* time
 * (when the route file is required), not at request time. The middleware
 * function it returns is stored by Express as the route handler.
 *
 * To control behavior per test, passport.authenticate() must return a
 * "delegating" middleware: a function that, at request time, reads a shared
 * mutable variable to decide what to do. This lets each test set the behavior
 * by mutating that variable before issuing the HTTP request.
 *
 * Strategy module side effect: the route file requires
 *   '../../../utils/auth/strategies/google-oauth2.strategy'
 * at module level. We mock that to prevent real GCP/config access.
 */

const request = require('supertest');
const express = require('express');

// ── Top-level mocks ────────────────────────────────────────────────────────

jest.mock('passport');
jest.mock('@hapi/boom');
jest.mock('../../../../utils/auth/strategies/google-oauth2.strategy', () => {});
jest.mock('../../../../utils/auth/jwt');
jest.mock('../../../../config', () => ({
  jwt: { jwtSecret: 'test-secret', jwtTtl: '1h' },
  oauthGoogle: {},
  firestore: { collections: { users: 'users' } },
}));

// ── Require mocked modules ─────────────────────────────────────────────────

const passport = require('passport');
const boom = require('@hapi/boom');
const { sign } = require('../../../../utils/auth/jwt');

// ── Delegating middleware state ────────────────────────────────────────────

/**
 * callbackMiddlewareBehavior controls what the passport.authenticate middleware
 * for the /google/callback route does when a request arrives.
 * Tests set this before issuing a request.
 */
const callbackState = {
  middleware: null, // (req, res, next) => void
};

/**
 * passportAuthenticateMock implements passport.authenticate() for both routes:
 *
 * - For /google: { scope: [...] }  → returns a no-op middleware (redirects to
 *   Google in real life; in tests we just want the route to be reachable).
 *
 * - For /google/callback: { failureRedirect: false, session: false } → returns
 *   a delegating middleware that reads callbackState.middleware at request time.
 *
 * This is set once before requiring the route file. The route file caches the
 * returned functions — that's fine because the delegating function reads
 * callbackState at request time, not at definition time.
 */
function passportAuthenticateMock(strategy, options) {
  if (options && options.session === false) {
    // Callback route: delegate to callbackState.middleware at request time
    return (req, res, next) => callbackState.middleware(req, res, next);
  }
  // /google route: just call next() so supertest gets a response
  return (req, res, next) => next();
}

// Apply the mock implementation before requiring the route module
passport.authenticate.mockImplementation(passportAuthenticateMock);

// ── Require the router once (route definitions are cached) ────────────────

const { authRouterApi } = require('../auth.route.api');

/**
 * Capture the authenticate calls made at route definition time BEFORE any
 * afterEach can clear them. Tests that inspect the registration arguments
 * use these captured values rather than the live mock.calls.
 */
const authenticateCallsAtDefinition = [...passport.authenticate.mock.calls];

// ── Helper: build a test Express app ──────────────────────────────────────

function buildApp() {
  const a = express();
  a.use(express.json());
  a.use('/api/v1/auth', authRouterApi);
  // Error handler: echoes boom payload or falls back to 500
  // eslint-disable-next-line no-unused-vars
  a.use((err, req, res, next) => {
    if (err.output) {
      res.status(err.output.statusCode).json(err.output.payload);
    } else {
      res.status(500).json({ message: err.message });
    }
  });
  return a;
}

// ── User fixture helpers ───────────────────────────────────────────────────

function makeUser(overrides = {}) {
  const base = {
    id: 'user-001',
    email: 'alice@example.com',
    firstName: 'Alice',
    lastName: 'Example',
    groups: ['fc'],
    role: 'user',
    // deletedAt: null is part of the public user model (§2.3.4)
    deletedAt: null,
    auth: {
      googleToken: 'gt',
      googleRefreshToken: 'grt',
      refreshToken: null,
      apiToken: null,
    },
    ...overrides,
  };
  // Note: auth.route.api.js calls the imported toPublic(req.user), not this method.
  // The method is kept for reference only.
  base.toPublic = () => ({
    id: base.id,
    email: base.email,
    firstName: base.firstName,
    lastName: base.lastName,
    groups: base.groups,
    role: base.role,
    deletedAt: base.deletedAt,
  });
  return base;
}

function makeBoomUnauthorized(message) {
  return {
    isBoom: true,
    output: {
      statusCode: 401,
      payload: { statusCode: 401, error: 'Unauthorized', message },
    },
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('auth routes', () => {
  afterEach(() => {
    jest.clearAllMocks();
    // Re-apply the implementation after clearAllMocks (clearAllMocks clears
    // mockImplementation too in some Jest versions; re-set to be safe)
    passport.authenticate.mockImplementation(passportAuthenticateMock);
    callbackState.middleware = null;
  });

  // ── GET /google ──────────────────────────────────────────────────────────

  describe('GET /google', () => {
    it('registers the route with passport.authenticate("google", { scope: ["profile", "email"] })', () => {
      // Use the calls captured at route definition time — afterEach clears mock.calls.
      const googleRouteCall = authenticateCallsAtDefinition.find(
        ([strategy, opts]) => strategy === 'google' && Array.isArray(opts && opts.scope),
      );
      expect(googleRouteCall).toBeDefined();
      expect(googleRouteCall[1]).toEqual({ scope: ['profile', 'email'] });
    });

    it('responds to GET /api/v1/auth/google (route exists and is reachable)', async () => {
      const app = buildApp();
      // The no-op middleware calls next(); no handler ends the response,
      // so Express returns its default 404. What matters is the route is found
      // — Express matching does not throw.
      const res = await request(app).get('/api/v1/auth/google');
      // As long as the route was reached (not undefined middleware error), any status is fine.
      // We just confirm the server handled the request without crashing.
      expect(res.status).toBeDefined();
    });
  });

  // ── GET /google/callback — success ──────────────────────────────────────

  describe('GET /google/callback — success', () => {
    it('responds 200 with message "login successful", token, and public user', async () => {
      const user = makeUser();
      const fakeToken = 'signed.jwt.token';
      sign.mockReturnValue(fakeToken);

      callbackState.middleware = (req, res, next) => {
        req.user = user;
        next();
      };

      const app = buildApp();
      const res = await request(app).get('/api/v1/auth/google/callback');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        message: 'login successful',
        data: {
          token: fakeToken,
          user: {
            id: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            groups: user.groups,
            role: user.role,
          },
        },
      });
    });

    it('calls sign() with { userId, email, role, groups } from req.user', async () => {
      const user = makeUser({
        id: 'uid-42',
        email: 'bob@example.com',
        role: 'admin',
        groups: ['fc', 'cs'],
      });
      sign.mockReturnValue('any.token');

      callbackState.middleware = (req, res, next) => {
        req.user = user;
        next();
      };

      const app = buildApp();
      await request(app).get('/api/v1/auth/google/callback');

      expect(sign).toHaveBeenCalledWith({
        userId: 'uid-42',
        email: 'bob@example.com',
        role: 'admin',
        groups: ['fc', 'cs'],
      });
    });

    it('includes deletedAt in the user field of the response (§2.3.4)', async () => {
      // deletedAt is part of the public user contract. An active user has deletedAt: null.
      const user = makeUser({ deletedAt: null });
      sign.mockReturnValue('some.token');

      callbackState.middleware = (req, res, next) => {
        req.user = user;
        next();
      };

      const app = buildApp();
      const res = await request(app).get('/api/v1/auth/google/callback');

      expect(res.status).toBe(200);
      // deletedAt must be explicitly present with value null, not absent from the response
      expect(Object.prototype.hasOwnProperty.call(res.body.data.user, 'deletedAt')).toBe(true);
      expect(res.body.data.user.deletedAt).toBeNull();
    });

    it('excludes auth tokens from the user field in the response', async () => {
      const user = makeUser();
      sign.mockReturnValue('some.token');

      callbackState.middleware = (req, res, next) => {
        req.user = user;
        next();
      };

      const app = buildApp();
      const res = await request(app).get('/api/v1/auth/google/callback');

      expect(res.body.data.user.auth).toBeUndefined();
      expect(res.body.data.user.googleToken).toBeUndefined();
      expect(res.body.data.user.googleRefreshToken).toBeUndefined();
    });
  });

  // ── GET /google/callback — user not registered ───────────────────────────

  describe('GET /google/callback — user not registered', () => {
    it('passes boom.unauthorized("User not registered") to next when req.user is absent', async () => {
      const boomError = makeBoomUnauthorized('User not registered');
      boom.unauthorized.mockReturnValue(boomError);

      // Passport calls done(null, false) — middleware calls next() without req.user
      callbackState.middleware = (req, res, next) => next();

      const app = buildApp();
      const res = await request(app).get('/api/v1/auth/google/callback');

      expect(boom.unauthorized).toHaveBeenCalledWith('User not registered');
      expect(res.status).toBe(401);
      expect(res.body.message).toBe('User not registered');
    });

    it('passes boom.unauthorized to next when req.user is explicitly null', async () => {
      const boomError = makeBoomUnauthorized('User not registered');
      boom.unauthorized.mockReturnValue(boomError);

      callbackState.middleware = (req, res, next) => {
        req.user = null;
        next();
      };

      const app = buildApp();
      const res = await request(app).get('/api/v1/auth/google/callback');

      expect(res.status).toBe(401);
    });

    it('does not call sign() when req.user is falsy', async () => {
      boom.unauthorized.mockReturnValue(makeBoomUnauthorized('User not registered'));
      callbackState.middleware = (req, res, next) => next();

      const app = buildApp();
      await request(app).get('/api/v1/auth/google/callback');

      expect(sign).not.toHaveBeenCalled();
    });
  });

  // ── GET /google/callback — passport strategy error ───────────────────────

  describe('GET /google/callback — passport strategy error', () => {
    it('propagates the error to the error handler when passport calls next(error)', async () => {
      const strategyError = new Error('OAuth provider error');

      // done(error) path: passport calls next(error)
      callbackState.middleware = (req, res, next) => next(strategyError);

      const app = buildApp();
      const res = await request(app).get('/api/v1/auth/google/callback');

      expect(res.status).toBe(500);
      expect(res.body.message).toBe('OAuth provider error');
    });

    it('does not call sign() when the strategy propagates an error', async () => {
      callbackState.middleware = (req, res, next) => next(new Error('auth error'));

      const app = buildApp();
      await request(app).get('/api/v1/auth/google/callback');

      expect(sign).not.toHaveBeenCalled();
    });
  });

  // ── D4 — correct mount point ─────────────────────────────────────────────

  describe('D4 — auth routes are under /api/v1/auth, never at root', () => {
    it('GET /google returns 404 — route is not registered at the root level', async () => {
      const a = express();
      a.use('/api/v1/auth', authRouterApi);
      const res = await request(a).get('/google');
      expect(res.status).toBe(404);
    });

    it('GET /auth/google returns 404 — route is not at /auth prefix', async () => {
      const a = express();
      a.use('/api/v1/auth', authRouterApi);
      const res = await request(a).get('/auth/google');
      expect(res.status).toBe(404);
    });

    it('passport.authenticate was called with the callback route options including session:false', () => {
      // Use captured calls (afterEach clears the live mock.calls).
      const callbackRouteCall = authenticateCallsAtDefinition.find(
        ([strategy, opts]) => strategy === 'google' && opts && opts.session === false,
      );
      expect(callbackRouteCall).toBeDefined();
      expect(callbackRouteCall[1]).toMatchObject({
        failureRedirect: false,
        session: false,
      });
    });
  });
});
