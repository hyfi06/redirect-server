const request = require('supertest');
const express = require('express');
const redirectRoute = require('..');
const RedirectService = require('../../../api/redirect/services/redirect.service');
const { nodeCache } = require('../../../utils/cache');

jest.mock('../../../api/redirect/services/redirect.service');
jest.mock('../../../utils/cache', () => ({
  nodeCache: {
    has: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
  },
  setClientCache: jest.fn(),
}));

describe('redirectRoute', () => {
  let app;

  beforeEach(() => {
    RedirectService.getByPath = jest.fn();
    app = express();
    redirectRoute(app);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should redirect to the url from the cache', async () => {
    const mockPath = '/testPath';
    const mockUrl = 'https://example.com';
    nodeCache.has.mockReturnValue(true);
    nodeCache.get.mockReturnValue(mockUrl);

    const response = await request(app).get(mockPath);

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe(mockUrl);
    expect(nodeCache.has).toHaveBeenCalledWith(mockPath);
    expect(nodeCache.get).toHaveBeenCalledWith(mockPath);
  });

  it('should redirect to the url from the service', async () => {
    const mockPath = '/testPath';
    const mockUrl = 'https://example.com';
    nodeCache.has.mockReturnValue(false);
    RedirectService.prototype.getByPath.mockResolvedValue({ url: mockUrl });

    const response = await request(app).get(mockPath);

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe(mockUrl);
    expect(nodeCache.has).toHaveBeenCalledWith(mockPath);
    expect(RedirectService.prototype.getByPath).toHaveBeenCalledWith(mockPath);
    expect(nodeCache.set).toHaveBeenCalledWith(
      mockPath,
      mockUrl,
      expect.any(Number)
    );
  });

  it('should pass the error to the next middleware', async () => {
    const mockPath = '/testPath';
    const mockError = new Error('test error');
    nodeCache.has.mockReturnValue(false);
    RedirectService.prototype.getByPath.mockRejectedValue(mockError);

    const response = await request(app).get(mockPath);

    expect(response.status).toBe(500);
    expect(response.text).toContain('test error');
  });

  describe('rate limiter', () => {
    // The real limiter has skip: () => process.env.NODE_ENV === 'test', so it is
    // always bypassed in the main test registry. These tests use jest.isolateModules
    // + jest.doMock to load a fresh copy of redirect.router with express-rate-limit
    // replaced by a controlled stub, enabling direct verification of the 429 handler.

    it('responds 429 with the correct JSON when the rate limit is exceeded', async () => {
      let app;
      jest.isolateModules(() => {
        jest.doMock('express-rate-limit', () => (options) => {
          return (req, res, next) => options.handler(req, res, next);
        });
        jest.doMock('../../../utils/cache', () => ({
          nodeCache: { has: jest.fn(), get: jest.fn(), set: jest.fn() },
          setClientCache: jest.fn(),
        }));
        jest.doMock('../../../lib/services', () => ({
          redirectService: { getByPath: jest.fn() },
        }));
        const redirectRouter = require('../redirect.router');
        app = express();
        app.use('/', redirectRouter);
      });

      const response = await request(app).get('/testPath');

      expect(response.status).toBe(429);
      expect(response.body).toEqual({
        statusCode: 429,
        error: 'Too Many Requests',
        message: 'rate limit exceeded',
      });
    });

    it('passes the request through to the redirect handler when within the rate limit', async () => {
      const mockGetByPath = jest.fn().mockResolvedValue({ url: 'https://example.com' });
      let app;
      jest.isolateModules(() => {
        jest.doMock('express-rate-limit', () => (_options) => {
          return (_req, _res, next) => next();
        });
        jest.doMock('../../../utils/cache', () => ({
          nodeCache: { has: jest.fn().mockReturnValue(false), get: jest.fn(), set: jest.fn() },
          setClientCache: jest.fn(),
        }));
        jest.doMock('../../../lib/services', () => ({
          redirectService: { getByPath: mockGetByPath },
        }));
        const redirectRouter = require('../redirect.router');
        app = express();
        app.use('/', redirectRouter);
      });

      const response = await request(app).get('/testPath');

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('https://example.com');
    });
  });
});
