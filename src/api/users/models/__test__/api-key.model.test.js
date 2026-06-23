'use strict';

const ApiKey = require('../api-key.model');

describe('ApiKey model', () => {
  // -------------------------------------------------------------------------
  // Constructor — defaults
  // -------------------------------------------------------------------------
  describe('constructor defaults', () => {
    it('sets id to null when not provided', () => {
      const key = new ApiKey({ name: 'My Key', keyHash: 'h', prefix: 'abc', scopes: [] });
      expect(key.id).toBeNull();
    });

    it('sets id from data when provided', () => {
      const key = new ApiKey({ id: 'key-123', name: 'My Key', keyHash: 'h', prefix: 'abc', scopes: [] });
      expect(key.id).toBe('key-123');
    });

    it('sets expiresAt to null when not provided', () => {
      const key = new ApiKey({ name: 'My Key', keyHash: 'h', prefix: 'abc', scopes: [] });
      expect(key.expiresAt).toBeNull();
    });

    it('sets expiresAt to null when explicitly passed as undefined', () => {
      const key = new ApiKey({ name: 'My Key', keyHash: 'h', prefix: 'abc', scopes: [], expiresAt: undefined });
      expect(key.expiresAt).toBeNull();
    });

    it('sets expiresAt from data when provided', () => {
      const date = new Date('2027-01-01');
      const key = new ApiKey({ name: 'My Key', keyHash: 'h', prefix: 'abc', scopes: [], expiresAt: date });
      expect(key.expiresAt).toBe(date);
    });

    it('sets lastUsedAt to null when not provided', () => {
      const key = new ApiKey({ name: 'My Key', keyHash: 'h', prefix: 'abc', scopes: [] });
      expect(key.lastUsedAt).toBeNull();
    });

    it('sets lastUsedAt to null when explicitly passed as undefined', () => {
      const key = new ApiKey({ name: 'My Key', keyHash: 'h', prefix: 'abc', scopes: [], lastUsedAt: undefined });
      expect(key.lastUsedAt).toBeNull();
    });

    it('sets lastUsedAt from data when provided', () => {
      const date = new Date('2026-05-01');
      const key = new ApiKey({ name: 'My Key', keyHash: 'h', prefix: 'abc', scopes: [], lastUsedAt: date });
      expect(key.lastUsedAt).toBe(date);
    });

    it('defaults active to true when not provided', () => {
      const key = new ApiKey({ name: 'My Key', keyHash: 'h', prefix: 'abc', scopes: [] });
      expect(key.active).toBe(true);
    });

    it('defaults active to true when explicitly passed as undefined', () => {
      const key = new ApiKey({ name: 'My Key', keyHash: 'h', prefix: 'abc', scopes: [], active: undefined });
      expect(key.active).toBe(true);
    });

    it('preserves active: false when explicitly provided', () => {
      const key = new ApiKey({ name: 'My Key', keyHash: 'h', prefix: 'abc', scopes: [], active: false });
      expect(key.active).toBe(false);
    });

    it('defaults scopes to empty array when not provided', () => {
      const key = new ApiKey({ name: 'My Key', keyHash: 'h', prefix: 'abc' });
      expect(key.scopes).toEqual([]);
    });

    it('sets scopes from data when provided', () => {
      const key = new ApiKey({ name: 'My Key', keyHash: 'h', prefix: 'abc', scopes: ['read', 'write'] });
      expect(key.scopes).toEqual(['read', 'write']);
    });

    it('does not set createdAt when not provided', () => {
      const key = new ApiKey({ name: 'My Key', keyHash: 'h', prefix: 'abc', scopes: [] });
      expect(key.createdAt).toBeUndefined();
    });

    it('sets createdAt when provided', () => {
      const date = new Date('2026-01-15');
      const key = new ApiKey({ name: 'My Key', keyHash: 'h', prefix: 'abc', scopes: [], createdAt: date });
      expect(key.createdAt).toBe(date);
    });

    it('stores keyHash on the instance', () => {
      const key = new ApiKey({ name: 'My Key', keyHash: 'secret-hash', prefix: 'abc', scopes: [] });
      expect(key.keyHash).toBe('secret-hash');
    });

    it('stores prefix on the instance', () => {
      const key = new ApiKey({ name: 'My Key', keyHash: 'h', prefix: 'abc123', scopes: [] });
      expect(key.prefix).toBe('abc123');
    });

    it('stores name on the instance', () => {
      const key = new ApiKey({ name: 'Production Key', keyHash: 'h', prefix: 'abc', scopes: [] });
      expect(key.name).toBe('Production Key');
    });
  });

  // -------------------------------------------------------------------------
  // toPublic()
  // -------------------------------------------------------------------------
  describe('toPublic()', () => {
    it('returns id, name, prefix, scopes, expiresAt, createdAt, lastUsedAt, active', () => {
      const createdAt = new Date('2026-01-01');
      const expiresAt = new Date('2027-01-01');
      const lastUsedAt = new Date('2026-06-01');
      const key = new ApiKey({
        id: 'key-abc',
        name: 'Test Key',
        keyHash: 'secret',
        prefix: 'tst',
        scopes: ['read'],
        createdAt,
        expiresAt,
        lastUsedAt,
        active: true,
      });

      const result = key.toPublic();

      expect(result).toEqual({
        id: 'key-abc',
        name: 'Test Key',
        prefix: 'tst',
        scopes: ['read'],
        expiresAt,
        createdAt,
        lastUsedAt,
        active: true,
      });
    });

    it('does not include keyHash in the result', () => {
      const key = new ApiKey({ name: 'My Key', keyHash: 'super-secret-hash', prefix: 'abc', scopes: [] });
      const result = key.toPublic();
      expect(result).not.toHaveProperty('keyHash');
    });

    it('preserves active: false in the public output', () => {
      const key = new ApiKey({ name: 'Revoked', keyHash: 'h', prefix: 'abc', scopes: [], active: false });
      expect(key.toPublic().active).toBe(false);
    });

    it('includes null for expiresAt when not set', () => {
      const key = new ApiKey({ name: 'My Key', keyHash: 'h', prefix: 'abc', scopes: [] });
      expect(key.toPublic().expiresAt).toBeNull();
    });

    it('includes null for lastUsedAt when not set', () => {
      const key = new ApiKey({ name: 'My Key', keyHash: 'h', prefix: 'abc', scopes: [] });
      expect(key.toPublic().lastUsedAt).toBeNull();
    });

    it('returns a plain object (not an ApiKey instance)', () => {
      const key = new ApiKey({ name: 'My Key', keyHash: 'h', prefix: 'abc', scopes: [] });
      expect(key.toPublic()).not.toBeInstanceOf(ApiKey);
    });
  });
});
