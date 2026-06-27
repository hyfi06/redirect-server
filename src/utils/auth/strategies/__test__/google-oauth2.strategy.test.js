'use strict';

/**
 * Tests for src/utils/auth/strategies/google-oauth2.strategy.js
 *
 * The module registers a GoogleStrategy with passport at require-time and
 * instantiates UserService at module level. We use jest.resetModules() before
 * each group so that each require gets a fresh module with fresh mocks.
 *
 * Extraction pattern:
 *   passport.use is called with a GoogleStrategy instance.
 *   The verify callback is stored at instance._verify.
 *   passport.use.mock.calls[0][0]._verify  →  the async verify function.
 */

jest.mock('passport');
jest.mock('../../../../api/users/services/user.service');
jest.mock('../../../../config', () => ({
  oauthGoogle: {
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    oauthRedirect: 'http://localhost/callback',
  },
  // groups and redirects are required because loading google-oauth2.strategy.js now
  // triggers src/lib/services.js, which instantiates GroupService and RedirectServiceApi.
  // Both call firestoreClient.collection() with these names — undefined would throw.
  firestore: { collections: { users: 'users', groups: 'groups', redirects: 'redirects' } },
}));

const passport = require('passport');
const UserService = require('../../../../api/users/services/user.service');

// ─── helpers ────────────────────────────────────────────────────────────────

/** Build a minimal Google profile object. */
function makeProfile(email = 'test@example.com') {
  return { emails: [{ value: email }] };
}

/**
 * Build a User-like object as returned by userService.getByEmail().
 */
function makeStoredUser(overrides = {}) {
  return {
    id: 'user-001',
    email: 'test@example.com',
    firstName: 'Test',
    lastName: 'User',
    groups: ['g1'],
    role: 'user',
    ...overrides,
  };
}

/** Extract the verify callback from passport.use mock. */
function getVerifyCallback() {
  return passport.use.mock.calls[0][0]._verify;
}

// ─── setup ──────────────────────────────────────────────────────────────────

describe('google-oauth2 strategy verify callback', () => {
  let mockGetByEmail;
  let verify;
  let done;

  beforeEach(() => {
    jest.resetModules();

    mockGetByEmail = jest.fn();

    const UserServiceMock = require('../../../../api/users/services/user.service');
    UserServiceMock.mockImplementation(() => ({
      getByEmail: mockGetByEmail,
    }));

    // Re-require passport so mock.calls is fresh.
    const passportMock = require('passport');
    passportMock.use.mockClear();

    // Require the strategy — this executes passport.use(new GoogleStrategy(...))
    require('../google-oauth2.strategy');

    verify = passportMock.use.mock.calls[0][0]._verify;
    done = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── 1. User not registered ────────────────────────────────────────────────

  it('calls done(null, false, message) when getByEmail throws a 404', async () => {
    const notFoundError = { output: { statusCode: 404 } };
    mockGetByEmail.mockRejectedValue(notFoundError);

    await verify({}, 'access-token', 'refresh-token', makeProfile(), done);

    expect(done).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledWith(null, false, {
      message: 'User not registered',
    });
  });

  // ── 2. Successful login ───────────────────────────────────────────────────

  it('calls done(null, user) with the stored user on successful login', async () => {
    const storedUser = makeStoredUser();
    mockGetByEmail.mockResolvedValue(storedUser);

    await verify({}, 'new-token', 'new-refresh', makeProfile(), done);

    expect(done).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledWith(null, storedUser);
  });

  // ── 3. Non-404 error in getByEmail ────────────────────────────────────────

  it('calls done(error) when getByEmail throws a non-404 error', async () => {
    const serverError = { output: { statusCode: 500 }, message: 'Internal' };
    mockGetByEmail.mockRejectedValue(serverError);

    await verify({}, 'access-token', 'refresh-token', makeProfile(), done);

    expect(done).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledWith(serverError);
  });

  it('does not call done(null, false) when getByEmail throws a non-404 error', async () => {
    const serverError = { output: { statusCode: 500 } };
    mockGetByEmail.mockRejectedValue(serverError);

    await verify({}, 'access-token', 'refresh-token', makeProfile(), done);

    expect(done.mock.calls[0][1]).not.toBe(false);
  });

  it('calls done(error) when getByEmail throws an error with no output property', async () => {
    const bareError = new Error('unexpected');
    mockGetByEmail.mockRejectedValue(bareError);

    await verify({}, 'access-token', 'refresh-token', makeProfile(), done);

    expect(done).toHaveBeenCalledWith(bareError);
  });
});
