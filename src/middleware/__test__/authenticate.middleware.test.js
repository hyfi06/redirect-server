const crypto = require('crypto');
const boom = require('@hapi/boom');

jest.mock('@hapi/boom');
jest.mock('../../utils/auth/jwt');
jest.mock('../../api/users/services/api-key.service');
jest.mock('../../api/users/services/user.service');
jest.mock('../../utils/cache', () => ({
  nodeCache: {
    get: jest.fn(),
    set: jest.fn(),
  },
  setClientCache: jest.fn(),
}));

const jwt = require('../../utils/auth/jwt');
const ApiKeyService = require('../../api/users/services/api-key.service');
const UserService = require('../../api/users/services/user.service');
const { nodeCache } = require('../../utils/cache');
const { authenticate } = require('../authenticate.middleware');

// Capture the service instances created by src/lib/services.js at require()-time.
// services.js creates two UserService instances: userServiceForGroup (index 0, internal)
// and userService (index 1, the one authenticate.middleware.js actually calls).
// Must be captured once, before any afterEach clearAllMocks() runs.
const apiKeyServiceInstance = ApiKeyService.mock.instances[0];
const userServiceInstance = UserService.mock.instances[1];

describe('authenticate middleware', () => {
  let mockNext;
  let mockRes;

  beforeEach(() => {
    mockNext = jest.fn();
    mockRes = {};

    boom.unauthorized.mockReturnValue({
      isBoom: true,
      output: { statusCode: 401, payload: { error: 'Unauthorized' } },
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('missing or malformed Authorization header', () => {
    it('calls next with boom.unauthorized when Authorization header is absent', () => {
      const req = { headers: {} };

      authenticate(req, mockRes, mockNext);

      expect(boom.unauthorized).toHaveBeenCalledWith('Missing token');
      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockNext).toHaveBeenCalledWith(boom.unauthorized());
    });

    it('calls next with boom.unauthorized when header does not start with "Bearer "', () => {
      const req = { headers: { authorization: 'Basic dXNlcjpwYXNz' } };

      authenticate(req, mockRes, mockNext);

      expect(boom.unauthorized).toHaveBeenCalledWith('Missing token');
      expect(mockNext).toHaveBeenCalledWith(boom.unauthorized());
    });

    it('calls next with boom.unauthorized when header is the bare string "Bearer" without a space', () => {
      const req = { headers: { authorization: 'Bearer' } };

      authenticate(req, mockRes, mockNext);

      expect(boom.unauthorized).toHaveBeenCalledWith('Missing token');
      expect(mockNext).toHaveBeenCalledWith(boom.unauthorized());
    });

    it('does not call jwt.verify when the header is missing', () => {
      const req = { headers: {} };

      authenticate(req, mockRes, mockNext);

      expect(jwt.verify).not.toHaveBeenCalled();
    });
  });

  describe('valid token', () => {
    it('sets req.user to the decoded payload and calls next() with no arguments', () => {
      const payload = { id: 'user-1', role: 'admin' };
      jwt.verify.mockReturnValue(payload);
      const req = { headers: { authorization: 'Bearer valid.token.here' } };

      authenticate(req, mockRes, mockNext);

      expect(jwt.verify).toHaveBeenCalledWith('valid.token.here');
      expect(req.user).toBe(payload);
      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockNext).toHaveBeenCalledWith();
    });

    it('strips exactly the "Bearer " prefix (7 chars) before passing the token to verify', () => {
      jwt.verify.mockReturnValue({ id: 'user-1' });
      const rawToken = 'abc.def.ghi';
      const req = { headers: { authorization: `Bearer ${rawToken}` } };

      authenticate(req, mockRes, mockNext);

      expect(jwt.verify).toHaveBeenCalledWith(rawToken);
    });

    it('does not call boom.unauthorized when the token is valid', () => {
      jwt.verify.mockReturnValue({ id: 'user-1' });
      const req = { headers: { authorization: 'Bearer valid.token' } };

      authenticate(req, mockRes, mockNext);

      expect(boom.unauthorized).not.toHaveBeenCalled();
    });
  });

  describe('invalid or expired token', () => {
    it('calls next with boom.unauthorized when jwt.verify throws', () => {
      jwt.verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });
      const req = { headers: { authorization: 'Bearer expired.token' } };

      authenticate(req, mockRes, mockNext);

      expect(boom.unauthorized).toHaveBeenCalledWith('Invalid token');
      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockNext).toHaveBeenCalledWith(boom.unauthorized());
    });

    it('does not set req.user when jwt.verify throws', () => {
      jwt.verify.mockImplementation(() => {
        throw new Error('invalid signature');
      });
      const req = { headers: { authorization: 'Bearer tampered.token' } };

      authenticate(req, mockRes, mockNext);

      expect(req.user).toBeUndefined();
    });

    it('calls next exactly once when the token is invalid', () => {
      jwt.verify.mockImplementation(() => {
        throw new Error('jwt malformed');
      });
      const req = { headers: { authorization: 'Bearer bad.token' } };

      authenticate(req, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
    });
  });
});

describe('authenticate — API Key path', () => {
  let mockNext;
  let mockRes;

  const TOKEN = 'sk_1kg_testtokenvalue';
  const KEY_HASH = crypto.createHash('sha256').update(TOKEN).digest('hex');

  const ACTIVE_KEY = {
    id: 'key-id-1',
    active: true,
    expiresAt: null,
    scopes: ['redirect:read'],
    keyHash: KEY_HASH,
  };

  const STORED_USER = {
    id: 'user-id-1',
    email: 'alice@example.com',
    role: 'user',
    groups: ['fc'],
  };

  beforeEach(() => {
    mockNext = jest.fn();
    mockRes = {};

    boom.unauthorized.mockReturnValue({
      isBoom: true,
      output: { statusCode: 401, payload: { error: 'Unauthorized' } },
    });

    nodeCache.get.mockReturnValue(undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('uses cached req.user and skips findByHash when the cache has an entry for the key hash', async () => {
    const cachedUser = {
      userId: 'user-id-1',
      email: 'alice@example.com',
      role: 'user',
      groups: ['fc'],
      apiKey: { id: 'key-id-1', scopes: ['redirect:read'] },
    };
    nodeCache.get.mockReturnValue(cachedUser);

    const req = { headers: { authorization: `Bearer ${TOKEN}` } };
    authenticate(req, mockRes, mockNext);

    await new Promise(setImmediate);

    expect(apiKeyServiceInstance.findByHash).not.toHaveBeenCalled();
    expect(req.user).toBe(cachedUser);
    expect(mockNext).toHaveBeenCalledWith();
  });

  it('calls next with boom.unauthorized when findByHash returns null (key not found)', async () => {
    apiKeyServiceInstance.findByHash.mockResolvedValue(null);

    const req = { headers: { authorization: `Bearer ${TOKEN}` } };
    authenticate(req, mockRes, mockNext);

    await new Promise(setImmediate);

    expect(boom.unauthorized).toHaveBeenCalledWith('Invalid API key');
    expect(mockNext).toHaveBeenCalledWith(
      expect.objectContaining({ isBoom: true, output: expect.objectContaining({ statusCode: 401 }) })
    );
  });

  it('calls next with boom.unauthorized when the key exists but active is false', async () => {
    apiKeyServiceInstance.findByHash.mockResolvedValue({
      apiKey: { ...ACTIVE_KEY, active: false },
      userId: STORED_USER.id,
    });

    const req = { headers: { authorization: `Bearer ${TOKEN}` } };
    authenticate(req, mockRes, mockNext);

    await new Promise(setImmediate);

    expect(boom.unauthorized).toHaveBeenCalledWith('API key revoked');
    expect(mockNext).toHaveBeenCalledWith(
      expect.objectContaining({ isBoom: true, output: expect.objectContaining({ statusCode: 401 }) })
    );
  });

  it('calls next with boom.unauthorized when the key is active but expiresAt is in the past', async () => {
    const pastDate = new Date(Date.now() - 1000);
    apiKeyServiceInstance.findByHash.mockResolvedValue({
      apiKey: { ...ACTIVE_KEY, active: true, expiresAt: pastDate },
      userId: STORED_USER.id,
    });

    const req = { headers: { authorization: `Bearer ${TOKEN}` } };
    authenticate(req, mockRes, mockNext);

    await new Promise(setImmediate);

    expect(boom.unauthorized).toHaveBeenCalledWith('API key expired');
    expect(mockNext).toHaveBeenCalledWith(
      expect.objectContaining({ isBoom: true, output: expect.objectContaining({ statusCode: 401 }) })
    );
  });

  it('succeeds when expiresAt is null (key never expires) and sets req.user.apiKey with id and scopes', async () => {
    apiKeyServiceInstance.findByHash.mockResolvedValue({
      apiKey: { ...ACTIVE_KEY, expiresAt: null },
      userId: STORED_USER.id,
    });
    userServiceInstance.findOne.mockResolvedValue(STORED_USER);

    const req = { headers: { authorization: `Bearer ${TOKEN}` } };
    authenticate(req, mockRes, mockNext);

    await new Promise(setImmediate);

    expect(mockNext).toHaveBeenCalledWith();
    expect(req.user.apiKey).toEqual({ id: ACTIVE_KEY.id, scopes: ACTIVE_KEY.scopes });
  });

  it('builds req.user with userId, email, role, groups, and apiKey; caches the result with TTL 30', async () => {
    apiKeyServiceInstance.findByHash.mockResolvedValue({ apiKey: ACTIVE_KEY, userId: STORED_USER.id });
    userServiceInstance.findOne.mockResolvedValue(STORED_USER);

    const req = { headers: { authorization: `Bearer ${TOKEN}` } };
    authenticate(req, mockRes, mockNext);

    await new Promise(setImmediate);

    expect(mockNext).toHaveBeenCalledWith();
    expect(req.user).toEqual({
      userId: STORED_USER.id,
      email: STORED_USER.email,
      role: STORED_USER.role,
      groups: STORED_USER.groups,
      apiKey: { id: ACTIVE_KEY.id, scopes: ACTIVE_KEY.scopes },
    });
    expect(nodeCache.set).toHaveBeenCalledWith(KEY_HASH, req.user, 30);
  });

  it('propagates the error via next when userService.findOne throws', async () => {
    const serviceError = new Error('Firestore unavailable');
    apiKeyServiceInstance.findByHash.mockResolvedValue({ apiKey: ACTIVE_KEY, userId: STORED_USER.id });
    userServiceInstance.findOne.mockRejectedValue(serviceError);

    const req = { headers: { authorization: `Bearer ${TOKEN}` } };
    authenticate(req, mockRes, mockNext);

    await new Promise(setImmediate);

    expect(mockNext).toHaveBeenCalledWith(serviceError);
    expect(mockNext).toHaveBeenCalledTimes(1);
  });

  it('routes non-sk_1kg_ tokens to the JWT path and does not call findByHash', () => {
    jwt.verify.mockReturnValue({
      userId: 'user-id-1',
      email: 'alice@example.com',
      role: 'user',
      groups: ['fc'],
    });

    const req = { headers: { authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig' } };
    authenticate(req, mockRes, mockNext);

    expect(apiKeyServiceInstance.findByHash).not.toHaveBeenCalled();
    expect(jwt.verify).toHaveBeenCalledWith('eyJhbGciOiJIUzI1NiJ9.payload.sig');
    expect(mockNext).toHaveBeenCalledWith();
  });
});
