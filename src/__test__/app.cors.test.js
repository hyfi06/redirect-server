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

  it('returns true when CORS env var is absent', () => {
    delete process.env.CORS;
    let result;
    jest.isolateModules(() => {
      // Mock dotenv so it does not reload the value from .env
      jest.mock('dotenv', () => ({ config: jest.fn() }));
      result = require('../config').cors;
    });
    expect(result).toBe(true);
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

  it('returns true when CORS env var is the string "*"', () => {
    process.env.CORS = '*';
    let result;
    jest.isolateModules(() => {
      result = require('../config').cors;
    });
    expect(result).toBe(true);
  });
});

describe('env validation guard', () => {
  const REQUIRED_VARS = ['JWT_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_OAUTH_REDIRECT'];
  const savedValues = {};

  beforeAll(() => {
    REQUIRED_VARS.forEach(k => {
      savedValues[k] = process.env[k];
      delete process.env[k];
    });
  });

  afterAll(() => {
    REQUIRED_VARS.forEach(k => {
      if (savedValues[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = savedValues[k];
      }
    });
  });

  it('imports without error in NODE_ENV=test even when required vars are absent', () => {
    expect(() => {
      jest.isolateModules(() => {
        jest.mock('dotenv', () => ({ config: jest.fn() }));
        require('../config');
      });
    }).not.toThrow();
  });

  it('validation block is skipped because NODE_ENV is "test" during the test run', () => {
    // The guard condition `process.env.NODE_ENV !== 'test'` must be false here,
    // meaning the validation block (and process.exit) is never reached.
    expect(process.env.NODE_ENV).toBe('test');
  });
});
