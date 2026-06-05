const request = require('supertest');
const express = require('express');
const cors = require('cors');

// Creates a minimal express app with an explicit CORS origin value for testing.
function createApp(corsOrigin) {
  const app = express();
  app.use(cors({ origin: corsOrigin }));
  app.get('/test', (req, res) => res.status(200).json({ ok: true }));
  return app;
}

describe('CORS middleware — wildcard string "*"', () => {
  let app;

  beforeEach(() => {
    app = createApp('*');
  });

  it('sets Access-Control-Allow-Origin: * for any origin', async () => {
    const res = await request(app)
      .get('/test')
      .set('Origin', 'http://localhost:3000');
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('allows any origin regardless of its value', async () => {
    const res = await request(app)
      .get('/test')
      .set('Origin', 'https://random-site.com');
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });
});

// Regression: before the fix, config.cors was computed as '*'.split(',') → ['*'].
// The cors library treats an array as a list of exact origins, not a wildcard,
// so ['*'] silently denies all browser requests.
describe('CORS middleware — array containing only "*" (broken behavior)', () => {
  let app;

  beforeEach(() => {
    app = createApp(['*']);
  });

  it('does NOT set the CORS header — cors lib treats "*" in an array as a literal origin string', async () => {
    const res = await request(app)
      .get('/test')
      .set('Origin', 'http://localhost:3000');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('CORS middleware — allowlist of specific origins', () => {
  let app;

  beforeEach(() => {
    app = createApp(['https://a.com', 'https://b.com']);
  });

  it('reflects the first allowed origin in the response header', async () => {
    const res = await request(app)
      .get('/test')
      .set('Origin', 'https://a.com');
    expect(res.headers['access-control-allow-origin']).toBe('https://a.com');
  });

  it('reflects the second allowed origin in the response header', async () => {
    const res = await request(app)
      .get('/test')
      .set('Origin', 'https://b.com');
    expect(res.headers['access-control-allow-origin']).toBe('https://b.com');
  });

  it('omits the CORS header for origins not in the allowlist', async () => {
    const res = await request(app)
      .get('/test')
      .set('Origin', 'https://c.com');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('config.cors parsing from CORS env var', () => {
  const originalCors = process.env.CORS;

  afterAll(() => {
    if (originalCors === undefined) {
      delete process.env.CORS;
    } else {
      process.env.CORS = originalCors;
    }
  });

  it('returns the string "*" when CORS env var is absent', () => {
    delete process.env.CORS;
    let result;
    jest.isolateModules(() => {
      // Mock dotenv so it does not reload the value from .env
      jest.mock('dotenv', () => ({ config: jest.fn() }));
      result = require('../config').cors;
    });
    expect(result).toBe('*');
  });

  it('returns a single-element array for one origin', () => {
    process.env.CORS = 'https://app.example.com';
    let result;
    jest.isolateModules(() => {
      result = require('../config').cors;
    });
    expect(result).toEqual(['https://app.example.com']);
  });

  it('splits comma-separated origins into an array', () => {
    process.env.CORS = 'https://app.example.com,https://admin.example.com';
    let result;
    jest.isolateModules(() => {
      result = require('../config').cors;
    });
    expect(result).toEqual(['https://app.example.com', 'https://admin.example.com']);
  });

  // Edge case: if .env contains CORS=*, the truthy check still routes to
  // split(), producing ['*']. This is the unhandled case documented in the spec.
  it('produces ["*"] when CORS env var is literally the string "*" — known limitation', () => {
    process.env.CORS = '*';
    let result;
    jest.isolateModules(() => {
      result = require('../config').cors;
    });
    expect(result).toEqual(['*']);
  });
});
