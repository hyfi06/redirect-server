'use strict';

const { log } = require('../logger');

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
  jest.restoreAllMocks();
});

// ──────────────────────────────────────────────────────────────────────────────
// production
// ──────────────────────────────────────────────────────────────────────────────

describe('log — NODE_ENV=production', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'production';
  });

  it('writes a JSON line to process.stdout with severity, message, and flattened data fields', () => {
    const stdoutWrite = jest.spyOn(process.stdout, 'write').mockImplementation(() => {});

    log('INFO', 'test message', { foo: 'bar', count: 42 });

    expect(stdoutWrite).toHaveBeenCalledTimes(1);
    const written = stdoutWrite.mock.calls[0][0];
    const parsed = JSON.parse(written);
    expect(parsed).toEqual({ severity: 'INFO', message: 'test message', foo: 'bar', count: 42 });
  });

  it('appends a newline character after the JSON payload', () => {
    const stdoutWrite = jest.spyOn(process.stdout, 'write').mockImplementation(() => {});

    log('INFO', 'msg', { x: 1 });

    const written = stdoutWrite.mock.calls[0][0];
    expect(written).toMatch(/\n$/);
  });

  it('writes only severity and message when data is omitted', () => {
    const stdoutWrite = jest.spyOn(process.stdout, 'write').mockImplementation(() => {});

    log('ERROR', 'something failed');

    expect(stdoutWrite).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(stdoutWrite.mock.calls[0][0]);
    expect(parsed).toEqual({ severity: 'ERROR', message: 'something failed' });
  });

  it('does not call console.log', () => {
    jest.spyOn(process.stdout, 'write').mockImplementation(() => {});
    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});

    log('INFO', 'msg');

    expect(consoleLog).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// development (any value that is not 'production' or 'test')
// ──────────────────────────────────────────────────────────────────────────────

describe('log — NODE_ENV=development', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'development';
  });

  it('calls console.log with a formatted string when data is omitted', () => {
    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});

    log('INFO', 'hello world');

    expect(consoleLog).toHaveBeenCalledTimes(1);
    expect(consoleLog).toHaveBeenCalledWith('[INFO] hello world', '');
  });

  it('calls console.log with a formatted string and the data object when data is provided', () => {
    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});

    log('WARN', 'check this', { key: 'value' });

    expect(consoleLog).toHaveBeenCalledTimes(1);
    expect(consoleLog).toHaveBeenCalledWith('[WARN] check this', { key: 'value' });
  });

  it('does not write to process.stdout', () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    const stdoutWrite = jest.spyOn(process.stdout, 'write').mockImplementation(() => {});

    log('INFO', 'msg');

    expect(stdoutWrite).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// test (NODE_ENV=test — the default in this suite)
// ──────────────────────────────────────────────────────────────────────────────

describe('log — NODE_ENV=test', () => {
  it('does not call console.log', () => {
    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});

    log('INFO', 'silent');

    expect(consoleLog).not.toHaveBeenCalled();
  });

  it('does not write to process.stdout', () => {
    const stdoutWrite = jest.spyOn(process.stdout, 'write').mockImplementation(() => {});

    log('INFO', 'silent');

    expect(stdoutWrite).not.toHaveBeenCalled();
  });
});
