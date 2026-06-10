'use strict';

const { cleanDocObject, deleteRegData } = require('../clean.data.utils');

// ──────────────────────────────────────────────────────────────────────────────
// cleanDocObject
// ──────────────────────────────────────────────────────────────────────────────

describe('cleanDocObject', () => {
  // ── spec cases ─────────────────────────────────────────────────────────────

  it('removes a key whose value is undefined', () => {
    const input = { a: undefined, b: 1 };

    const result = cleanDocObject(input);

    expect(result).toEqual({ b: 1 });
  });

  it('removes a key whose value is an empty object', () => {
    const input = { auth: {}, name: 'x' };

    const result = cleanDocObject(input);

    expect(result).toEqual({ name: 'x' });
  });

  it('does not remove a key whose value is a non-empty object', () => {
    const input = { auth: { token: 'abc' }, name: 'x' };

    const result = cleanDocObject(input);

    expect(result).toEqual({ auth: { token: 'abc' }, name: 'x' });
  });

  it('does not remove a key whose value is an empty array', () => {
    const input = { tags: [], name: 'x' };

    const result = cleanDocObject(input);

    expect(result).toEqual({ tags: [], name: 'x' });
  });

  it('does not remove a key whose value is a non-empty array', () => {
    const input = { groups: ['a'], name: 'x' };

    const result = cleanDocObject(input);

    expect(result).toEqual({ groups: ['a'], name: 'x' });
  });

  it('does not remove a key whose value is null', () => {
    const input = { a: null, b: 1 };

    const result = cleanDocObject(input);

    expect(result).toEqual({ a: null, b: 1 });
  });

  it('does not remove a key whose value is 0', () => {
    const input = { a: 0, b: false };

    const result = cleanDocObject(input);

    expect(result).toEqual({ a: 0, b: false });
  });

  // ── mutation and reference behaviour ───────────────────────────────────────

  it('mutates the original object rather than returning a copy', () => {
    const input = { a: undefined, b: 1 };

    cleanDocObject(input);

    expect(input).toEqual({ b: 1 });
  });

  it('returns the same reference that was passed in', () => {
    const input = { a: 1 };

    const result = cleanDocObject(input);

    expect(result).toBe(input);
  });

  // ── edge cases ──────────────────────────────────────────────────────────────

  it('handles an already-empty object without throwing', () => {
    const input = {};

    const result = cleanDocObject(input);

    expect(result).toEqual({});
  });

  it('removes multiple undefined and empty-object keys in a single call', () => {
    const input = { a: undefined, b: {}, c: 'keep', d: undefined };

    const result = cleanDocObject(input);

    expect(result).toEqual({ c: 'keep' });
  });

  it('does not treat a nested object that happens to have keys as empty', () => {
    const input = { nested: { x: 1 }, name: 'y' };

    const result = cleanDocObject(input);

    expect(result).toEqual({ nested: { x: 1 }, name: 'y' });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// deleteRegData
// ──────────────────────────────────────────────────────────────────────────────

describe('deleteRegData', () => {
  it('removes id from the object', () => {
    const input = { id: 'abc', name: 'test' };

    deleteRegData(input);

    expect(input).not.toHaveProperty('id');
  });

  it('removes created from the object', () => {
    const input = { id: 'abc', created: new Date(), name: 'test' };

    deleteRegData(input);

    expect(input).not.toHaveProperty('created');
  });

  it('removes updated from the object', () => {
    const input = { id: 'abc', updated: new Date(), name: 'test' };

    deleteRegData(input);

    expect(input).not.toHaveProperty('updated');
  });

  it('does not remove other fields', () => {
    const input = { id: 'abc', created: new Date(), updated: new Date(), name: 'test', role: 'user' };

    deleteRegData(input);

    expect(input.name).toBe('test');
    expect(input.role).toBe('user');
  });

  it('mutates the original object in place', () => {
    const input = { id: 'abc', created: new Date(), name: 'test' };

    deleteRegData(input);

    expect(input).not.toHaveProperty('id');
    expect(input).not.toHaveProperty('created');
  });

  it('returns the same reference that was passed in', () => {
    const input = { id: 'abc' };

    const result = deleteRegData(input);

    expect(result).toBe(input);
  });

  it('does not throw when id, created, and updated are already absent', () => {
    const input = { name: 'test' };

    expect(() => deleteRegData(input)).not.toThrow();
    expect(input).toEqual({ name: 'test' });
  });
});
