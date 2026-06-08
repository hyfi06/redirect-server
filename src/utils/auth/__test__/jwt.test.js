const jsonwebtoken = require('jsonwebtoken');

const TEST_PAYLOAD = {
  userId: 'user-123',
  email: 'test@example.com',
  role: 'user',
  groups: ['fc', 'cs'],
};

describe('jwt utility', () => {
  let jwtUtil;

  beforeEach(() => {
    jest.isolateModules(() => {
      jest.mock('../../../config', () => ({
        jwt: {
          jwtSecret: 'test-secret-for-jwt-tests',
          jwtTtl: '1h',
        },
      }));
      jwtUtil = require('../jwt');
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  describe('sign()', () => {
    it('returns a string', () => {
      const token = jwtUtil.sign(TEST_PAYLOAD);
      expect(typeof token).toBe('string');
    });

    it('returns a valid JWT with three dot-separated segments', () => {
      const token = jwtUtil.sign(TEST_PAYLOAD);
      const parts = token.split('.');
      expect(parts).toHaveLength(3);
    });

    it('is exported as "sign" (not "sing")', () => {
      expect(typeof jwtUtil.sign).toBe('function');
      expect(jwtUtil.sing).toBeUndefined();
    });
  });

  describe('verify()', () => {
    it('decodes a token produced by sign() and returns the original payload fields', () => {
      const token = jwtUtil.sign(TEST_PAYLOAD);
      const decoded = jwtUtil.verify(token);

      expect(decoded.userId).toBe(TEST_PAYLOAD.userId);
      expect(decoded.email).toBe(TEST_PAYLOAD.email);
      expect(decoded.role).toBe(TEST_PAYLOAD.role);
      expect(decoded.groups).toEqual(TEST_PAYLOAD.groups);
    });

    it('throws for a token signed with a different secret', () => {
      // Sign with a secret that does not match the one in config
      const foreignToken = jsonwebtoken.sign(TEST_PAYLOAD, 'wrong-secret');
      expect(() => jwtUtil.verify(foreignToken)).toThrow('invalid signature');
    });

    it('throws for an arbitrarily malformed token string', () => {
      expect(() => jwtUtil.verify('not.a.token')).toThrow('invalid token');
    });

    it('throws for an expired token', () => {
      // Sign with expiresIn: -1 to produce a token that is already past its TTL
      const expiredToken = jsonwebtoken.sign(TEST_PAYLOAD, 'test-secret-for-jwt-tests', { expiresIn: -1 });
      expect(() => jwtUtil.verify(expiredToken)).toThrow('jwt expired');
    });
  });
});
