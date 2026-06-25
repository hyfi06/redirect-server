'use strict';

/**
 * Tests for src/utils/auth/strategies/google-oauth2.strategy.js
 *
 * The module registers a GoogleStrategy with passport at require-time and
 * instantiates UserService and AuthTokenService at module level. We use
 * jest.resetModules() before each group so that each require gets a fresh
 * module with fresh mocks.
 *
 * Extraction pattern:
 *   passport.use is called with a GoogleStrategy instance.
 *   The verify callback is stored at instance._verify.
 *   passport.use.mock.calls[0][0]._verify  →  the async verify function.
 */

jest.mock('passport');
jest.mock('../../../../api/users/services/user.service');
jest.mock('../../../../api/users/services/auth-token.service');
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
const AuthTokenService = require('../../../../api/users/services/auth-token.service');

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
  let mockWrite;
  let verify;
  let done;

  beforeEach(() => {
    jest.resetModules();

    mockGetByEmail = jest.fn();
    mockWrite = jest.fn();

    const UserServiceMock = require('../../../../api/users/services/user.service');
    UserServiceMock.mockImplementation(() => ({
      getByEmail: mockGetByEmail,
    }));

    const AuthTokenServiceMock = require('../../../../api/users/services/auth-token.service');
    AuthTokenServiceMock.mockImplementation(() => ({
      write: mockWrite,
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

  it('does not call authTokenService.write when getByEmail throws a 404', async () => {
    mockGetByEmail.mockRejectedValue({ output: { statusCode: 404 } });

    await verify({}, 'access-token', 'refresh-token', makeProfile(), done);

    expect(mockWrite).not.toHaveBeenCalled();
  });

  // ── 2. Successful login ───────────────────────────────────────────────────

  it('calls done(null, user) with the stored user on successful login', async () => {
    const storedUser = makeStoredUser();
    mockGetByEmail.mockResolvedValue(storedUser);
    mockWrite.mockResolvedValue(undefined);

    await verify({}, 'new-token', 'new-refresh', makeProfile(), done);

    expect(done).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledWith(null, storedUser);
  });

  it('calls authTokenService.write with googleToken and googleRefreshToken', async () => {
    const storedUser = makeStoredUser();
    mockGetByEmail.mockResolvedValue(storedUser);
    mockWrite.mockResolvedValue(undefined);

    await verify({}, 'new-access', 'new-refresh', makeProfile(), done);

    expect(mockWrite).toHaveBeenCalledTimes(1);
    expect(mockWrite).toHaveBeenCalledWith('user-001', {
      googleToken: 'new-access',
      googleRefreshToken: 'new-refresh',
    });
  });

  it('calls authTokenService.write with the user id from getByEmail', async () => {
    const storedUser = makeStoredUser({ id: 'uid-special' });
    mockGetByEmail.mockResolvedValue(storedUser);
    mockWrite.mockResolvedValue(undefined);

    await verify({}, 'tok', 'ref', makeProfile(), done);

    expect(mockWrite.mock.calls[0][0]).toBe('uid-special');
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

  // ── 4. Error in authTokenService.write ───────────────────────────────────

  it('calls done(error) when authTokenService.write throws after a successful getByEmail', async () => {
    const writeError = new Error('Firestore write failed');
    mockGetByEmail.mockResolvedValue(makeStoredUser());
    mockWrite.mockRejectedValue(writeError);

    await verify({}, 'access-token', 'refresh-token', makeProfile(), done);

    expect(done).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledWith(writeError);
  });

  it('does not call done(null, ...) when authTokenService.write throws', async () => {
    mockGetByEmail.mockResolvedValue(makeStoredUser());
    mockWrite.mockRejectedValue(new Error('write error'));

    await verify({}, 'access-token', 'refresh-token', makeProfile(), done);

    expect(done.mock.calls[0][1]).not.toBeDefined();
    // done is called with a single argument (the error)
    expect(done.mock.calls[0].length).toBe(1);
  });
});
