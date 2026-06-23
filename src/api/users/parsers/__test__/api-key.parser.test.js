'use strict';

const ApiKey = require('../../models/api-key.model');
const {
  apiKeyDocParser,
  createApiKeyParser,
  updateApiKeyParser,
} = require('../api-key.parser');

// ---------------------------------------------------------------------------
// Helper — build a Firestore DocumentSnapshot stub
// ---------------------------------------------------------------------------
function makeDocSnap(overrides = {}) {
  const createdMillis = overrides.createdMillis !== undefined ? overrides.createdMillis : 1_700_000_000_000;
  const data = {
    name: overrides.name || 'Test Key',
    keyHash: overrides.keyHash || 'hash-abc',
    prefix: overrides.prefix || 'tst',
    scopes: overrides.scopes || ['read'],
    active: overrides.active !== undefined ? overrides.active : true,
    createdAt: { toMillis: () => createdMillis },
    lastUsedAt: overrides.lastUsedAt !== undefined
      ? overrides.lastUsedAt
      : { toMillis: () => 1_700_000_001_000 },
    expiresAt: overrides.expiresAt !== undefined
      ? overrides.expiresAt
      : { toMillis: () => 1_800_000_000_000 },
  };
  return {
    ref: { id: overrides.id || 'key-123' },
    data: () => data,
  };
}

// ---------------------------------------------------------------------------
// apiKeyDocParser
// ---------------------------------------------------------------------------
describe('apiKeyDocParser', () => {
  it('returns an ApiKey instance', () => {
    const snap = makeDocSnap();
    const result = apiKeyDocParser(snap);
    expect(result).toBeInstanceOf(ApiKey);
  });

  it('extracts id from docSnap.ref.id', () => {
    const snap = makeDocSnap({ id: 'key-xyz' });
    const result = apiKeyDocParser(snap);
    expect(result.id).toBe('key-xyz');
  });

  it('converts createdAt Timestamp to a Date', () => {
    const snap = makeDocSnap({ createdMillis: 1_000_000 });
    const result = apiKeyDocParser(snap);
    expect(result.createdAt).toBeInstanceOf(Date);
    expect(result.createdAt.getTime()).toBe(1_000_000);
  });

  it('converts lastUsedAt Timestamp to a Date when present', () => {
    const snap = makeDocSnap({ lastUsedAt: { toMillis: () => 2_000_000 } });
    const result = apiKeyDocParser(snap);
    expect(result.lastUsedAt).toBeInstanceOf(Date);
    expect(result.lastUsedAt.getTime()).toBe(2_000_000);
  });

  it('sets lastUsedAt to null when the Firestore field is null', () => {
    const snap = makeDocSnap({ lastUsedAt: null });
    const result = apiKeyDocParser(snap);
    expect(result.lastUsedAt).toBeNull();
  });

  it('converts expiresAt Timestamp to a Date when present', () => {
    const snap = makeDocSnap({ expiresAt: { toMillis: () => 3_000_000 } });
    const result = apiKeyDocParser(snap);
    expect(result.expiresAt).toBeInstanceOf(Date);
    expect(result.expiresAt.getTime()).toBe(3_000_000);
  });

  it('sets expiresAt to null when the Firestore field is null', () => {
    const snap = makeDocSnap({ expiresAt: null });
    const result = apiKeyDocParser(snap);
    expect(result.expiresAt).toBeNull();
  });

  it('preserves name, keyHash, prefix, scopes, and active from the snapshot data', () => {
    const snap = makeDocSnap({
      name: 'Prod Key',
      keyHash: 'secure-hash',
      prefix: 'prd',
      scopes: ['read', 'write'],
      active: false,
    });
    const result = apiKeyDocParser(snap);
    expect(result.name).toBe('Prod Key');
    expect(result.keyHash).toBe('secure-hash');
    expect(result.prefix).toBe('prd');
    expect(result.scopes).toEqual(['read', 'write']);
    expect(result.active).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createApiKeyParser
// ---------------------------------------------------------------------------
describe('createApiKeyParser', () => {
  function makeApiKey(overrides = {}) {
    return new ApiKey({
      id: 'key-to-strip',
      name: overrides.name || 'My Key',
      keyHash: overrides.keyHash || 'hash-xyz',
      prefix: overrides.prefix || 'myk',
      scopes: overrides.scopes || ['read'],
      expiresAt: overrides.expiresAt !== undefined ? overrides.expiresAt : new Date('2027-01-01'),
      createdAt: new Date('2026-01-01'),
      lastUsedAt: overrides.lastUsedAt !== undefined ? overrides.lastUsedAt : new Date('2026-06-01'),
      active: overrides.active !== undefined ? overrides.active : true,
    });
  }

  it('includes keyHash in the returned object', () => {
    const apiKey = makeApiKey({ keyHash: 'the-hash' });
    const result = createApiKeyParser(apiKey);
    expect(result.keyHash).toBe('the-hash');
  });

  it('includes prefix in the returned object', () => {
    const apiKey = makeApiKey({ prefix: 'prf' });
    const result = createApiKeyParser(apiKey);
    expect(result.prefix).toBe('prf');
  });

  it('includes name in the returned object', () => {
    const apiKey = makeApiKey({ name: 'Named Key' });
    const result = createApiKeyParser(apiKey);
    expect(result.name).toBe('Named Key');
  });

  it('includes scopes in the returned object', () => {
    const apiKey = makeApiKey({ scopes: ['write', 'delete'] });
    const result = createApiKeyParser(apiKey);
    expect(result.scopes).toEqual(['write', 'delete']);
  });

  it('includes expiresAt in the returned object', () => {
    const date = new Date('2028-06-01');
    const apiKey = makeApiKey({ expiresAt: date });
    const result = createApiKeyParser(apiKey);
    expect(result.expiresAt).toBe(date);
  });

  it('includes expiresAt as null when not set', () => {
    const apiKey = makeApiKey({ expiresAt: null });
    const result = createApiKeyParser(apiKey);
    expect(result.expiresAt).toBeNull();
  });

  it('hardcodes active to true regardless of the model value', () => {
    // Even if the ApiKey instance were constructed with active: false,
    // createApiKeyParser always writes active: true
    const apiKey = makeApiKey({ active: false });
    const result = createApiKeyParser(apiKey);
    expect(result.active).toBe(true);
  });

  it('hardcodes lastUsedAt to null regardless of the model value', () => {
    const apiKey = makeApiKey({ lastUsedAt: new Date('2025-01-01') });
    const result = createApiKeyParser(apiKey);
    expect(result.lastUsedAt).toBeNull();
  });

  it('does not include id in the returned object', () => {
    const apiKey = makeApiKey();
    const result = createApiKeyParser(apiKey);
    expect(result).not.toHaveProperty('id');
  });

  it('does not include createdAt in the returned object', () => {
    const apiKey = makeApiKey();
    const result = createApiKeyParser(apiKey);
    expect(result).not.toHaveProperty('createdAt');
  });
});

// ---------------------------------------------------------------------------
// updateApiKeyParser
// ---------------------------------------------------------------------------
describe('updateApiKeyParser', () => {
  it('returns { active: false }', () => {
    const result = updateApiKeyParser();
    expect(result).toEqual({ active: false });
  });

  it('returns { active: false } regardless of any argument passed', () => {
    const apiKey = new ApiKey({ name: 'Key', keyHash: 'h', prefix: 'abc', scopes: [], active: true });
    const result = updateApiKeyParser(apiKey);
    expect(result).toEqual({ active: false });
  });

  it('does not include any field besides active', () => {
    const result = updateApiKeyParser();
    expect(Object.keys(result)).toEqual(['active']);
  });
});
