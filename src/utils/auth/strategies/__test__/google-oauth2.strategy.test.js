'use strict';

/**
 * Tests for src/utils/auth/strategies/google-oauth2.strategy.js
 *
 * The module registers a GoogleStrategy with passport at require-time and
 * instantiates UserServices at module level. We use jest.resetModules()
 * before each group so that each require gets a fresh module with fresh mocks.
 *
 * Extraction pattern:
 *   passport.use is called with a GoogleStrategy instance.
 *   The verify callback is stored at instance._verify.
 *   passport.use.mock.calls[0][0]._verify  →  the async verify function.
 */

jest.mock('passport');
jest.mock('../../../../api/users/services/user.service.api');
jest.mock('../../../../config', () => ({
  oauthGoogle: {
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    oauthRedirect: 'http://localhost/callback',
  },
  firestore: { collections: { users: 'users' } },
}));

const passport = require('passport');
const UserServices = require('../../../../api/users/services/user.service.api');

// ─── helpers ────────────────────────────────────────────────────────────────

/** Build a minimal Google profile object. */
function makeProfile(email = 'test@example.com') {
  return { emails: [{ value: email }] };
}

/**
 * Build a User-like object as returned by userService.getByEmail().
 * The real docParser returns a User instance, so auth is nested.
 */
function makeStoredUser(overrides = {}) {
  return {
    id: 'user-001',
    email: 'test@example.com',
    firstName: 'Test',
    lastName: 'User',
    groups: ['g1'],
    role: 'user',
    auth: {
      googleToken: 'old-google-token',
      googleRefreshToken: 'old-google-refresh',
      refreshToken: 'old-refresh-token',
      apiToken: 'old-api-token',
    },
    ...overrides,
  };
}

/** Extract the verify callback from passport.use mock. */
function getVerifyCallback() {
  // passport.use is called with a GoogleStrategy instance whose _verify
  // property holds the async callback passed as the second argument.
  return passport.use.mock.calls[0][0]._verify;
}

// ─── setup ──────────────────────────────────────────────────────────────────

describe('google-oauth2 strategy verify callback', () => {
  let mockGetByEmail;
  let mockUpdate;
  let verify;
  let done;

  beforeEach(() => {
    jest.resetModules();

    mockGetByEmail = jest.fn();
    mockUpdate = jest.fn();

    // UserServices is mocked at the top of the file.
    // After resetModules we re-require it and set the prototype mock impl.
    const UserServicesMock = require('../../../../api/users/services/user.service.api');
    UserServicesMock.mockImplementation(() => ({
      getByEmail: mockGetByEmail,
      update: mockUpdate,
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

  it('does not call update when getByEmail throws a 404', async () => {
    mockGetByEmail.mockRejectedValue({ output: { statusCode: 404 } });

    await verify({}, 'access-token', 'refresh-token', makeProfile(), done);

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  // ── 2. Successful login ───────────────────────────────────────────────────

  it('calls done(null, savedUser) on successful login', async () => {
    const storedUser = makeStoredUser();
    const savedUser = { ...storedUser, auth: { googleToken: 'new-token' } };

    mockGetByEmail.mockResolvedValue(storedUser);
    mockUpdate.mockResolvedValue(savedUser);

    await verify({}, 'new-token', 'new-refresh', makeProfile(), done);

    expect(done).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledWith(null, savedUser);
  });

  it('calls update with a User containing the new googleToken and googleRefreshToken', async () => {
    const storedUser = makeStoredUser();
    mockGetByEmail.mockResolvedValue(storedUser);
    mockUpdate.mockResolvedValue(storedUser);

    await verify({}, 'new-access', 'new-refresh', makeProfile(), done);

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const updatedUser = mockUpdate.mock.calls[0][0];
    expect(updatedUser.auth.googleToken).toBe('new-access');
    expect(updatedUser.auth.googleRefreshToken).toBe('new-refresh');
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

    // done must have been called with the error, not (null, false, ...)
    expect(done.mock.calls[0][1]).not.toBe(false);
  });

  it('calls done(error) when getByEmail throws an error with no output property', async () => {
    const bareError = new Error('unexpected');
    mockGetByEmail.mockRejectedValue(bareError);

    await verify({}, 'access-token', 'refresh-token', makeProfile(), done);

    expect(done).toHaveBeenCalledWith(bareError);
  });

  // ── 4. Error in update ────────────────────────────────────────────────────

  it('calls done(error) when update throws after a successful getByEmail', async () => {
    const updateError = new Error('Firestore write failed');
    mockGetByEmail.mockResolvedValue(makeStoredUser());
    mockUpdate.mockRejectedValue(updateError);

    await verify({}, 'access-token', 'refresh-token', makeProfile(), done);

    expect(done).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledWith(updateError);
  });

  it('does not call done(null, ...) when update throws', async () => {
    mockGetByEmail.mockResolvedValue(makeStoredUser());
    mockUpdate.mockRejectedValue(new Error('write error'));

    await verify({}, 'access-token', 'refresh-token', makeProfile(), done);

    expect(done.mock.calls[0][1]).not.toBeDefined();
    // done is called with a single argument (the error)
    expect(done.mock.calls[0].length).toBe(1);
  });

  // ── 5. Preservation of existing tokens ───────────────────────────────────

  it('preserves existing refreshToken and apiToken in the User passed to update', async () => {
    const storedUser = makeStoredUser({
      auth: {
        googleToken: 'old-google',
        googleRefreshToken: 'old-google-refresh',
        refreshToken: 'keep-this-refresh',
        apiToken: 'keep-this-api',
      },
    });
    mockGetByEmail.mockResolvedValue(storedUser);
    mockUpdate.mockResolvedValue(storedUser);

    await verify({}, 'brand-new-access', 'brand-new-refresh', makeProfile(), done);

    const updatedUser = mockUpdate.mock.calls[0][0];
    // The internal JWT refresh token and API token must survive the update
    expect(updatedUser.auth.refreshToken).toBe('keep-this-refresh');
    expect(updatedUser.auth.apiToken).toBe('keep-this-api');
  });

  it('overwrites googleToken and googleRefreshToken while preserving other tokens', async () => {
    const storedUser = makeStoredUser({
      auth: {
        googleToken: 'stale-google',
        googleRefreshToken: 'stale-google-refresh',
        refreshToken: 'my-refresh',
        apiToken: 'my-api',
      },
    });
    mockGetByEmail.mockResolvedValue(storedUser);
    mockUpdate.mockResolvedValue(storedUser);

    await verify({}, 'fresh-google', 'fresh-google-refresh', makeProfile(), done);

    const updatedUser = mockUpdate.mock.calls[0][0];
    expect(updatedUser.auth.googleToken).toBe('fresh-google');
    expect(updatedUser.auth.googleRefreshToken).toBe('fresh-google-refresh');
    expect(updatedUser.auth.refreshToken).toBe('my-refresh');
    expect(updatedUser.auth.apiToken).toBe('my-api');
  });
});
