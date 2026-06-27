'use strict';

const { getUsersQuerySchema } = require('../user.schema');

/**
 * Helper: validate with abortEarly: false (same options as validatorHandler).
 * Returns { error, value }.
 */
function validate(schema, data) {
  return schema.validate(data, { abortEarly: false });
}

// ─────────────────────────────────────────────────────────────────────────────
// getUsersQuerySchema
// ─────────────────────────────────────────────────────────────────────────────
describe('getUsersQuerySchema', () => {
  it('accepts an empty query object — all fields are optional', () => {
    const { error } = validate(getUsersQuerySchema, {});
    expect(error).toBeUndefined();
  });

  // ── offset (common.offset — integer, min 1) ───────────────────────────────
  it('accepts a valid offset', () => {
    const { error } = validate(getUsersQuerySchema, { offset: 5 });
    expect(error).toBeUndefined();
  });

  it('rejects offset: 0 — minimum is 1', () => {
    const { error } = validate(getUsersQuerySchema, { offset: 0 });
    expect(error).toBeDefined();
  });

  it('rejects a non-integer offset', () => {
    const { error } = validate(getUsersQuerySchema, { offset: 1.5 });
    expect(error).toBeDefined();
  });

  // ── limit (common.limit — integer, min 1) ────────────────────────────────
  it('accepts a valid limit', () => {
    const { error } = validate(getUsersQuerySchema, { limit: 10 });
    expect(error).toBeUndefined();
  });

  it('rejects limit: 0 — minimum is 1', () => {
    const { error } = validate(getUsersQuerySchema, { limit: 0 });
    expect(error).toBeDefined();
  });

  it('rejects a non-integer limit', () => {
    const { error } = validate(getUsersQuerySchema, { limit: 2.5 });
    expect(error).toBeDefined();
  });

  // ── inactive (common.inactive — boolean) ─────────────────────────────────
  it('accepts inactive: true', () => {
    const { error } = validate(getUsersQuerySchema, { inactive: true });
    expect(error).toBeUndefined();
  });

  it('accepts inactive: false', () => {
    const { error } = validate(getUsersQuerySchema, { inactive: false });
    expect(error).toBeUndefined();
  });

  it('rejects a non-boolean value for inactive', () => {
    const { error } = validate(getUsersQuerySchema, { inactive: 'yes' });
    expect(error).toBeDefined();
  });

  // ── combination ───────────────────────────────────────────────────────────
  it('accepts offset, limit, and inactive together', () => {
    const { error } = validate(getUsersQuerySchema, { offset: 1, limit: 20, inactive: true });
    expect(error).toBeUndefined();
  });
});
