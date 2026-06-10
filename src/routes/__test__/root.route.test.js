const request = require('supertest');
const express = require('express');

describe('rootRouter', () => {
  let app;

  beforeEach(() => {
    jest.resetModules();
    jest.mock('../../utils/cache', () => ({
      setClientCache: jest.fn(),
      nodeCache: { get: jest.fn(), set: jest.fn(), has: jest.fn() },
    }));

    const rootRouter = require('../root');
    app = express();
    rootRouter(app);
    // Fallback 404 handler for the test app
    app.use((req, res) => res.status(404).end());
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns 200 with HTML content for GET /', async () => {
    const res = await request(app).get('/');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
  });

  it('returns 200 for an existing static file GET /1kg.svg', async () => {
    const res = await request(app).get('/1kg.svg');

    expect(res.status).toBe(200);
  });

  it('returns 404 for a non-existent static file GET /nonexistent-file.xyz', async () => {
    const res = await request(app).get('/nonexistent-file.xyz');

    expect(res.status).toBe(404);
  });

  it('calls setClientCache on GET / in production', async () => {
    jest.resetModules();

    const mockSetClientCache = jest.fn();
    jest.mock('../../utils/cache', () => ({
      setClientCache: mockSetClientCache,
      nodeCache: { get: jest.fn(), set: jest.fn(), has: jest.fn() },
    }));

    const rootRouter = require('../root');
    const prodApp = express();
    rootRouter(prodApp);
    prodApp.use((req, res) => res.status(404).end());

    await request(prodApp).get('/');

    expect(mockSetClientCache).toHaveBeenCalledTimes(1);
    expect(mockSetClientCache).toHaveBeenCalledWith(
      expect.anything(),
      1800 // HALF_AN_HOUR_IN_SECONDS
    );
  });
});
