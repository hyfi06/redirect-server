const request = require('supertest');
const express = require('express');
const redirectRoute = require('../routes');
const RedirectService = require('../services/redirect.service');
const { nodeCache, setClientCache } = require('../../utils/cache');

jest.mock('../services/redirect.service');
jest.mock('../../utils/cache', () => ({
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
    const mockPath = 'testPath';
    const mockUrl = 'https://example.com';
    nodeCache.has.mockReturnValue(true);
    nodeCache.get.mockReturnValue(mockUrl);

    const response = await request(app).get(`/${mockPath}`);

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe(mockUrl);
    expect(nodeCache.has).toHaveBeenCalledWith(mockPath);
    expect(nodeCache.get).toHaveBeenCalledWith(mockPath);
  });

  it('should redirect to the url from the service', async () => {
    const mockPath = 'testPath';
    const mockUrl = 'https://example.com';
    nodeCache.has.mockReturnValue(false);
    RedirectService.prototype.getByPath.mockResolvedValue({ url: mockUrl });

    const response = await request(app).get(`/${mockPath}`);

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
    const mockPath = 'testPath';
    const mockError = new Error('test error');
    nodeCache.has.mockReturnValue(false);
    RedirectService.prototype.getByPath.mockRejectedValue(mockError);

    const response = await request(app).get(`/${mockPath}`);

    expect(response.status).toBe(500);
    expect(response.text).toContain('test error');
  });
});
