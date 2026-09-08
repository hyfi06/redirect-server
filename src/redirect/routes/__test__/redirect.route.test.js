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
jest.mock('../../../utils/click-counter', () => ({ increment: jest.fn() }));

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
    nodeCache.get.mockReturnValue({ id: 'mockId', url: mockUrl });

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
    RedirectService.prototype.getByPath.mockResolvedValue({ id: 'mockId', url: mockUrl });

    const response = await request(app).get(mockPath);

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe(mockUrl);
    expect(nodeCache.has).toHaveBeenCalledWith(mockPath);
    expect(RedirectService.prototype.getByPath).toHaveBeenCalledWith(mockPath);
    expect(nodeCache.set).toHaveBeenCalledWith(
      mockPath,
      { id: 'mockId', url: mockUrl },
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
        jest.doMock('../../../utils/click-counter', () => ({ increment: jest.fn() }));
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
      const mockGetByPath = jest.fn().mockResolvedValue({ id: 'mockId', url: 'https://example.com' });
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
        jest.doMock('../../../utils/click-counter', () => ({ increment: jest.fn() }));
        const redirectRouter = require('../redirect.router');
        app = express();
        app.use('/', redirectRouter);
      });

      const response = await request(app).get('/testPath');

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('https://example.com');
    });
  });

  describe('trust proxy — real client IP resolution', () => {
    // src/app.js calls app.set('trust proxy', config.trustProxy) before mounting any
    // router; config.trustProxy is 1 only in production (see src/config/__test__/config.test.js).
    // These tests apply that same production value (1) directly to a local app instance —
    // app.js itself is never imported (it calls app.listen()) — to verify the effect on the
    // catch-all's request pipeline, which is what the default express-rate-limit keyGenerator
    // (req.ip) relies on to distinguish real clients.
    //
    // Before the fix (trust proxy left at its Express default, `false`): req.ip resolved to
    // request.socket.remoteAddress regardless of X-Forwarded-For — the internal GFE address,
    // identical for every request reaching the instance — so the rate limiter effectively
    // shared one bucket across all real clients. Not re-tested here since it exercises no
    // code introduced by this hotfix; see docs/diag/2026-09-07_01_trust-proxy-rate-limit-misconfig.md.
    //
    // App Engine's GFE is a single hop connected directly by TCP, so it never appears inside
    // X-Forwarded-For itself — the header it forwards carries exactly one IP, the real client's.

    function buildTrustedApp(onRequest) {
      const trustedApp = express();
      trustedApp.set('trust proxy', 1);
      trustedApp.use((req, res, next) => {
        onRequest(req.ip);
        next();
      });
      redirectRoute(trustedApp);
      return trustedApp;
    }

    beforeEach(() => {
      nodeCache.has.mockReturnValue(false);
      RedirectService.prototype.getByPath.mockResolvedValue({ id: 'mockId', url: 'https://example.com' });
    });

    it('resolves req.ip to the client IP carried by a single-entry X-Forwarded-For header', async () => {
      let capturedIp;
      const trustedApp = buildTrustedApp(ip => {
        capturedIp = ip;
      });

      await request(trustedApp).get('/testPath').set('X-Forwarded-For', '203.0.113.5');

      expect(capturedIp).toBe('203.0.113.5');
    });

    it('resolves a different req.ip per request, distinguishing real clients for the rate limiter', async () => {
      const capturedIps = [];
      const trustedApp = buildTrustedApp(ip => {
        capturedIps.push(ip);
      });

      await request(trustedApp).get('/testPath').set('X-Forwarded-For', '203.0.113.5');
      await request(trustedApp).get('/testPath').set('X-Forwarded-For', '198.51.100.9');

      expect(capturedIps).toEqual(['203.0.113.5', '198.51.100.9']);
    });
  });
});
