const {
  createRedirectSchema,
  updateRedirectSchema,
  getRedirectQuerySchema,
  getByPathRedirectSchema,
} = require('../redirect.schema');

/**
 * Helper: validate with abortEarly: false (same options as validatorHandler).
 * Returns { error, value }.
 */
function validate(schema, data) {
  return schema.validate(data, { abortEarly: false });
}

// ─────────────────────────────────────────────────────────────────────────────
// createRedirectSchema
// ─────────────────────────────────────────────────────────────────────────────
describe('createRedirectSchema', () => {
  // ── path (slug pattern — D11) ──────────────────────────────────────────────
  describe('path', () => {
    it('accepts a single lowercase segment', () => {
      const { error } = validate(createRedirectSchema, { path: 'seminar', url: 'https://example.com' });
      expect(error).toBeUndefined();
    });

    it('accepts a single lowercase letter', () => {
      const { error } = validate(createRedirectSchema, { path: 'a', url: 'https://example.com' });
      expect(error).toBeUndefined();
    });

    it('accepts a segment with hyphens and digits', () => {
      const { error } = validate(createRedirectSchema, { path: 'abc-123', url: 'https://example.com' });
      expect(error).toBeUndefined();
    });

    it('accepts a multi-segment slug path', () => {
      const { error } = validate(createRedirectSchema, { path: 'eventos/2026', url: 'https://example.com' });
      expect(error).toBeUndefined();
    });

    it('accepts a group-prefixed sub-path', () => {
      const { error } = validate(createRedirectSchema, { path: 'fc/mi-evento', url: 'https://example.com' });
      expect(error).toBeUndefined();
    });

    it('rejects a path with a leading slash', () => {
      const { error } = validate(createRedirectSchema, { path: '/seminar', url: 'https://example.com' });
      expect(error).toBeDefined();
    });

    it('rejects an empty string', () => {
      const { error } = validate(createRedirectSchema, { path: '', url: 'https://example.com' });
      expect(error).toBeDefined();
    });

    it('rejects uppercase letters', () => {
      const { error } = validate(createRedirectSchema, { path: 'Seminar', url: 'https://example.com' });
      expect(error).toBeDefined();
    });

    it('rejects a trailing slash', () => {
      const { error } = validate(createRedirectSchema, { path: 'seminar/', url: 'https://example.com' });
      expect(error).toBeDefined();
    });

    it('rejects a double slash between segments', () => {
      const { error } = validate(createRedirectSchema, { path: 'seminar//foo', url: 'https://example.com' });
      expect(error).toBeDefined();
    });

    it('is required — missing path produces a validation error', () => {
      const { error } = validate(createRedirectSchema, { url: 'https://example.com' });
      expect(error).toBeDefined();
    });
  });

  // ── url ───────────────────────────────────────────────────────────────────
  describe('url', () => {
    it('is required — missing url produces a validation error', () => {
      const { error } = validate(createRedirectSchema, { path: 'seminar' });
      expect(error).toBeDefined();
    });

    it('accepts a valid https URL', () => {
      const { error } = validate(createRedirectSchema, { path: 'seminar', url: 'https://example.com/page' });
      expect(error).toBeUndefined();
    });

    it('rejects a non-URI string for url', () => {
      const { error } = validate(createRedirectSchema, { path: 'seminar', url: 'not-a-url' });
      expect(error).toBeDefined();
    });
  });

  // ── group ─────────────────────────────────────────────────────────────────
  describe('group', () => {
    it('is optional — valid object without group', () => {
      const { error } = validate(createRedirectSchema, { path: 'seminar', url: 'https://example.com' });
      expect(error).toBeUndefined();
    });

    it('accepts a lowercase slug', () => {
      const { error } = validate(createRedirectSchema, { path: 'seminar', url: 'https://example.com', group: 'fc' });
      expect(error).toBeUndefined();
    });

    it('accepts a slug with a hyphen', () => {
      const { error } = validate(createRedirectSchema, { path: 'seminar', url: 'https://example.com', group: 'grupo-a' });
      expect(error).toBeUndefined();
    });

    it('coerces uppercase group to lowercase', () => {
      const { error, value } = validate(createRedirectSchema, { path: 'seminar', url: 'https://example.com', group: 'FC' });
      expect(error).toBeUndefined();
      expect(value.group).toBe('fc');
    });

    it('rejects a group slug with an underscore', () => {
      const { error } = validate(createRedirectSchema, { path: 'seminar', url: 'https://example.com', group: 'grupo_a' });
      expect(error).toBeDefined();
    });
  });

  // ── owner — not in schema ─────────────────────────────────────────────────
  describe('owner', () => {
    it('rejects owner in the body — never comes from the client', () => {
      const { error } = validate(createRedirectSchema, {
        path: 'seminar',
        url: 'https://example.com',
        owner: 'user@example.com',
      });
      expect(error).toBeDefined();
      expect(error.details[0].message).toMatch(/owner/);
    });
  });

  // ── optional array fields ─────────────────────────────────────────────────
  describe('permission and categories', () => {
    it('accepts an object with permission and categories arrays', () => {
      const { error } = validate(createRedirectSchema, {
        path: 'seminar',
        url: 'https://example.com',
        permission: ['read:fc'],
        categories: ['eventos', 'ciencias'],
      });
      expect(error).toBeUndefined();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateRedirectSchema
// ─────────────────────────────────────────────────────────────────────────────
describe('updateRedirectSchema', () => {
  it('accepts an empty object — all fields are optional', () => {
    const { error } = validate(updateRedirectSchema, {});
    expect(error).toBeUndefined();
  });

  it('accepts a valid path that matches the slug pattern', () => {
    const { error } = validate(updateRedirectSchema, { path: 'fc/nuevo-evento' });
    expect(error).toBeUndefined();
  });

  it('rejects a path with a leading slash', () => {
    const { error } = validate(updateRedirectSchema, { path: '/fc/nuevo-evento' });
    expect(error).toBeDefined();
  });

  it('accepts a valid url update', () => {
    const { error } = validate(updateRedirectSchema, { url: 'https://new-destination.com' });
    expect(error).toBeUndefined();
  });

  it('accepts permission and categories updates', () => {
    const { error } = validate(updateRedirectSchema, {
      permission: ['read:fc'],
      categories: ['updated'],
    });
    expect(error).toBeUndefined();
  });

  it('rejects owner in the body', () => {
    const { error } = validate(updateRedirectSchema, { owner: 'user@example.com' });
    expect(error).toBeDefined();
    expect(error.details[0].message).toMatch(/owner/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getRedirectQuerySchema
// ─────────────────────────────────────────────────────────────────────────────
describe('getRedirectQuerySchema', () => {
  it('accepts an empty query object', () => {
    const { error } = validate(getRedirectQuerySchema, {});
    expect(error).toBeUndefined();
  });

  it('accepts orderBy alone', () => {
    const { error } = validate(getRedirectQuerySchema, { orderBy: 'created' });
    expect(error).toBeUndefined();
  });

  it('accepts valid offset and limit together', () => {
    const { error } = validate(getRedirectQuerySchema, { offset: 2, limit: 10 });
    expect(error).toBeUndefined();
  });

  it('accepts all three fields at once', () => {
    const { error } = validate(getRedirectQuerySchema, { orderBy: '-created', offset: 1, limit: 5 });
    expect(error).toBeUndefined();
  });

  it('rejects offset: 0 — minimum is 1', () => {
    const { error } = validate(getRedirectQuerySchema, { offset: 0 });
    expect(error).toBeDefined();
  });

  it('rejects limit: 0 — minimum is 1', () => {
    const { error } = validate(getRedirectQuerySchema, { limit: 0 });
    expect(error).toBeDefined();
  });

  it('rejects owner as an unknown field', () => {
    const { error } = validate(getRedirectQuerySchema, { owner: 'user@example.com' });
    expect(error).toBeDefined();
    expect(error.details[0].message).toMatch(/owner/);
  });

  it('rejects group as an unknown field', () => {
    const { error } = validate(getRedirectQuerySchema, { group: 'fc' });
    expect(error).toBeDefined();
    expect(error.details[0].message).toMatch(/group/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getByPathRedirectSchema
// NOTE: This schema is exported but not currently used by any route.
// The slugPath pattern rejects leading slashes — Express req.path always has
// a leading slash (e.g. /fc/seminar). If wired into the catch-all route as-is,
// it would reject every redirect request. Tested here to document current behavior.
// ─────────────────────────────────────────────────────────────────────────────
describe('getByPathRedirectSchema', () => {
  it('accepts a path without a leading slash', () => {
    const { error } = validate(getByPathRedirectSchema, { path: 'fc/seminar' });
    expect(error).toBeUndefined();
  });

  it('rejects a path with a leading slash — current pattern does not allow it', () => {
    // This is the format Express provides in req.path ("/fc/seminar").
    // If this schema is ever wired into the catch-all route, it must be fixed.
    const { error } = validate(getByPathRedirectSchema, { path: '/fc/seminar' });
    expect(error).toBeDefined();
  });

  it('path is required', () => {
    const { error } = validate(getByPathRedirectSchema, {});
    expect(error).toBeDefined();
  });
});
