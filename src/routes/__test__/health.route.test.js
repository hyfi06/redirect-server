const request = require('supertest');
const express = require('express');

describe('healthRouter', () => {
  let app;
  let mockGet;

  beforeEach(() => {
    // Reset the module registry so that health.js is re-evaluated on each
    // require() call, ensuring the module-level `new FireStoreAdapter(...)`
    // picks up the fresh mock implementation set below.
    jest.resetModules();

    mockGet = jest.fn();

    jest.mock('../../lib/firestore', () =>
      jest.fn().mockImplementation(() => ({
        collection: {
          limit: jest.fn().mockReturnValue({ get: mockGet }),
        },
      }))
    );

    const healthRouter = require('../health');

    app = express();
    healthRouter(app);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns 200 with { status: "ok" } when Firestore responds without error', async () => {
    mockGet.mockResolvedValue({});

    const res = await request(app).get('/_ah/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('returns 503 with { status: "error", message } when Firestore throws', async () => {
    mockGet.mockRejectedValue(new Error('connection refused'));

    const res = await request(app).get('/_ah/health');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'error', message: 'connection refused' });
  });
});
