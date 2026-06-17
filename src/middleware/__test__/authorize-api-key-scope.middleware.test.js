'use strict';

/**
 * Unit tests for src/middleware/authorize-api-key-scope.middleware.js
 *
 * The middleware is a factory: authorizeApiKeyScope(requiredScope) returns
 * an Express RequestHandler. Three branches:
 *
 *   1. req.user.apiKey === undefined  → JWT auth path → next() with no error
 *   2. scopes includes requiredScope  → API Key with matching scope → next()
 *   3. scopes does not include it     → API Key missing scope → next(boom.forbidden)
 */

const boom = require('@hapi/boom');
const { authorizeApiKeyScope } = require('../authorize-api-key-scope.middleware');

jest.mock('@hapi/boom');

describe('authorizeApiKeyScope', () => {
  let mockNext;
  const mockRes = {};

  beforeEach(() => {
    mockNext = jest.fn();
    boom.forbidden.mockReturnValue({
      isBoom: true,
      output: {
        statusCode: 403,
        payload: { statusCode: 403, error: 'Forbidden', message: 'API Key scope required: read:redirects' },
      },
    });
  });

  afterEach(() => jest.clearAllMocks());

  describe('JWT auth path — req.user.apiKey is undefined', () => {
    it('calls next() with no arguments when apiKey is undefined', () => {
      const middleware = authorizeApiKeyScope('read:redirects');
      const req = { user: { userId: 'u1', email: 'a@test.com', role: 'user', groups: [] } };

      middleware(req, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockNext).toHaveBeenCalledWith(/* nothing */);
      expect(boom.forbidden).not.toHaveBeenCalled();
    });

    it('does not inspect scopes when apiKey is undefined', () => {
      const middleware = authorizeApiKeyScope('write:redirects');
      const req = { user: { userId: 'u1', email: 'a@test.com', role: 'admin' } };

      middleware(req, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
      expect(boom.forbidden).not.toHaveBeenCalled();
    });
  });

  describe('API Key auth path — req.user.apiKey is defined', () => {
    it('calls next() with no arguments when scopes includes the required scope', () => {
      const middleware = authorizeApiKeyScope('read:redirects');
      const req = {
        user: {
          userId: 'u1',
          email: 'a@test.com',
          role: 'user',
          groups: ['fc'],
          apiKey: { id: 'key-1', scopes: ['read:redirects', 'write:redirects'] },
        },
      };

      middleware(req, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockNext).toHaveBeenCalledWith();
      expect(boom.forbidden).not.toHaveBeenCalled();
    });

    it('calls next() with no arguments when scopes contains exactly the required scope', () => {
      const middleware = authorizeApiKeyScope('write:redirects');
      const req = {
        user: {
          userId: 'u1',
          email: 'a@test.com',
          role: 'user',
          groups: [],
          apiKey: { id: 'key-2', scopes: ['write:redirects'] },
        },
      };

      middleware(req, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
      expect(boom.forbidden).not.toHaveBeenCalled();
    });

    it('calls next(boom.forbidden(...)) when scopes does not include the required scope', () => {
      const middleware = authorizeApiKeyScope('read:redirects');
      const forbiddenError = boom.forbidden.mockReturnValue({
        isBoom: true,
        output: {
          statusCode: 403,
          payload: { statusCode: 403, error: 'Forbidden', message: 'API Key scope required: read:redirects' },
        },
      });
      const req = {
        user: {
          userId: 'u1',
          email: 'a@test.com',
          role: 'user',
          groups: ['fc'],
          apiKey: { id: 'key-3', scopes: ['write:redirects'] },
        },
      };

      middleware(req, mockRes, mockNext);

      expect(boom.forbidden).toHaveBeenCalledWith('API Key scope required: read:redirects');
      expect(mockNext).toHaveBeenCalledTimes(1);
      const passedError = mockNext.mock.calls[0][0];
      expect(passedError.isBoom).toBe(true);
      expect(passedError.output.statusCode).toBe(403);
    });

    it('calls next(boom.forbidden(...)) when scopes is an empty array', () => {
      const middleware = authorizeApiKeyScope('read:redirects');
      const req = {
        user: {
          userId: 'u1',
          email: 'a@test.com',
          role: 'user',
          groups: [],
          apiKey: { id: 'key-4', scopes: [] },
        },
      };

      middleware(req, mockRes, mockNext);

      expect(boom.forbidden).toHaveBeenCalledWith('API Key scope required: read:redirects');
      expect(mockNext).toHaveBeenCalledTimes(1);
      const passedError = mockNext.mock.calls[0][0];
      expect(passedError.isBoom).toBe(true);
      expect(passedError.output.statusCode).toBe(403);
    });

    it('includes the required scope name in the forbidden message', () => {
      boom.forbidden.mockReturnValue({
        isBoom: true,
        output: {
          statusCode: 403,
          payload: { statusCode: 403, error: 'Forbidden', message: 'API Key scope required: write:redirects' },
        },
      });

      const middleware = authorizeApiKeyScope('write:redirects');
      const req = {
        user: {
          userId: 'u1',
          email: 'a@test.com',
          role: 'user',
          groups: [],
          apiKey: { id: 'key-5', scopes: ['read:redirects'] },
        },
      };

      middleware(req, mockRes, mockNext);

      expect(boom.forbidden).toHaveBeenCalledWith('API Key scope required: write:redirects');
    });
  });
});
