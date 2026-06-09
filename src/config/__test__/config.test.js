// process.exit must be mocked BEFORE any describe block runs so that Jest's
// own process-exit detector never fires when the config guard calls exit(1).
const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

const REQUIRED_VARS = {
  JWT_SECRET: 'test-secret',
  GOOGLE_CLIENT_ID: 'test-client-id',
  GOOGLE_CLIENT_SECRET: 'test-client-secret',
  GOOGLE_OAUTH_REDIRECT: 'http://localhost/callback',
};

const originalEnv = { ...process.env };

function setRequiredVars() {
  Object.assign(process.env, REQUIRED_VARS);
}

function clearRequiredVars() {
  Object.keys(REQUIRED_VARS).forEach(k => delete process.env[k]);
}

function restoreEnv() {
  Object.keys(REQUIRED_VARS).forEach(k => {
    if (originalEnv[k] === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = originalEnv[k];
    }
  });
  if (originalEnv.NODE_ENV === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = originalEnv.NODE_ENV;
  }
}

afterAll(() => {
  exitSpy.mockRestore();
  consoleErrorSpy.mockRestore();
  restoreEnv();
});

describe('config env validation guard', () => {
  beforeEach(() => {
    jest.resetModules();
    exitSpy.mockClear();
    consoleErrorSpy.mockClear();
  });

  afterEach(() => {
    restoreEnv();
  });

  it('does not call process.exit when all required vars are defined and NODE_ENV is production', () => {
    setRequiredVars();
    process.env.NODE_ENV = 'production';

    jest.isolateModules(() => {
      jest.mock('dotenv', () => ({ config: jest.fn() }));
      require('../index');
    });

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('calls process.exit(1) when JWT_SECRET is missing and NODE_ENV is production', () => {
    setRequiredVars();
    delete process.env.JWT_SECRET;
    process.env.NODE_ENV = 'production';

    jest.isolateModules(() => {
      jest.mock('dotenv', () => ({ config: jest.fn() }));
      require('../index');
    });

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('calls process.exit(1) when GOOGLE_CLIENT_ID is missing and NODE_ENV is production', () => {
    setRequiredVars();
    delete process.env.GOOGLE_CLIENT_ID;
    process.env.NODE_ENV = 'production';

    jest.isolateModules(() => {
      jest.mock('dotenv', () => ({ config: jest.fn() }));
      require('../index');
    });

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('calls process.exit(1) when GOOGLE_CLIENT_SECRET is missing and NODE_ENV is production', () => {
    setRequiredVars();
    delete process.env.GOOGLE_CLIENT_SECRET;
    process.env.NODE_ENV = 'production';

    jest.isolateModules(() => {
      jest.mock('dotenv', () => ({ config: jest.fn() }));
      require('../index');
    });

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('calls process.exit(1) when GOOGLE_OAUTH_REDIRECT is missing and NODE_ENV is production', () => {
    setRequiredVars();
    delete process.env.GOOGLE_OAUTH_REDIRECT;
    process.env.NODE_ENV = 'production';

    jest.isolateModules(() => {
      jest.mock('dotenv', () => ({ config: jest.fn() }));
      require('../index');
    });

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('does not call process.exit when NODE_ENV is test even if required vars are missing', () => {
    clearRequiredVars();
    process.env.NODE_ENV = 'test';

    jest.isolateModules(() => {
      jest.mock('dotenv', () => ({ config: jest.fn() }));
      require('../index');
    });

    expect(exitSpy).not.toHaveBeenCalled();
  });
});

describe('config exported values', () => {
  beforeEach(() => {
    jest.resetModules();
    exitSpy.mockClear();
  });

  afterEach(() => {
    restoreEnv();
  });

  it('sets dev=false when NODE_ENV is production', () => {
    setRequiredVars();
    process.env.NODE_ENV = 'production';

    let config;
    jest.isolateModules(() => {
      jest.mock('dotenv', () => ({ config: jest.fn() }));
      config = require('../index');
    });

    expect(config.dev).toBe(false);
  });

  it('sets dev=true when NODE_ENV is development', () => {
    process.env.NODE_ENV = 'development';

    let config;
    jest.isolateModules(() => {
      jest.mock('dotenv', () => ({ config: jest.fn() }));
      config = require('../index');
    });

    expect(config.dev).toBe(true);
  });

  it('uses PORT env var when set', () => {
    process.env.PORT = '4000';
    process.env.NODE_ENV = 'test';

    let config;
    jest.isolateModules(() => {
      jest.mock('dotenv', () => ({ config: jest.fn() }));
      config = require('../index');
    });

    expect(config.port).toBe('4000');
  });

  it('defaults port to 3000 when PORT is not set', () => {
    delete process.env.PORT;
    process.env.NODE_ENV = 'test';

    let config;
    jest.isolateModules(() => {
      jest.mock('dotenv', () => ({ config: jest.fn() }));
      config = require('../index');
    });

    expect(config.port).toBe(3000);
  });

  it('splits CORS env var by comma when set to specific origins', () => {
    process.env.CORS = 'https://a.com,https://b.com';
    process.env.NODE_ENV = 'test';

    let config;
    jest.isolateModules(() => {
      jest.mock('dotenv', () => ({ config: jest.fn() }));
      config = require('../index');
    });

    expect(config.cors).toEqual(['https://a.com', 'https://b.com']);
  });

  it('sets cors=true when CORS env var is "*"', () => {
    process.env.CORS = '*';
    process.env.NODE_ENV = 'test';

    let config;
    jest.isolateModules(() => {
      jest.mock('dotenv', () => ({ config: jest.fn() }));
      config = require('../index');
    });

    expect(config.cors).toBe(true);
  });

  it('defaults jwtTtl to "2h" when JWT_TTL is not set', () => {
    delete process.env.JWT_TTL;
    process.env.NODE_ENV = 'test';

    let config;
    jest.isolateModules(() => {
      jest.mock('dotenv', () => ({ config: jest.fn() }));
      config = require('../index');
    });

    expect(config.jwt.jwtTtl).toBe('2h');
  });

  it('uses JWT_TTL env var when set', () => {
    process.env.JWT_TTL = '4h';
    process.env.NODE_ENV = 'test';

    let config;
    jest.isolateModules(() => {
      jest.mock('dotenv', () => ({ config: jest.fn() }));
      config = require('../index');
    });

    expect(config.jwt.jwtTtl).toBe('4h');
  });
});
