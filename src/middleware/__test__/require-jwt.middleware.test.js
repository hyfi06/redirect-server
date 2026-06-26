'use strict';

/**
 * Unit tests for src/middleware/require-jwt.middleware.js
 *
 * The middleware has two branches:
 *
 *   1. req.user.apiKey !== undefined  → API Key auth path → next(boom.forbidden(...))
 *   2. req.user.apiKey === undefined  → JWT auth path → next() with no arguments
 */

const boom = require('@hapi/boom');
const { requireJwt } = require('../require-jwt.middleware');

jest.mock('@hapi/boom');

describe('requireJwt middleware', () => {
  let mockNext;
  const mockRes = {};

  beforeEach(() => {
    mockNext = jest.fn();
    boom.forbidden.mockReturnValue({
      isBoom: true,
      output: {
        statusCode: 403,
        payload: { statusCode: 403, error: 'Forbidden', message: 'API Keys cannot be used on this resource' },
      },
    });
  });

  afterEach(() => jest.clearAllMocks());

  describe('API Key auth path — req.user.apiKey is defined', () => {
    it('calls next(boom.forbidden(...)) with the correct message', () => {
      const req = { user: { userId: 'u1', role: 'user', apiKey: { id: 'key-1', scopes: ['read:redirects'] } } };

      requireJwt(req, mockRes, mockNext);

      expect(boom.forbidden).toHaveBeenCalledWith('API Keys cannot be used on this resource');
      expect(mockNext).toHaveBeenCalledTimes(1);
      const passedError = mockNext.mock.calls[0][0];
      expect(passedError.isBoom).toBe(true);
      expect(passedError.output.statusCode).toBe(403);
    });

    it('does not call next() without an error argument when apiKey is defined', () => {
      const req = { user: { userId: 'u1', role: 'user', apiKey: { id: 'key-2', scopes: [] } } };

      requireJwt(req, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockNext).not.toHaveBeenCalledWith();
    });
  });

  describe('JWT auth path — req.user.apiKey is undefined', () => {
    it('calls next() with no arguments when apiKey is undefined', () => {
      const req = { user: { userId: 'u1', role: 'user' } };

      requireJwt(req, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockNext).toHaveBeenCalledWith();
      expect(boom.forbidden).not.toHaveBeenCalled();
    });

    it('does not call boom.forbidden when apiKey is undefined', () => {
      const req = { user: { userId: 'u1', role: 'admin' } };

      requireJwt(req, mockRes, mockNext);

      expect(boom.forbidden).not.toHaveBeenCalled();
    });
  });
});
